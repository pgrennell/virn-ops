// packages/api/modules/approvals/lib/approval.ts
//
// Phase 16 -- version_approval lifecycle. The schema shipped in Phase 1
// Batch 3; Phase 16 wraps it with the request -> decide -> publish-gate
// flow. Distinct from the Phase 9.5g concierge review (workflow-level
// review_state): version_approval is per-version + multi-round-capable
// (a rejected request can be re-requested after edits land a new draft).
//
// Gating layers (the procedure layer wires roles; lib enforces business
// rules):
//   - requestApproval: capability=governance.approvals + draft-only +
//     no-existing-pending. Any member can request (the requester is the
//     author or another reviewer); the procedure runs adminOrgProcedure for
//     v1 since the workflows.update path is admin-only -- widen when ADR-004
//     custom-role layer ships.
//   - decideApproval: capability=governance.approvals + must-be-pending.
//     adminOrgProcedure today; reviewer role gets added when ADR-004 ships.
//   - publish gate: when capability is on, publishVersion refuses unless an
//     `approved` row exists for the version. Composed in workflows/lib/publish.

import { ORPCError } from "@orpc/server";
import {
	decideVersionApprovalRow,
	getApprovalRowForOrg,
	getLatestApprovalForVersion,
	getVersionWithWorkflow,
	insertVersionApproval,
	isCapabilityEnabledForOrg,
	listApprovalsForVersion,
	listPendingApprovalsForOrg,
	type PendingApprovalRow,
	type VersionApprovalRow,
	writeAuditAndActivity,
} from "@virn/database";

export const APPROVALS_CAPABILITY_KEY = "governance.approvals";

export interface ApprovalContext {
	organizationId: string;
	userId: string;
}

// ---------------------------------------------------------------------------
// requestApproval
// ---------------------------------------------------------------------------

export interface RequestApprovalInput {
	workflowVersionId: string;
	approverId?: string | null;
}

export interface RequestApprovalResult {
	id: string;
	createdAt: Date;
}

export async function requestApproval(
	ctx: ApprovalContext,
	input: RequestApprovalInput,
): Promise<RequestApprovalResult> {
	const bundle = await getVersionWithWorkflow(input.workflowVersionId);
	if (!bundle || bundle.workflow.organizationId !== ctx.organizationId) {
		throw new ORPCError("NOT_FOUND", {
			message: "Workflow version not found.",
			data: { code: "VERSION_NOT_FOUND" },
		});
	}
	if (bundle.version.status !== "draft") {
		throw new ORPCError("BAD_REQUEST", {
			message: `Cannot request approval on a ${bundle.version.status} version; only drafts.`,
			data: { code: "VERSION_NOT_DRAFT", status: bundle.version.status },
		});
	}
	const capEnabled = await isCapabilityEnabledForOrg(
		ctx.organizationId,
		APPROVALS_CAPABILITY_KEY,
	);
	if (!capEnabled) {
		throw new ORPCError("FORBIDDEN", {
			message: "Approvals are not enabled for this organization.",
			data: { code: "CAPABILITY_DISABLED", capability: APPROVALS_CAPABILITY_KEY },
		});
	}
	const latest = await getLatestApprovalForVersion({
		workflowVersionId: input.workflowVersionId,
	});
	if (latest && latest.decision === "pending") {
		throw new ORPCError("CONFLICT", {
			message: "An approval is already pending for this version.",
			data: { code: "APPROVAL_ALREADY_PENDING", approvalId: latest.id },
		});
	}
	if (latest && latest.decision === "approved") {
		throw new ORPCError("CONFLICT", {
			message:
				"This version is already approved; publish it instead of requesting again.",
			data: { code: "APPROVAL_ALREADY_APPROVED", approvalId: latest.id },
		});
	}

	const inserted = await insertVersionApproval({
		workflowVersionId: input.workflowVersionId,
		requestedByUserId: ctx.userId,
		approverId: input.approverId ?? null,
	});

	await writeAuditAndActivity({
		organizationId: ctx.organizationId,
		actorUserId: ctx.userId,
		actorKind: "user",
		action: "version_approval.requested",
		verb: "requested approval",
		entityType: "version_approval",
		entityId: inserted.id,
		activityData: {
			workflowId: bundle.workflow.id,
			workflowVersionId: input.workflowVersionId,
			workflowVersionNumber: bundle.version.versionNumber,
		},
	});

	return inserted;
}

// ---------------------------------------------------------------------------
// decideApproval
// ---------------------------------------------------------------------------

export interface DecideApprovalInput {
	approvalId: string;
	decision: "approved" | "rejected";
	note?: string | null;
}

export interface DecideApprovalResult {
	id: string;
	decision: "approved" | "rejected";
	decidedAt: Date;
}

export async function decideApproval(
	ctx: ApprovalContext,
	input: DecideApprovalInput,
): Promise<DecideApprovalResult> {
	// Org-scope check: the approval row must reference a version in this org.
	// Single-row lookup via the joined helper -- cheaper than scanning the
	// org-wide pending list and not vulnerable to a row that's already been
	// decided slipping out of the pending filter mid-call.
	const row = await getApprovalRowForOrg({
		organizationId: ctx.organizationId,
		approvalId: input.approvalId,
	});
	if (!row) {
		throw new ORPCError("NOT_FOUND", {
			message: "Approval not found in this organization.",
			data: { code: "APPROVAL_NOT_FOUND" },
		});
	}
	if (row.decision !== "pending") {
		throw new ORPCError("CONFLICT", {
			message: "This approval was already decided.",
			data: { code: "APPROVAL_ALREADY_DECIDED", currentDecision: row.decision },
		});
	}
	const capEnabled = await isCapabilityEnabledForOrg(
		ctx.organizationId,
		APPROVALS_CAPABILITY_KEY,
	);
	if (!capEnabled) {
		throw new ORPCError("FORBIDDEN", {
			message: "Approvals are not enabled for this organization.",
			data: { code: "CAPABILITY_DISABLED", capability: APPROVALS_CAPABILITY_KEY },
		});
	}

	const result = await decideVersionApprovalRow({
		approvalId: input.approvalId,
		approverUserId: ctx.userId,
		decision: input.decision,
		note: input.note ?? null,
	});
	if (!result) {
		// The WHERE clause matched zero rows -- someone else already decided.
		throw new ORPCError("CONFLICT", {
			message: "This approval was already decided by another reviewer.",
			data: { code: "APPROVAL_ALREADY_DECIDED" },
		});
	}

	await writeAuditAndActivity({
		organizationId: ctx.organizationId,
		actorUserId: ctx.userId,
		actorKind: "user",
		action:
			input.decision === "approved"
				? "version_approval.approved"
				: "version_approval.rejected",
		verb: input.decision === "approved" ? "approved" : "rejected",
		entityType: "version_approval",
		entityId: input.approvalId,
		changes: input.note ? { note: { from: null, to: input.note } } : undefined,
		activityData: {
			workflowId: row.workflowId,
			workflowVersionId: row.workflowVersionId,
			workflowVersionNumber: row.workflowVersionNumber,
		},
	});

	return {
		id: result.id,
		decision: input.decision,
		decidedAt: result.decidedAt,
	};
}

// ---------------------------------------------------------------------------
// getLatestApprovalStatus
// ---------------------------------------------------------------------------

export interface GetLatestApprovalStatusInput {
	workflowVersionId: string;
}

export async function getLatestApprovalStatus(
	ctx: ApprovalContext,
	input: GetLatestApprovalStatusInput,
): Promise<VersionApprovalRow | null> {
	// Cross-org check: we silently return null for foreign-org versions so
	// the UI doesn't need to distinguish "no approval" from "not yours."
	const bundle = await getVersionWithWorkflow(input.workflowVersionId);
	if (!bundle || bundle.workflow.organizationId !== ctx.organizationId) {
		return null;
	}
	return await getLatestApprovalForVersion({
		workflowVersionId: input.workflowVersionId,
	});
}

// ---------------------------------------------------------------------------
// listAllApprovalsForVersion (full history for the per-version detail view)
// ---------------------------------------------------------------------------

export async function listAllApprovalsForVersion(
	ctx: ApprovalContext,
	input: { workflowVersionId: string },
): Promise<VersionApprovalRow[]> {
	const bundle = await getVersionWithWorkflow(input.workflowVersionId);
	if (!bundle || bundle.workflow.organizationId !== ctx.organizationId) {
		return [];
	}
	return await listApprovalsForVersion({ workflowVersionId: input.workflowVersionId });
}

// ---------------------------------------------------------------------------
// listPending (dashboard)
// ---------------------------------------------------------------------------

export async function listPending(
	ctx: ApprovalContext,
	input: { limit?: number; offset?: number },
): Promise<{ rows: PendingApprovalRow[]; totalCount: number }> {
	return await listPendingApprovalsForOrg({
		organizationId: ctx.organizationId,
		limit: input.limit,
		offset: input.offset,
	});
}
