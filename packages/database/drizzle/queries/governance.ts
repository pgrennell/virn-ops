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

import { and, count, desc, eq } from "drizzle-orm";

import { db, type DbExecutor } from "../client";
import {
	acknowledgment,
	sopReadReceipt,
	user,
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
