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
	await assertStepEditable(ctx, input.stepId);
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
