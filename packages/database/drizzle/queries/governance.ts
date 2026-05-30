// packages/database/drizzle/queries/governance.ts
//
// Read-receipt queries for the Phase 10 / v1.5c reader-facing surface
// (PRD §6.4). The receipt is the passive "I've seen this SOP" signal --
// distinct from `acknowledgment` (active compliance sign-off; lives in the
// same schema file). Both surfaces will eventually share a unified read
// model for the compliance pack (Phase 15), but in v1.5c they stay
// separate per PRD §12.
//
// markAsRead is idempotent against the (workflowVersionId, userId) unique
// constraint -- re-marking a row you've already read returns the existing
// row's id without writing. The procedure layer relies on this so a
// distracted reader who clicks "mark as read" twice doesn't see an error.

import { and, count, desc, eq, sql } from "drizzle-orm";

import { db, type DbExecutor } from "../client";
import {
	acknowledgment,
	sopReadReceipt,
	suggestion,
	user,
	versionApproval,
	workflow,
	workflowVersion,
} from "../schema/postgres";

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface MarkAsReadInput {
	organizationId: string;
	workflowId: string;
	workflowVersionId: string;
	userId: string;
}

export interface MarkAsReadResult {
	id: string;
	readAt: Date;
	alreadyExisted: boolean;
}

/** Mark a workflow version as read by a user. Idempotent: if a receipt
 * already exists for (workflowVersionId, userId), returns it; otherwise
 * inserts a new one. The `alreadyExisted` flag lets the caller distinguish
 * a fresh read from a re-mark for telemetry / UX hints. */
export async function markWorkflowVersionAsRead(
	input: MarkAsReadInput,
	executor: DbExecutor = db,
): Promise<MarkAsReadResult> {
	const existing = await executor.query.sopReadReceipt.findFirst({
		where: (r, { and: a, eq: e }) =>
			a(e(r.workflowVersionId, input.workflowVersionId), e(r.userId, input.userId)),
		columns: { id: true, readAt: true },
	});
	if (existing) {
		return { id: existing.id, readAt: existing.readAt, alreadyExisted: true };
	}
	const [row] = await executor
		.insert(sopReadReceipt)
		.values({
			organizationId: input.organizationId,
			workflowId: input.workflowId,
			workflowVersionId: input.workflowVersionId,
			userId: input.userId,
		})
		.returning({ id: sopReadReceipt.id, readAt: sopReadReceipt.readAt });
	return { id: row.id, readAt: row.readAt, alreadyExisted: false };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Whether a specific user has read a specific workflow version. Drives the
 * Read view's "Mark as read" button state -- already-read renders the badge
 * instead of the button. */
export async function hasUserReadVersion(input: {
	workflowVersionId: string;
	userId: string;
}): Promise<{ id: string; readAt: Date } | null> {
	const row = await db.query.sopReadReceipt.findFirst({
		where: (r, { and: a, eq: e }) =>
			a(e(r.workflowVersionId, input.workflowVersionId), e(r.userId, input.userId)),
		columns: { id: true, readAt: true },
	});
	return row ?? null;
}

export interface ReadReceiptRow {
	id: string;
	userId: string;
	readAt: Date;
}

/** Admin-facing list of receipts for a specific version, newest first. Drives
 * the per-workflow "who's read this" display on the detail page. */
export async function listReadReceiptsForVersion(input: {
	workflowVersionId: string;
}): Promise<ReadReceiptRow[]> {
	const rows = await db
		.select({
			id: sopReadReceipt.id,
			userId: sopReadReceipt.userId,
			readAt: sopReadReceipt.readAt,
		})
		.from(sopReadReceipt)
		.where(eq(sopReadReceipt.workflowVersionId, input.workflowVersionId))
		.orderBy(desc(sopReadReceipt.readAt));
	return rows;
}

/** Aggregate read count for a version. Cheaper than listReadReceiptsForVersion
 * when the caller only needs the count for a badge. */
export async function countReadReceiptsForVersion(input: {
	workflowVersionId: string;
}): Promise<number> {
	const [row] = await db
		.select({ value: count() })
		.from(sopReadReceipt)
		.where(eq(sopReadReceipt.workflowVersionId, input.workflowVersionId));
	return row?.value ?? 0;
}

/** All versions of a workflow that a user has read. Used by the /sop index
 * to flag "read" state on workflows the current user has seen any version
 * of (a passive "I've seen any version of this SOP" signal). */
export async function listVersionIdsReadByUserForWorkflow(input: {
	workflowId: string;
	userId: string;
}): Promise<string[]> {
	const rows = await db
		.select({ workflowVersionId: sopReadReceipt.workflowVersionId })
		.from(sopReadReceipt)
		.where(
			and(
				eq(sopReadReceipt.workflowId, input.workflowId),
				eq(sopReadReceipt.userId, input.userId),
			),
		);
	return rows.map((r) => r.workflowVersionId);
}

// ---------------------------------------------------------------------------
// Acknowledgment reads (Phase 15 -- compliance / evidence surface)
//
// Surface what the data already supports: a list view + a single receipt view
// over `acknowledgment` rows joined with workflow + version + user. WRITE path
// (the "Acknowledge" action) is Phase 16's governance flows; Phase 15 is
// read-only evidence.
// ---------------------------------------------------------------------------

export interface AcknowledgmentListRow {
	id: string;
	acknowledgedAt: Date;
	workflowId: string;
	workflowTitle: string;
	workflowVersionId: string;
	workflowVersionNumber: number;
	userId: string;
	userName: string | null;
	userEmail: string;
}

export interface AcknowledgmentListResult {
	rows: AcknowledgmentListRow[];
	totalCount: number;
}

/** Page through every acknowledgment in an org, newest first. Joins workflow +
 * workflowVersion + user inline so the compliance index doesn't N+1. Parallel
 * COUNT for pagination. */
export async function listAcknowledgmentsForOrg(input: {
	organizationId: string;
	limit?: number;
	offset?: number;
}): Promise<AcknowledgmentListResult> {
	const limit = input.limit ?? 25;
	const offset = input.offset ?? 0;
	const where = eq(acknowledgment.organizationId, input.organizationId);

	const [rows, totalRow] = await Promise.all([
		db
			.select({
				id: acknowledgment.id,
				acknowledgedAt: acknowledgment.acknowledgedAt,
				workflowId: workflow.id,
				workflowTitle: workflow.title,
				workflowVersionId: workflowVersion.id,
				workflowVersionNumber: workflowVersion.versionNumber,
				userId: user.id,
				userName: user.name,
				userEmail: user.email,
			})
			.from(acknowledgment)
			.innerJoin(workflowVersion, eq(workflowVersion.id, acknowledgment.workflowVersionId))
			.innerJoin(workflow, eq(workflow.id, workflowVersion.workflowId))
			.innerJoin(user, eq(user.id, acknowledgment.userId))
			.where(where)
			.orderBy(desc(acknowledgment.acknowledgedAt))
			.limit(limit)
			.offset(offset),
		db
			.select({ value: count() })
			.from(acknowledgment)
			.where(where)
			.then((r) => r[0] ?? { value: 0 }),
	]);

	return {
		rows: rows.map((r) => ({
			id: r.id,
			acknowledgedAt: r.acknowledgedAt,
			workflowId: r.workflowId,
			workflowTitle: r.workflowTitle,
			workflowVersionId: r.workflowVersionId,
			workflowVersionNumber: r.workflowVersionNumber,
			userId: r.userId,
			userName: r.userName,
			userEmail: r.userEmail,
		})),
		totalCount: Number(totalRow.value),
	};
}

export interface AcknowledgmentReceipt extends AcknowledgmentListRow {
	organizationName: string;
	workflowDescription: string | null;
	workflowType: "procedure" | "document" | "policy" | "form";
}

// ---------------------------------------------------------------------------
// Acknowledgment writes (Phase 16 -- governance flows, WRITE side)
//
// Idempotent against the unique constraint on (workflow_version_id, user_id).
// The procedure layer is responsible for org-scope + capability + published-
// status checks; this query trusts its inputs.
// ---------------------------------------------------------------------------

export interface AcknowledgeInput {
	organizationId: string;
	workflowVersionId: string;
	userId: string;
}

export interface AcknowledgeResult {
	id: string;
	acknowledgedAt: Date;
	alreadyExisted: boolean;
}

/** Insert an acknowledgment row, or return the existing row if (version, user)
 * is already present. The unique constraint is the idempotency guarantee --
 * we don't race against another writer that might insert between the SELECT
 * and the INSERT because the constraint will refuse the second insert. */
export async function acknowledgeWorkflowVersion(
	input: AcknowledgeInput,
	executor: DbExecutor = db,
): Promise<AcknowledgeResult> {
	const existing = await executor.query.acknowledgment.findFirst({
		where: (a, { and: aOp, eq: e }) =>
			aOp(e(a.workflowVersionId, input.workflowVersionId), e(a.userId, input.userId)),
		columns: { id: true, acknowledgedAt: true },
	});
	if (existing) {
		return {
			id: existing.id,
			acknowledgedAt: existing.acknowledgedAt,
			alreadyExisted: true,
		};
	}
	const [row] = await executor
		.insert(acknowledgment)
		.values({
			organizationId: input.organizationId,
			workflowVersionId: input.workflowVersionId,
			userId: input.userId,
		})
		.returning({ id: acknowledgment.id, acknowledgedAt: acknowledgment.acknowledgedAt });
	return { id: row.id, acknowledgedAt: row.acknowledgedAt, alreadyExisted: false };
}

/** Has a specific user acknowledged a specific version? Drives the Read view's
 * "Acknowledge" button state -- when present, render the badge instead of
 * the button (mirrors hasUserReadVersion's shape for the passive read signal). */
export async function hasUserAcknowledgedVersion(input: {
	workflowVersionId: string;
	userId: string;
}): Promise<{ id: string; acknowledgedAt: Date } | null> {
	const row = await db.query.acknowledgment.findFirst({
		where: (a, { and: aOp, eq: e }) =>
			aOp(e(a.workflowVersionId, input.workflowVersionId), e(a.userId, input.userId)),
		columns: { id: true, acknowledgedAt: true },
	});
	return row ?? null;
}

// ---------------------------------------------------------------------------
// Version approval writes + reads (Phase 16 -- governance flows)
//
// version_approval is per-version + append-only on insert; the `decision`
// column transitions pending -> approved/rejected exactly once (the audit log
// keeps the transition history). The procedure layer is responsible for org-
// scope + capability + role gating; queries trust their inputs.
// ---------------------------------------------------------------------------

export interface VersionApprovalRow {
	id: string;
	workflowVersionId: string;
	requestedBy: string | null;
	requestedByName: string | null;
	requestedByEmail: string | null;
	approverId: string | null;
	approverName: string | null;
	approverEmail: string | null;
	decision: "pending" | "approved" | "rejected";
	note: string | null;
	decidedAt: Date | null;
	createdAt: Date;
}

export interface RequestVersionApprovalInput {
	workflowVersionId: string;
	requestedByUserId: string;
	approverId?: string | null;
}

/** Insert a pending approval row. Caller is responsible for refusing the
 * insert when a pending row already exists for the version (the procedure
 * layer pre-checks via getLatestApprovalForVersion). */
export async function insertVersionApproval(
	input: RequestVersionApprovalInput,
	executor: DbExecutor = db,
): Promise<{ id: string; createdAt: Date }> {
	const [row] = await executor
		.insert(versionApproval)
		.values({
			workflowVersionId: input.workflowVersionId,
			requestedBy: input.requestedByUserId,
			approverId: input.approverId ?? null,
		})
		.returning({ id: versionApproval.id, createdAt: versionApproval.createdAt });
	return row;
}

export interface DecideVersionApprovalInput {
	approvalId: string;
	approverUserId: string;
	decision: "approved" | "rejected";
	note?: string | null;
}

/** Transition pending -> approved/rejected. The WHERE clause matches
 * `decision = 'pending'` so a concurrent decider can't double-decide; the
 * second writer matches zero rows and returns null. */
export async function decideVersionApprovalRow(
	input: DecideVersionApprovalInput,
	executor: DbExecutor = db,
): Promise<{ id: string; decidedAt: Date } | null> {
	const result = await executor
		.update(versionApproval)
		.set({
			decision: input.decision,
			approverId: input.approverUserId,
			note: input.note ?? null,
			decidedAt: new Date(),
		})
		.where(
			and(eq(versionApproval.id, input.approvalId), eq(versionApproval.decision, "pending")),
		)
		.returning({ id: versionApproval.id, decidedAt: versionApproval.decidedAt });
	const row = result[0];
	if (!row || !row.decidedAt) return null;
	return { id: row.id, decidedAt: row.decidedAt };
}

/** All approval rows for a version, joined with requester + approver user
 * names. Newest first. Used by the per-version detail surface and -- with a
 * limit of 1 -- the workflow detail chip. */
export async function listApprovalsForVersion(input: {
	workflowVersionId: string;
}): Promise<VersionApprovalRow[]> {
	const requesterUser = { id: "requester" };
	void requesterUser; // documentation hint -- the alias-by-join is explicit below.

	const rows = await db
		.select({
			id: versionApproval.id,
			workflowVersionId: versionApproval.workflowVersionId,
			requestedBy: versionApproval.requestedBy,
			requestedByName: sql<string | null>`requester.name`.as("requester_name"),
			requestedByEmail: sql<string | null>`requester.email`.as("requester_email"),
			approverId: versionApproval.approverId,
			approverName: sql<string | null>`approver.name`.as("approver_name"),
			approverEmail: sql<string | null>`approver.email`.as("approver_email"),
			decision: versionApproval.decision,
			note: versionApproval.note,
			decidedAt: versionApproval.decidedAt,
			createdAt: versionApproval.createdAt,
		})
		.from(versionApproval)
		.leftJoin(sql`"user" AS requester`, sql`requester.id = ${versionApproval.requestedBy}`)
		.leftJoin(sql`"user" AS approver`, sql`approver.id = ${versionApproval.approverId}`)
		.where(eq(versionApproval.workflowVersionId, input.workflowVersionId))
		.orderBy(desc(versionApproval.createdAt));
	return rows;
}

/** Newest approval row for the version, or null. Drives the Builder header
 * chip state (no row = "Request approval" button; pending = "Awaiting
 * approval" badge; approved/rejected = decision display). */
export async function getLatestApprovalForVersion(input: {
	workflowVersionId: string;
}): Promise<VersionApprovalRow | null> {
	const rows = await listApprovalsForVersion(input);
	return rows[0] ?? null;
}

/** Boolean for the publish gate. True iff there's at least one approval row
 * for this version with decision='approved'. */
export async function hasApprovedApprovalForVersion(
	workflowVersionId: string,
	executor: DbExecutor = db,
): Promise<boolean> {
	const rows = await executor
		.select({ id: versionApproval.id })
		.from(versionApproval)
		.where(
			and(
				eq(versionApproval.workflowVersionId, workflowVersionId),
				eq(versionApproval.decision, "approved"),
			),
		)
		.limit(1);
	return rows.length > 0;
}

export interface PendingApprovalRow {
	id: string;
	workflowVersionId: string;
	workflowId: string;
	workflowTitle: string;
	workflowVersionNumber: number;
	requestedBy: string | null;
	requestedByName: string | null;
	requestedByEmail: string | null;
	createdAt: Date;
}

// ---------------------------------------------------------------------------
// Suggestion writes + reads (Phase 16 -- governance flows)
//
// Suggestions are improvement feedback against a workflow (not a version --
// the schema FK is workflow_id). Status lifecycle: open -> accepted /
// rejected / merged. Documented exception to Invariant #6 (append-only):
// status mutates, but resolvedBy + resolvedAt are write-once at resolution
// time so the closure is auditable.
// ---------------------------------------------------------------------------

export interface SuggestionRow {
	id: string;
	workflowId: string;
	workflowTitle: string;
	suggestedBy: string | null;
	suggestedByName: string | null;
	suggestedByEmail: string | null;
	body: string;
	status: "open" | "accepted" | "rejected" | "merged";
	resolvedBy: string | null;
	resolvedByName: string | null;
	resolvedAt: Date | null;
	createdAt: Date;
}

export interface InsertSuggestionInput {
	organizationId: string;
	workflowId: string;
	suggestedByUserId: string;
	body: string;
}

export async function insertSuggestion(
	input: InsertSuggestionInput,
	executor: DbExecutor = db,
): Promise<{ id: string; createdAt: Date }> {
	const [row] = await executor
		.insert(suggestion)
		.values({
			organizationId: input.organizationId,
			workflowId: input.workflowId,
			suggestedBy: input.suggestedByUserId,
			body: input.body,
		})
		.returning({ id: suggestion.id, createdAt: suggestion.createdAt });
	return row;
}

export interface ListSuggestionsForOrgInput {
	organizationId: string;
	workflowId?: string;
	status?: "open" | "accepted" | "rejected" | "merged";
	limit?: number;
	offset?: number;
}

/** Org-wide suggestions list, joined with workflow + suggester user inline.
 * Newest open first; resolved drop to the bottom. Optional workflowId +
 * status filters. */
export async function listSuggestionsForOrg(
	input: ListSuggestionsForOrgInput,
): Promise<{ rows: SuggestionRow[]; totalCount: number }> {
	const limit = input.limit ?? 50;
	const offset = input.offset ?? 0;

	const conds = [eq(suggestion.organizationId, input.organizationId)];
	if (input.workflowId) conds.push(eq(suggestion.workflowId, input.workflowId));
	if (input.status) conds.push(eq(suggestion.status, input.status));
	const where = and(...conds);

	const [rows, totalRow] = await Promise.all([
		db
			.select({
				id: suggestion.id,
				workflowId: workflow.id,
				workflowTitle: workflow.title,
				suggestedBy: suggestion.suggestedBy,
				suggestedByName: sql<string | null>`suggester.name`.as("suggester_name"),
				suggestedByEmail: sql<string | null>`suggester.email`.as("suggester_email"),
				body: suggestion.body,
				status: suggestion.status,
				resolvedBy: suggestion.resolvedBy,
				resolvedByName: sql<string | null>`resolver.name`.as("resolver_name"),
				resolvedAt: suggestion.resolvedAt,
				createdAt: suggestion.createdAt,
			})
			.from(suggestion)
			.innerJoin(workflow, eq(workflow.id, suggestion.workflowId))
			.leftJoin(sql`"user" AS suggester`, sql`suggester.id = ${suggestion.suggestedBy}`)
			.leftJoin(sql`"user" AS resolver`, sql`resolver.id = ${suggestion.resolvedBy}`)
			.where(where)
			.orderBy(desc(suggestion.createdAt))
			.limit(limit)
			.offset(offset),
		db
			.select({ value: count() })
			.from(suggestion)
			.where(where)
			.then((r) => r[0] ?? { value: 0 }),
	]);

	return {
		rows: rows.map((r) => ({
			id: r.id,
			workflowId: r.workflowId,
			workflowTitle: r.workflowTitle,
			suggestedBy: r.suggestedBy,
			suggestedByName: r.suggestedByName,
			suggestedByEmail: r.suggestedByEmail,
			body: r.body,
			status: r.status,
			resolvedBy: r.resolvedBy,
			resolvedByName: r.resolvedByName,
			resolvedAt: r.resolvedAt,
			createdAt: r.createdAt,
		})),
		totalCount: Number(totalRow.value),
	};
}

/** Single-row pre-check for the decide path: validates the suggestion
 * belongs to the org. Returns the joined workflowId so the caller can
 * attribute the audit row through. */
export async function getSuggestionForOrg(input: {
	organizationId: string;
	suggestionId: string;
}): Promise<{
	id: string;
	workflowId: string;
	status: "open" | "accepted" | "rejected" | "merged";
	body: string;
} | null> {
	const rows = await db
		.select({
			id: suggestion.id,
			workflowId: suggestion.workflowId,
			status: suggestion.status,
			body: suggestion.body,
		})
		.from(suggestion)
		.where(
			and(
				eq(suggestion.id, input.suggestionId),
				eq(suggestion.organizationId, input.organizationId),
			),
		)
		.limit(1);
	return rows[0] ?? null;
}

export interface UpdateSuggestionStatusInput {
	suggestionId: string;
	status: "accepted" | "rejected" | "merged";
	resolvedByUserId: string;
}

/** Transition open -> accepted/rejected/merged. The WHERE clause matches
 * `status = 'open'` so a concurrent decider can't double-decide. */
export async function updateSuggestionStatus(
	input: UpdateSuggestionStatusInput,
	executor: DbExecutor = db,
): Promise<{ id: string; resolvedAt: Date } | null> {
	const result = await executor
		.update(suggestion)
		.set({
			status: input.status,
			resolvedBy: input.resolvedByUserId,
			resolvedAt: new Date(),
		})
		.where(and(eq(suggestion.id, input.suggestionId), eq(suggestion.status, "open")))
		.returning({ id: suggestion.id, resolvedAt: suggestion.resolvedAt });
	const row = result[0];
	if (!row || !row.resolvedAt) return null;
	return { id: row.id, resolvedAt: row.resolvedAt };
}

/** Single-row pre-check for the decide path. Returns the joined workflow
 * context only when the approval belongs to the org. Used to validate
 * cross-org access BEFORE the UPDATE -- the UPDATE itself only checks
 * pending status, not org. */
export async function getApprovalRowForOrg(input: {
	organizationId: string;
	approvalId: string;
}): Promise<{
	id: string;
	workflowId: string;
	workflowVersionId: string;
	workflowVersionNumber: number;
	decision: "pending" | "approved" | "rejected";
} | null> {
	const rows = await db
		.select({
			id: versionApproval.id,
			workflowId: workflow.id,
			workflowVersionId: versionApproval.workflowVersionId,
			workflowVersionNumber: workflowVersion.versionNumber,
			decision: versionApproval.decision,
		})
		.from(versionApproval)
		.innerJoin(workflowVersion, eq(workflowVersion.id, versionApproval.workflowVersionId))
		.innerJoin(workflow, eq(workflow.id, workflowVersion.workflowId))
		.where(
			and(
				eq(versionApproval.id, input.approvalId),
				eq(workflow.organizationId, input.organizationId),
			),
		)
		.limit(1);
	return rows[0] ?? null;
}

/** Org-wide pending approvals list. Drives the /compliance/approvals
 * dashboard. Joins workflow + version + requester user inline so the
 * dashboard doesn't N+1. Oldest first so reviewers work the queue from
 * the bottom. */
export async function listPendingApprovalsForOrg(input: {
	organizationId: string;
	limit?: number;
	offset?: number;
}): Promise<{ rows: PendingApprovalRow[]; totalCount: number }> {
	const limit = input.limit ?? 50;
	const offset = input.offset ?? 0;

	const where = and(
		eq(workflow.organizationId, input.organizationId),
		eq(versionApproval.decision, "pending"),
	);

	const [rows, totalRow] = await Promise.all([
		db
			.select({
				id: versionApproval.id,
				workflowVersionId: versionApproval.workflowVersionId,
				workflowId: workflow.id,
				workflowTitle: workflow.title,
				workflowVersionNumber: workflowVersion.versionNumber,
				requestedBy: versionApproval.requestedBy,
				requestedByName: user.name,
				requestedByEmail: user.email,
				createdAt: versionApproval.createdAt,
			})
			.from(versionApproval)
			.innerJoin(workflowVersion, eq(workflowVersion.id, versionApproval.workflowVersionId))
			.innerJoin(workflow, eq(workflow.id, workflowVersion.workflowId))
			.leftJoin(user, eq(user.id, versionApproval.requestedBy))
			.where(where)
			.orderBy(versionApproval.createdAt)
			.limit(limit)
			.offset(offset),
		db
			.select({ value: count() })
			.from(versionApproval)
			.innerJoin(workflowVersion, eq(workflowVersion.id, versionApproval.workflowVersionId))
			.innerJoin(workflow, eq(workflow.id, workflowVersion.workflowId))
			.where(where)
			.then((r) => r[0] ?? { value: 0 }),
	]);

	return {
		rows: rows.map((r) => ({
			id: r.id,
			workflowVersionId: r.workflowVersionId,
			workflowId: r.workflowId,
			workflowTitle: r.workflowTitle,
			workflowVersionNumber: r.workflowVersionNumber,
			requestedBy: r.requestedBy,
			requestedByName: r.requestedByName,
			requestedByEmail: r.requestedByEmail,
			createdAt: r.createdAt,
		})),
		totalCount: Number(totalRow.value),
	};
}

/** Single-receipt fetch for /compliance/acknowledgments/[id]. Org-scoped:
 * returns null when the ack belongs to another org so the procedure can refuse
 * with NOT_FOUND rather than leaking presence. */
export async function getAcknowledgmentForOrg(input: {
	organizationId: string;
	acknowledgmentId: string;
}): Promise<AcknowledgmentReceipt | null> {
	const rows = await db
		.select({
			id: acknowledgment.id,
			acknowledgedAt: acknowledgment.acknowledgedAt,
			workflowId: workflow.id,
			workflowTitle: workflow.title,
			workflowDescription: workflow.description,
			workflowType: workflow.type,
			workflowVersionId: workflowVersion.id,
			workflowVersionNumber: workflowVersion.versionNumber,
			userId: user.id,
			userName: user.name,
			userEmail: user.email,
			organizationName: workflow.organizationId, // overwritten below via a second fetch
		})
		.from(acknowledgment)
		.innerJoin(workflowVersion, eq(workflowVersion.id, acknowledgment.workflowVersionId))
		.innerJoin(workflow, eq(workflow.id, workflowVersion.workflowId))
		.innerJoin(user, eq(user.id, acknowledgment.userId))
		.where(
			and(
				eq(acknowledgment.id, input.acknowledgmentId),
				eq(acknowledgment.organizationId, input.organizationId),
			),
		)
		.limit(1);
	const r = rows[0];
	if (!r) return null;

	// Organization name lookup -- the join above returned the FK; we want the
	// display name for the receipt header. Cheap second fetch keeps the primary
	// query narrow (no extra LEFT JOIN cost when most callers just need the ack).
	const orgRow = await db.query.organization.findFirst({
		where: (o, { eq: e }) => e(o.id, input.organizationId),
		columns: { name: true },
	});

	return {
		id: r.id,
		acknowledgedAt: r.acknowledgedAt,
		workflowId: r.workflowId,
		workflowTitle: r.workflowTitle,
		workflowDescription: r.workflowDescription,
		workflowType: r.workflowType,
		workflowVersionId: r.workflowVersionId,
		workflowVersionNumber: r.workflowVersionNumber,
		userId: r.userId,
		userName: r.userName,
		userEmail: r.userEmail,
		organizationName: orgRow?.name ?? "Unknown organization",
	};
}
