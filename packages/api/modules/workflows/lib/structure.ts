// packages/api/modules/workflows/lib/structure.ts
//
// Section / step / field / step-dependency mutations. Every operation here is
// DRAFT-ONLY -- the guards layer refuses on published or archived versions before
// any write touches the DB, so the published snapshot is physically immutable through
// this API (Invariant #3).
//
// Field-key lifecycle is enforced HERE on the field operations (auto-slug on create;
// lock-check on rename + delete). Step references (other steps via step_dependency,
// step.dueAnchorStepId) get the same refuse-on-reference posture on step deletion.

import {
	deleteField,
	deleteSection,
	deleteStep,
	deleteStepDependency,
	findFieldReferencers,
	findStepReferencers,
	getFieldWithVersion,
	getStepWithVersion,
	insertField,
	insertSection,
	insertStep,
	insertStepDependency,
	reorderSteps as reorderStepsQuery,
	updateField,
	updateSection,
	updateStep,
} from "@virn/database";

import { WorkflowEngineError } from "./errors";
import {
	assertFieldEditable,
	assertSectionEditable,
	assertStepEditable,
	assertVersionIsDraft,
} from "./guards";
import {
	assertFieldDeleteAllowed,
	assertKeyRenameAllowed,
	autoSlugFromLabel,
	resolveUniqueKey,
	validateKeyShape,
} from "./field-key";

export interface StructureContext {
	organizationId: string;
	userId: string;
}

// ---------------------------------------------------------------------------
// Section ops
// ---------------------------------------------------------------------------

export async function createSection(
	ctx: StructureContext,
	input: { workflowVersionId: string; title: string; position?: number },
): Promise<{ id: string }> {
	await assertVersionIsDraft(ctx, input.workflowVersionId);
	return await insertSection({
		workflowVersionId: input.workflowVersionId,
		title: input.title,
		position: input.position,
	});
}

export async function updateSectionOp(
	ctx: StructureContext,
	input: { sectionId: string; title?: string; position?: number },
): Promise<void> {
	await assertSectionEditable(ctx, input.sectionId);
	await updateSection({
		sectionId: input.sectionId,
		title: input.title,
		position: input.position,
	});
}

export async function deleteSectionOp(
	ctx: StructureContext,
	input: { sectionId: string },
): Promise<void> {
	await assertSectionEditable(ctx, input.sectionId);
	// Schema sets step.sectionId -> null on delete; orphan steps survive (caller can
	// re-bucket them). Acceptable since a draft is mid-edit.
	await deleteSection({ sectionId: input.sectionId });
}

// ---------------------------------------------------------------------------
// dueType ref validation (shared by createStep + updateStepOp)
// ---------------------------------------------------------------------------

/** Validate the patch's dueAnchorStepId / dueSourceFieldId against the version
 * the step lives in. Catches the "destructive" combinations that would silently
 * produce null deadlines at launch:
 *
 *   - dueAnchorStepId points at a step in a different (or missing) version
 *   - dueAnchorStepId points at the same step (self-anchor; circular)
 *   - dueSourceFieldId points at a field in a different (or missing) version
 *   - dueSourceFieldId points at a non-`date` field
 *
 * Does NOT enforce "dueType=offset_from_step requires an anchor" -- the
 * Builder's two-step pattern (and the AI authoring lib's two-pass insert)
 * legitimately set dueType BEFORE the companion ref. The launch path returns
 * null for an incomplete config (deferred), which the recompute hook patches
 * once the missing piece arrives. */
/** Companion field key used by the auto-clear helper below. */
type DueCompanion = "dueOffsetDays" | "dueAnchorStepId" | "dueSourceFieldId";

/** Which companion fields a given dueType USES. Anything not in this set must be
 * null/cleared on the row -- the auto-clear helper enforces that on every write
 * that includes dueType in the patch. Source of truth shared by createStep +
 * updateStepOp; mirrors the per-dueType invariants in the AI authoring schema
 * validator (ai-authoring/schema.ts:assertAuthoredWorkflowReferences). */
const DUE_COMPANIONS_USED: Record<
	"none" | "offset_from_start" | "offset_from_step" | "from_date_field",
	ReadonlySet<DueCompanion>
> = {
	none: new Set<DueCompanion>(),
	offset_from_start: new Set<DueCompanion>(["dueOffsetDays"]),
	offset_from_step: new Set<DueCompanion>(["dueOffsetDays", "dueAnchorStepId"]),
	from_date_field: new Set<DueCompanion>(["dueOffsetDays", "dueSourceFieldId"]),
};

/** Patch shape that may carry dueType + companions. Used by both createStep and
 * updateStepOp; the helper returns a normalized patch where companions not used
 * by the (incoming or implicit) dueType are explicitly cleared to null. */
type PatchWithDueRule = {
	dueType?: "none" | "offset_from_start" | "offset_from_step" | "from_date_field";
	dueOffsetDays?: number | null;
	dueAnchorStepId?: string | null;
	dueSourceFieldId?: string | null;
};

/** If the patch includes a dueType, force any companion field that this dueType
 * doesn't use to null in the returned patch. This prevents the "narrow dueType
 * without explicitly nulling old refs" footgun: a direct API call posting
 * `{ stepId, dueType: 'none' }` on a step with a previously-set dueAnchorStepId
 * would otherwise leave the stale FK alive, blocking deletion of the previously-
 * anchored step. */
function normalizeDuePatch<T extends PatchWithDueRule>(patch: T): T {
	if (patch.dueType === undefined) return patch;
	const used = DUE_COMPANIONS_USED[patch.dueType];
	const out = { ...patch };
	if (!used.has("dueOffsetDays")) out.dueOffsetDays = null;
	if (!used.has("dueAnchorStepId")) out.dueAnchorStepId = null;
	if (!used.has("dueSourceFieldId")) out.dueSourceFieldId = null;
	return out;
}

/** Exported under an authoring-specific name so the AI authoring lib can route its
 * second-pass updateStep writes through the same guard as the public structure
 * API. Same body as the local `assertDueRefs` helper used by createStep +
 * updateStepOp; kept inline (not refactored to call this) to avoid a redundant
 * function-indirection on the hot path. */
export async function assertStepDueRefs(args: {
	versionId: string;
	stepId: string | null;
	dueAnchorStepId?: string | null;
	dueSourceFieldId?: string | null;
}): Promise<void> {
	return assertDueRefs(args);
}

async function assertDueRefs(args: {
	versionId: string;
	/** The step being patched. Used to reject self-anchor. For createStep this
	 * is null (the step doesn't exist yet, so self-anchor isn't possible). */
	stepId: string | null;
	dueAnchorStepId?: string | null;
	dueSourceFieldId?: string | null;
}): Promise<void> {
	const checkAnchor =
		args.dueAnchorStepId !== undefined && args.dueAnchorStepId !== null;
	const checkSource =
		args.dueSourceFieldId !== undefined && args.dueSourceFieldId !== null;

	// Cheap-path checks before any DB round-trip.
	if (checkAnchor && args.stepId !== null && args.dueAnchorStepId === args.stepId) {
		throw new WorkflowEngineError(
			"DUE_ANCHOR_SELF_REFERENCE",
			"A step cannot anchor on itself -- pick another step or clear dueAnchorStepId.",
			{ stepId: args.stepId },
		);
	}

	if (!checkAnchor && !checkSource) return;

	// Run the two reads in parallel when both are needed. Independent lookups
	// against unrelated rows -- no data dependency between them.
	const [anchor, src] = await Promise.all([
		checkAnchor ? getStepWithVersion(args.dueAnchorStepId as string) : null,
		checkSource ? getFieldWithVersion(args.dueSourceFieldId as string) : null,
	]);

	if (checkAnchor) {
		if (!anchor || anchor.version.id !== args.versionId) {
			throw new WorkflowEngineError(
				"DUE_ANCHOR_INVALID",
				"dueAnchorStepId must reference a step in the same workflow version.",
				{ dueAnchorStepId: args.dueAnchorStepId, versionId: args.versionId },
			);
		}
	}
	if (checkSource) {
		if (!src || src.version.id !== args.versionId) {
			throw new WorkflowEngineError(
				"DUE_SOURCE_FIELD_INVALID",
				"dueSourceFieldId must reference a field in the same workflow version.",
				{ dueSourceFieldId: args.dueSourceFieldId, versionId: args.versionId },
			);
		}
		if (src.field.fieldType !== "date") {
			throw new WorkflowEngineError(
				"DUE_SOURCE_FIELD_NOT_DATE",
				`dueSourceFieldId must reference a 'date' field, not '${src.field.fieldType}'.`,
				{
					dueSourceFieldId: args.dueSourceFieldId,
					actualFieldType: src.field.fieldType,
				},
			);
		}
	}
}

// ---------------------------------------------------------------------------
// Step ops
// ---------------------------------------------------------------------------

export interface CreateStepInput {
	workflowVersionId: string;
	sectionId?: string | null;
	assignedRoleId?: string | null;
	type?: "task" | "approval" | "heading" | "one_off" | "code" | "ai";
	title: string;
	description?: string | null;
	position?: number;
	isRequired?: boolean;
	isStopTask?: boolean;
	dueType?: "none" | "offset_from_start" | "offset_from_step" | "from_date_field";
	dueOffsetDays?: number | null;
	dueAnchorStepId?: string | null;
	dueSourceFieldId?: string | null;
}

export async function createStep(
	ctx: StructureContext,
	input: CreateStepInput,
): Promise<{ id: string }> {
	await assertVersionIsDraft(ctx, input.workflowVersionId);
	// Auto-clear companion fields that the supplied dueType doesn't use, so a
	// caller passing { dueType: 'none', dueAnchorStepId: '...' } can't smuggle a
	// stale FK onto a brand-new row. Applied BEFORE assertDueRefs so the cleared
	// refs skip the lookup entirely.
	const normalized = normalizeDuePatch(input);
	// Phase 12.2 -- validate dueAnchorStepId / dueSourceFieldId refs if present.
	// stepId is null here: the step doesn't exist yet, so self-anchor isn't
	// possible. (The new step's ID hasn't been minted; anchoring on yourself
	// would require knowing the id ahead of time.)
	await assertDueRefs({
		versionId: input.workflowVersionId,
		stepId: null,
		dueAnchorStepId: normalized.dueAnchorStepId,
		dueSourceFieldId: normalized.dueSourceFieldId,
	});
	return await insertStep(normalized);
}

export interface UpdateStepInput {
	stepId: string;
	sectionId?: string | null;
	assignedRoleId?: string | null;
	type?: "task" | "approval" | "heading" | "one_off" | "code" | "ai";
	title?: string;
	description?: string | null;
	position?: number;
	isRequired?: boolean;
	isStopTask?: boolean;
	dueType?: "none" | "offset_from_start" | "offset_from_step" | "from_date_field";
	dueOffsetDays?: number | null;
	dueAnchorStepId?: string | null;
	dueSourceFieldId?: string | null;
}

export async function updateStepOp(
	ctx: StructureContext,
	input: UpdateStepInput,
): Promise<void> {
	const { version } = await assertStepEditable(ctx, input.stepId);
	// Auto-clear stale FK companions when dueType narrows. Direct API call
	// posting { stepId, dueType: 'none' } on a row with a previously-set
	// dueAnchorStepId would otherwise leave the stale FK alive, blocking
	// deletion of the previously-anchored step. Applied BEFORE assertDueRefs so
	// the cleared refs skip the lookup entirely.
	const normalized = normalizeDuePatch(input);
	// Phase 12.2 -- validate dueAnchorStepId / dueSourceFieldId refs if present
	// in the patch. Skips when neither is being changed (the common case for
	// title/description/required patches).
	await assertDueRefs({
		versionId: version.id,
		stepId: input.stepId,
		dueAnchorStepId: normalized.dueAnchorStepId,
		dueSourceFieldId: normalized.dueSourceFieldId,
	});
	await updateStep(normalized);
}

export async function deleteStepOp(
	ctx: StructureContext,
	input: { stepId: string },
): Promise<void> {
	await assertStepEditable(ctx, input.stepId);

	// Refuse-on-reference (symmetric with field deletion). Today the only step
	// references are step_dependency edges + step.dueAnchorStepId (deferred consumer).
	// Wire the guard now so it can't be forgotten when offset_from_step ships.
	const refs = await findStepReferencers(input.stepId);
	if (refs.length > 0) {
		throw new WorkflowEngineError(
			"STEP_HAS_REFERENCERS",
			`This step is referenced by ${refs.length} item(s) and cannot be deleted. Clear the references first.`,
			{ stepId: input.stepId, referencers: refs },
		);
	}

	await deleteStep({ stepId: input.stepId });
}

export async function reorderStepsOp(
	ctx: StructureContext,
	input: {
		workflowVersionId: string;
		ordering: Array<{ stepId: string; position: number }>;
	},
): Promise<void> {
	await assertVersionIsDraft(ctx, input.workflowVersionId);
	await reorderStepsQuery({
		workflowVersionId: input.workflowVersionId,
		ordering: input.ordering,
	});
}

// ---------------------------------------------------------------------------
// Field ops -- key lifecycle is the load-bearing part here.
// ---------------------------------------------------------------------------

export interface CreateFieldInput {
	workflowVersionId: string;
	stepId: string | null;
	label: string;
	/** If omitted, auto-slugged from label. Validated either way. */
	key?: string;
	fieldType:
		| "text"
		| "textarea"
		| "number"
		| "date"
		| "select"
		| "multiselect"
		| "file"
		| "image"
		| "signature"
		| "member"
		| "lookup";
	config?: Record<string, unknown> | null;
	isRequired?: boolean;
	position?: number;
}

export async function createField(
	ctx: StructureContext,
	input: CreateFieldInput,
): Promise<{ id: string; key: string }> {
	await assertVersionIsDraft(ctx, input.workflowVersionId);

	const candidate = input.key ?? autoSlugFromLabel(input.label);
	const key = await resolveUniqueKey({
		workflowVersionId: input.workflowVersionId,
		candidate,
	});

	const result = await insertField({
		workflowVersionId: input.workflowVersionId,
		stepId: input.stepId,
		key,
		label: input.label,
		fieldType: input.fieldType,
		config: input.config ?? null,
		isRequired: input.isRequired,
		position: input.position,
	});
	return { id: result.id, key };
}

export interface UpdateFieldInput {
	fieldId: string;
	/** Always editable. */
	label?: string;
	/** Rename allowed only when unreferenced. Locks via D-017 referencers. */
	key?: string;
	fieldType?:
		| "text"
		| "textarea"
		| "number"
		| "date"
		| "select"
		| "multiselect"
		| "file"
		| "image"
		| "signature"
		| "member"
		| "lookup";
	config?: Record<string, unknown> | null;
	isRequired?: boolean;
	position?: number;
}

export async function updateFieldOp(
	ctx: StructureContext,
	input: UpdateFieldInput,
): Promise<void> {
	const { field } = await assertFieldEditable(ctx, input.fieldId);

	// Key change: validate shape, ensure unique, then lock-check (refuse if referenced).
	let nextKey: string | undefined;
	if (input.key !== undefined && input.key !== field.key) {
		validateKeyShape(input.key);
		await assertKeyRenameAllowed(input.fieldId);
		// Resolve uniqueness, excluding the row being renamed.
		nextKey = await resolveUniqueKey({
			workflowVersionId: field.workflowVersionId,
			candidate: input.key,
			excludeFieldId: input.fieldId,
		});
	}

	// Phase 12.2 -- fieldType change guard. A `from_date_field` due rule sources
	// from this field's `date` value; flipping the type to something non-date (or
	// to something a `condition` rule can't compare) would silently break the
	// downstream consumer at launch. Same posture as assertKeyRenameAllowed:
	// refuse with a structured error listing the referencers so the UI can
	// surface "clear these references first."
	if (input.fieldType !== undefined && input.fieldType !== field.fieldType) {
		const refs = await findFieldReferencers(input.fieldId);
		if (refs.length > 0) {
			throw new WorkflowEngineError(
				"FIELD_TYPE_CHANGE_LOCKED",
				`This field's type is referenced by ${refs.length} item(s) and cannot be changed. Clear the references first.`,
				{
					fieldId: input.fieldId,
					fromType: field.fieldType,
					toType: input.fieldType,
					referencers: refs,
				},
			);
		}
	}

	await updateField({
		fieldId: input.fieldId,
		key: nextKey,
		label: input.label,
		fieldType: input.fieldType,
		config: input.config,
		isRequired: input.isRequired,
		position: input.position,
	});
}

export async function deleteFieldOp(
	ctx: StructureContext,
	input: { fieldId: string },
): Promise<void> {
	await assertFieldEditable(ctx, input.fieldId);
	// Refuse-on-reference (parallel to lock-on-rename).
	await assertFieldDeleteAllowed(input.fieldId);
	await deleteField({ fieldId: input.fieldId });
}

// ---------------------------------------------------------------------------
// Step dependency ops
// ---------------------------------------------------------------------------

export async function addStepDependency(
	ctx: StructureContext,
	input: { stepId: string; dependsOnStepId: string },
): Promise<void> {
	if (input.stepId === input.dependsOnStepId) {
		throw new WorkflowEngineError(
			"DEPENDENCY_SELF_REFERENCE",
			"A step cannot depend on itself.",
			{ stepId: input.stepId },
		);
	}
	const stepPair = await assertStepEditable(ctx, input.stepId);
	const depPair = await assertStepEditable(ctx, input.dependsOnStepId);

	// Both endpoints must live in the same workflow_version.
	if (stepPair.version.id !== depPair.version.id) {
		throw new WorkflowEngineError(
			"DEPENDENCY_VERSION_MISMATCH",
			"Cross-version step dependencies are not allowed.",
			{
				stepId: input.stepId,
				dependsOnStepId: input.dependsOnStepId,
				stepVersionId: stepPair.version.id,
				dependsOnVersionId: depPair.version.id,
			},
		);
	}

	await insertStepDependency({
		stepId: input.stepId,
		dependsOnStepId: input.dependsOnStepId,
	});
}

export async function removeStepDependency(
	ctx: StructureContext,
	input: { stepId: string; dependsOnStepId: string },
): Promise<void> {
	// Either endpoint's editability check is sufficient (both must live in the same
	// draft version, enforced on add). Use the dependent step's check.
	await assertStepEditable(ctx, input.stepId);
	await deleteStepDependency({
		stepId: input.stepId,
		dependsOnStepId: input.dependsOnStepId,
	});
}
