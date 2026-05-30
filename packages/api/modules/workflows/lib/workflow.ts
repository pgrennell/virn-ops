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
	getOrganizationById,
	getWorkflowForOrg,
	getWorkflowWithVersions,
	insertWorkflowWithDraft,
	transitionWorkflowReviewState,
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
	/** Phase 11a step 3(a) cross-product alias. Set by the pack installer from the
	 * manifest's workflow key (str-turnover-housekeeping etc.); never set by the
	 * UI Builder in v1. The partial unique index on (organization_id, slug)
	 * surfaces collisions as a database error -- the install path is responsible
	 * for not double-installing within the same org. */
	slug?: string | null;
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
		slug: input.slug ?? null,
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
	/** Phase 16 -- re-attestation cadence. When set to a positive integer,
	 * also rolls `nextReviewAt` to `now + reviewIntervalDays` so the cron
	 * sweep has a concrete date to compare against. Set to `null` to clear
	 * the cadence entirely. */
	reviewIntervalDays?: number | null;
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

	// Phase 16 -- re-attestation cadence. When the interval changes (or is
	// cleared), derive the next_review_at accordingly so the cron has a
	// concrete date. A null interval clears next_review_at; a positive
	// integer sets it to `now + intervalDays`.
	let nextReviewAtPatch: Date | null | undefined = undefined;
	if (input.reviewIntervalDays !== undefined && input.reviewIntervalDays !== wf.reviewIntervalDays) {
		changes.reviewIntervalDays = {
			from: wf.reviewIntervalDays,
			to: input.reviewIntervalDays,
		};
		if (input.reviewIntervalDays === null) {
			nextReviewAtPatch = null;
		} else {
			const next = new Date();
			next.setDate(next.getDate() + input.reviewIntervalDays);
			nextReviewAtPatch = next;
		}
		changes.nextReviewAt = { from: wf.nextReviewAt, to: nextReviewAtPatch };
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
		reviewIntervalDays: input.reviewIntervalDays,
		nextReviewAt: nextReviewAtPatch,
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

// ---------------------------------------------------------------------------
// Review-state transitions (Phase 9.5g / PRD §6.6)
//
// The state machine:
//
//     ┌────────┐  submitForReview  ┌────────────┐  approveReview  ┌────────────┐
//     │ draft  │ ────────────────▶ │ in_review  │ ──────────────▶ │ published  │
//     └────────┘                   └────────────┘                 └────────────┘
//          ▲                             │
//          └───── sendBackToDraft ───────┘
//
// submitForReview gated on org.requireConciergeReview = true. Without the flag, the
// Builder's Publish button calls publishVersion directly, which is unchanged here.
// approveReview internally calls publishVersion AFTER transitioning state (so the
// from-state guard on the transition closes the "two admins approve simultaneously"
// race -- only one observes review_state='in_review' and proceeds). Publish itself has
// its own publish-race guard (D-018 §race) on top.
//
// Per PRD: workflow-level lifecycle, NOT version-level. workflow_version.status
// (draft/published/archived) is unchanged -- review_state is an EDITORIAL layer ON TOP
// of the existing version state.
// ---------------------------------------------------------------------------

export async function submitForReview(
	ctx: WorkflowContext,
	input: { workflowId: string },
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
			"Workflow is archived. Restore it before submitting for review.",
			{ workflowId: input.workflowId },
		);
	}

	// Org flag must be on -- submitForReview is only meaningful when the concierge-
	// review checkpoint is enforced. Without the flag, the Builder publishes directly.
	const org = await getOrganizationById(ctx.organizationId);
	if (!org?.requireConciergeReview) {
		throw new WorkflowEngineError(
			"CONCIERGE_REVIEW_NOT_ENABLED",
			"This organization doesn't have concierge review enabled. Publish directly instead.",
			{ workflowId: input.workflowId },
		);
	}

	// Must currently be 'draft' -- can't submit a published or already-in-review workflow.
	if (wf.reviewState !== "draft") {
		throw new WorkflowEngineError(
			"REVIEW_STATE_INVALID",
			`Cannot submit for review from state "${wf.reviewState}". Workflow must be in 'draft'.`,
			{ workflowId: input.workflowId, currentState: wf.reviewState },
		);
	}

	// Must have a draft version to submit -- submitting a workflow with no draft (after
	// a publish has been forked back and discarded) would queue a no-op review.
	const wfWithVersions = await getWorkflowWithVersions(
		ctx.organizationId,
		input.workflowId,
	);
	if (!wfWithVersions?.currentDraft) {
		throw new WorkflowEngineError(
			"WORKFLOW_HAS_NO_DRAFT",
			"Cannot submit for review: workflow has no draft version. Open the editor to create one.",
			{ workflowId: input.workflowId },
		);
	}

	const result = await transitionWorkflowReviewState({
		organizationId: ctx.organizationId,
		workflowId: input.workflowId,
		fromState: "draft",
		toState: "in_review",
	});
	if (!result.ok) {
		// Lost a race: another admin transitioned in between our read and write. Cleanest
		// recovery is to surface a distinct error so the UI refetches and re-renders.
		throw new WorkflowEngineError(
			"REVIEW_STATE_INVALID",
			"Review state changed during submission. Please refresh and try again.",
			{ workflowId: input.workflowId },
		);
	}

	await writeAuditAndActivity({
		organizationId: ctx.organizationId,
		actorUserId: ctx.userId,
		action: "workflow.review_submitted",
		verb: "submitted for review",
		entityType: "workflow",
		entityId: input.workflowId,
		changes: { reviewState: { from: "draft", to: "in_review" } },
		metadata: { draftVersionId: wfWithVersions.currentDraft.id },
		activityData: { workflowTitle: wf.title },
	});
}

export async function sendBackToDraft(
	ctx: WorkflowContext,
	input: { workflowId: string; comment?: string | null },
): Promise<void> {
	const wf = await getWorkflowForOrg(ctx.organizationId, input.workflowId);
	if (!wf) {
		throw new WorkflowEngineError("WORKFLOW_NOT_FOUND", "Workflow not found.", {
			workflowId: input.workflowId,
		});
	}
	if (wf.reviewState !== "in_review") {
		throw new WorkflowEngineError(
			"REVIEW_STATE_INVALID",
			`Cannot send back from state "${wf.reviewState}". Workflow must be 'in_review'.`,
			{ workflowId: input.workflowId, currentState: wf.reviewState },
		);
	}

	const result = await transitionWorkflowReviewState({
		organizationId: ctx.organizationId,
		workflowId: input.workflowId,
		fromState: "in_review",
		toState: "draft",
	});
	if (!result.ok) {
		throw new WorkflowEngineError(
			"REVIEW_STATE_INVALID",
			"Review state changed during send-back. Please refresh and try again.",
			{ workflowId: input.workflowId },
		);
	}

	await writeAuditAndActivity({
		organizationId: ctx.organizationId,
		actorUserId: ctx.userId,
		action: "workflow.review_sent_back",
		verb: "sent back to draft",
		entityType: "workflow",
		entityId: input.workflowId,
		changes: { reviewState: { from: "in_review", to: "draft" } },
		metadata: input.comment ? { comment: input.comment } : {},
		activityData: { workflowTitle: wf.title },
	});
}
