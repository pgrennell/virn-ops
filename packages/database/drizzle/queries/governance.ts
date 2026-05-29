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
import { sopReadReceipt } from "../schema/postgres";

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
