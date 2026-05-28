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
async function assertDueRefs(args: {
	versionId: string;
	/** The step being patched. Used to reject self-anchor. For createStep this
	 * is null (the step doesn't exist yet, so self-anchor isn't possible). */
	stepId: string | null;
	dueAnchorStepId?: string | null;
	dueSourceFieldId?: string | null;
}): Promise<void> {
	if (
		args.dueAnchorStepId !== undefined &&
		args.dueAnchorStepId !== null
	) {
		if (args.stepId !== null && args.dueAnchorStepId === args.stepId) {
			throw new WorkflowEngineError(
				"DUE_ANCHOR_SELF_REFERENCE",
				"A step cannot anchor on itself -- pick another step or clear dueAnchorStepId.",
				{ stepId: args.stepId },
			);
		}
		const anchor = await getStepWithVersion(args.dueAnchorStepId);
		if (!anchor || anchor.version.id !== args.versionId) {
			throw new WorkflowEngineError(
				"DUE_ANCHOR_INVALID",
				"dueAnchorStepId must reference a step in the same workflow version.",
				{ dueAnchorStepId: args.dueAnchorStepId, versionId: args.versionId },
			);
		}
	}
	if (
		args.dueSourceFieldId !== undefined &&
		args.dueSourceFieldId !== null
	) {
		const src = await getFieldWithVersion(args.dueSourceFieldId);
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
	// Phase 12.2 -- validate dueAnchorStepId / dueSourceFieldId refs if present.
	// stepId is null here: the step doesn't exist yet, so self-anchor isn't
	// possible. (The new step's ID hasn't been minted; anchoring on yourself
	// would require knowing the id ahead of time.)
	await assertDueRefs({
		versionId: input.workflowVersionId,
		stepId: null,
		dueAnchorStepId: input.dueAnchorStepId,
		dueSourceFieldId: input.dueSourceFieldId,
	});
	return await insertStep(input);
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
	// Phase 12.2 -- validate dueAnchorStepId / dueSourceFieldId refs if present
	// in the patch. Skips when neither is being changed (the common case for
	// title/description/required patches).
	await assertDueRefs({
		versionId: version.id,
		stepId: input.stepId,
		dueAnchorStepId: input.dueAnchorStepId,
		dueSourceFieldId: input.dueSourceFieldId,
	});
	await updateStep(input);
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
