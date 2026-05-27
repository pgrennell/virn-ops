// packages/api/modules/workflows/lib/workflow.ts
//
// Workflow-level operations (create / update / archive). A workflow ALWAYS lands with
// an initial draft version -- the schema's separation of workflow vs. workflow_version
// is for versioning, not for empty-shell-then-populate, so we keep them in sync at
// birth. (Aligns with the seed shape.)
//
// `archiveWorkflow` is soft (workflow.deletedAt). This is the WORKFLOW-level archive
// (the whole authored asset is hidden) -- distinct from version-level
// `workflowVersionStatus='archived'` which retires one published version while keeping
// the workflow itself live. Don't conflate the two (D-018).

import {
	archiveWorkflow as archiveWorkflowQuery,
	getWorkflowForOrg,
	insertWorkflowWithDraft,
	updateWorkflow as updateWorkflowQuery,
	writeAuditAndActivity,
} from "@virn/database";

import { WorkflowEngineError } from "./errors";

export interface WorkflowContext {
	organizationId: string;
	userId: string;
}

export interface CreateWorkflowInput {
	title: string;
	description?: string | null;
	/** Defaults to "procedure" when omitted. The "+ Create" menu on the Library passes
	 * this so a "+ Create SOP / Form" lands on the right type directly. */
	type?: "procedure" | "document" | "policy" | "form";
}

export async function createWorkflow(
	ctx: WorkflowContext,
	input: CreateWorkflowInput,
): Promise<{ workflowId: string; draftVersionId: string }> {
	const { workflowId, versionId } = await insertWorkflowWithDraft({
		organizationId: ctx.organizationId,
		title: input.title,
		description: input.description ?? null,
		type: input.type ?? "procedure",
		createdBy: ctx.userId,
	});

	await writeAuditAndActivity({
		organizationId: ctx.organizationId,
		actorUserId: ctx.userId,
		action: "workflow.created",
		verb: "created",
		entityType: "workflow",
		entityId: workflowId,
		changes: {
			title: input.title,
			type: input.type ?? "procedure",
		},
		metadata: { initialDraftVersionId: versionId },
		activityData: { workflowTitle: input.title },
	});

	return { workflowId, draftVersionId: versionId };
}

export interface UpdateWorkflowInput {
	workflowId: string;
	title?: string;
	description?: string | null;
	type?: "procedure" | "document" | "policy" | "form";
	isActive?: boolean;
	/** Phase 9.5e: workflow-level entity-set scope (D-034 / PRD §6.2). Empty array =
	 * applies-to-all (pre-v1.5 behavior); non-empty = launcher's set-intersection filter
	 * surfaces this workflow only when the target entity's memberships overlap. Pass
	 * `undefined` to leave unchanged. */
	entitySetIds?: string[];
}

export async function updateWorkflowMeta(
	ctx: WorkflowContext,
	input: UpdateWorkflowInput,
): Promise<void> {
	const wf = await getWorkflowForOrg(ctx.organizationId, input.workflowId);
	if (!wf) {
		throw new WorkflowEngineError("WORKFLOW_NOT_FOUND", "Workflow not found.", {
			workflowId: input.workflowId,
		});
	}
	if (wf.deletedAt !== null) {
		throw new WorkflowEngineError(
			"WORKFLOW_ARCHIVED",
			"Workflow is archived. Restore it before editing.",
			{ workflowId: input.workflowId },
		);
	}

	const changes: Record<string, unknown> = {};
	if (input.title !== undefined && input.title !== wf.title) changes.title = input.title;
	if (input.description !== undefined && input.description !== wf.description) {
		changes.description = input.description;
	}
	if (input.type !== undefined && input.type !== wf.type) changes.type = input.type;
	if (input.isActive !== undefined && input.isActive !== wf.isActive) {
		changes.isActive = input.isActive;
	}
	if (input.entitySetIds !== undefined) {
		// Compare arrays by content (order-insensitive set equality). Authors expect
		// "select STR + Commercial" and "select Commercial + STR" to be the same change.
		const before = [...(wf.entitySetIds ?? [])].sort();
		const after = [...input.entitySetIds].sort();
		const same =
			before.length === after.length && before.every((id, i) => id === after[i]);
		if (!same) {
			changes.entitySetIds = { from: wf.entitySetIds ?? [], to: input.entitySetIds };
		}
	}
	if (Object.keys(changes).length === 0) return; // No-op.

	await updateWorkflowQuery({
		organizationId: ctx.organizationId,
		workflowId: input.workflowId,
		title: input.title,
		description: input.description,
		type: input.type,
		isActive: input.isActive,
		entitySetIds: input.entitySetIds,
	});

	await writeAuditAndActivity({
		organizationId: ctx.organizationId,
		actorUserId: ctx.userId,
		action: "workflow.updated",
		verb: "updated",
		entityType: "workflow",
		entityId: input.workflowId,
		changes,
		metadata: {},
		activityData: { workflowTitle: input.title ?? wf.title },
	});
}

export async function archiveWorkflowOp(
	ctx: WorkflowContext,
	input: { workflowId: string },
): Promise<void> {
	const wf = await getWorkflowForOrg(ctx.organizationId, input.workflowId);
	if (!wf) {
		throw new WorkflowEngineError("WORKFLOW_NOT_FOUND", "Workflow not found.", {
			workflowId: input.workflowId,
		});
	}
	if (wf.deletedAt !== null) return; // Idempotent.

	await archiveWorkflowQuery({
		organizationId: ctx.organizationId,
		workflowId: input.workflowId,
	});

	await writeAuditAndActivity({
		organizationId: ctx.organizationId,
		actorUserId: ctx.userId,
		action: "workflow.archived",
		verb: "archived",
		entityType: "workflow",
		entityId: input.workflowId,
		changes: { deletedAt: { from: null, to: "now" } },
		metadata: {},
		activityData: { workflowTitle: wf.title },
	});
}
