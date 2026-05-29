// packages/api/modules/workflows/lib/read-receipts.ts
//
// Phase 10 / v1.5c -- read-receipt lib helpers. Wraps the queries module's
// markWorkflowVersionAsRead / hasUserReadVersion / listReadReceiptsForVersion
// with the org-scoping checks the procedure layer expects.
//
// All three helpers verify the target workflow_version belongs to the
// caller's org before touching the receipt table. Cross-org access is
// refused with the standard "not found" code so a curious caller can't
// enumerate version ids across orgs (information-leak avoidance, same
// pattern as agents.regenerateStep).

import {
	getVersionWithWorkflow,
	hasUserReadVersion,
	listReadReceiptsForVersion,
	markWorkflowVersionAsRead,
	type ReadReceiptRow,
} from "@virn/database";

import { WorkflowEngineError } from "./errors";

export interface ReadReceiptContext {
	organizationId: string;
	userId: string;
}

// ---------------------------------------------------------------------------
// markVersionAsRead
// ---------------------------------------------------------------------------

export interface MarkVersionAsReadInput {
	workflowVersionId: string;
}

export interface MarkVersionAsReadResult {
	id: string;
	readAt: Date;
	alreadyExisted: boolean;
}

export async function markVersionAsRead(
	ctx: ReadReceiptContext,
	input: MarkVersionAsReadInput,
): Promise<MarkVersionAsReadResult> {
	const bundle = await getVersionWithWorkflow(input.workflowVersionId);
	if (!bundle || bundle.workflow.organizationId !== ctx.organizationId) {
		throw new WorkflowEngineError(
			"VERSION_NOT_FOUND",
			"Workflow version not found.",
			{ workflowVersionId: input.workflowVersionId },
		);
	}
	// Only published versions are "readable" per PRD §6.4 -- drafts are
	// editor state, not yet a published SOP. Mark-as-read on a draft would
	// produce a receipt pointing at content that may never ship.
	if (bundle.version.status !== "published") {
		throw new WorkflowEngineError(
			"VERSION_NOT_PUBLISHED",
			`Cannot mark a ${bundle.version.status} version as read; only published versions are SOPs.`,
			{ workflowVersionId: input.workflowVersionId, status: bundle.version.status },
		);
	}
	return await markWorkflowVersionAsRead({
		organizationId: ctx.organizationId,
		workflowId: bundle.workflow.id,
		workflowVersionId: bundle.version.id,
		userId: ctx.userId,
	});
}

// ---------------------------------------------------------------------------
// getMyReadStatus
// ---------------------------------------------------------------------------

export interface GetMyReadStatusInput {
	workflowVersionId: string;
}

export interface GetMyReadStatusResult {
	hasRead: boolean;
	readAt: Date | null;
}

export async function getMyReadStatus(
	ctx: ReadReceiptContext,
	input: GetMyReadStatusInput,
): Promise<GetMyReadStatusResult> {
	// Org scope check first -- the version must belong to ctx.organizationId.
	// We refuse with a no-error "no read" rather than a thrown error so the
	// UI can render the Read view's button state without distinguishing
	// "you haven't read it" from "this version isn't yours" (and the wider
	// permission system already prevents cross-org navigation).
	const bundle = await getVersionWithWorkflow(input.workflowVersionId);
	if (!bundle || bundle.workflow.organizationId !== ctx.organizationId) {
		return { hasRead: false, readAt: null };
	}
	const row = await hasUserReadVersion({
		workflowVersionId: input.workflowVersionId,
		userId: ctx.userId,
	});
	if (!row) return { hasRead: false, readAt: null };
	return { hasRead: true, readAt: row.readAt };
}

// ---------------------------------------------------------------------------
// listVersionReadReceipts (admin)
// ---------------------------------------------------------------------------

export interface ListVersionReadReceiptsInput {
	workflowVersionId: string;
}

export async function listVersionReadReceipts(
	ctx: ReadReceiptContext,
	input: ListVersionReadReceiptsInput,
): Promise<ReadReceiptRow[]> {
	const bundle = await getVersionWithWorkflow(input.workflowVersionId);
	if (!bundle || bundle.workflow.organizationId !== ctx.organizationId) {
		throw new WorkflowEngineError(
			"VERSION_NOT_FOUND",
			"Workflow version not found.",
			{ workflowVersionId: input.workflowVersionId },
		);
	}
	return await listReadReceiptsForVersion({
		workflowVersionId: input.workflowVersionId,
	});
}
