// packages/database/drizzle/queries/cross-product-events.ts
//
// Transactional outbox writes for cross-product webhook events (Phase 11a
// step 3c part 2). All enqueues happen INSIDE the same DB transaction as the
// state-write that generated the event, so a `run.completed` outbox row
// exists if and only if the run actually transitioned to completed.
//
// The delivery worker (step 3c part 3) drains the outbox; this module never
// performs HTTP.

import { createId } from "@paralleldrive/cuid2";
import { eq, sql } from "drizzle-orm";

import { db, type DbExecutor } from "../client";
import {
	crossProductEventOrgSequence,
	crossProductEventOutbox,
	run,
} from "../schema/postgres";

// V1 ships a single consumer product. When future consumers (mobile app,
// partner integrations) register, the enqueue helper will fan out one outbox
// row per subscribed consumer. Today the run callback model is PM-only.
const V1_CONSUMER_PRODUCT = "virn-pm" as const;

/** The catalog event types Ops emits to cross-product consumers. Free text on
 * the DB row (schema) so adding a new event in a cross-repo agreement doesn't
 * require an ALTER TYPE; the union here is what the helper accepts. */
export type CrossProductEventType =
	| "run.state_changed"
	| "run.completed"
	| "run.comment_added"
	| "vendor.upserted";

export interface EnqueueCrossProductEventForRunInput {
	runId: string;
	eventType: Extract<
		CrossProductEventType,
		"run.state_changed" | "run.completed" | "run.comment_added"
	>;
	/** Wall-clock time the source-of-truth event happened. Threaded through the
	 * payload so PM sees the event-occurred timestamp, not the enqueue or
	 * delivery timestamp. Defaults to `new Date()` when the call site doesn't
	 * have a more authoritative value. */
	occurredAt?: Date;
	/** For run.state_changed events. Both optional so call sites that only know
	 * one side (e.g. "we just completed") can still emit. */
	previousStatus?: string | null;
	currentStatus?: string | null;
	/** D-027 cross-product attribution. Threaded into payload so PM sees who
	 * triggered the change (`virn-pm` when PM-as-agent caused it, null for
	 * Ops-originated). */
	crossProductOrigin?: string | null;
}

export interface EnqueueResult {
	/** Outbox row id; doubles as the wire eventId PM stores for idempotency
	 * dedup. */
	id: string;
	sequenceNumber: number;
}

/** Enqueue a cross-product event for the given run. Returns null when the
 * event should not be emitted -- this happens for two reasons:
 *
 *   1. The run was not launched cross-product (no callback_pm_* columns set).
 *      No consumer is correlating against this run's id, so dropping the
 *      event saves storage + delivery work.
 *   2. The run's callback_webhook_events filter is non-null and doesn't
 *      include this eventType. The launch caller asked for a narrow set; we
 *      respect it.
 *
 * Throws if the run doesn't exist -- a caller asking us to enqueue for an
 * unknown run is a programming error, not a normal control-flow case.
 *
 * The caller is responsible for running this INSIDE the same transaction as
 * the state-write that produced the event. Outside-transaction enqueues
 * compromise the "exactly-once" semantic the outbox pattern exists to
 * guarantee. */
export async function enqueueCrossProductEventForRun(
	args: EnqueueCrossProductEventForRunInput,
	executor: DbExecutor = db,
): Promise<EnqueueResult | null> {
	// 1. Pull the run's callback + identity columns. We read inside the same
	//    tx so we observe any callback changes from earlier in the
	//    transaction.
	const runRow = await executor.query.run.findFirst({
		where: (r, { and: a, eq: e, isNull }) => a(e(r.id, args.runId), isNull(r.deletedAt)),
		columns: {
			id: true,
			organizationId: true,
			title: true,
			workflowId: true,
			workflowVersionId: true,
			callbackPmServiceRequestId: true,
			callbackPmWorkOrderId: true,
			callbackWebhookEvents: true,
		},
	});
	if (!runRow) {
		throw new Error(
			`enqueueCrossProductEventForRun: run not found (runId=${args.runId}). Caller invariant violated -- the run must exist at enqueue time.`,
		);
	}

	// 2. Skip-conditions before any write. The two paths below are the only
	//    legitimate "no-op" reasons; everything else writes an outbox row.
	const hasCallback =
		runRow.callbackPmServiceRequestId !== null || runRow.callbackPmWorkOrderId !== null;
	if (!hasCallback) return null;
	const filter = runRow.callbackWebhookEvents;
	if (filter !== null && !filter.includes(args.eventType)) return null;

	const occurredAt = args.occurredAt ?? new Date();
	const eventId = createId();

	// 3. Bump the per-org sequence atomically. The ON CONFLICT branch runs when
	//    a row already exists (every org after the first event). RETURNING
	//    last_seq always returns the post-update value, so we get the just-
	//    assigned sequence regardless of which branch fired.
	const seqRows = await executor
		.insert(crossProductEventOrgSequence)
		.values({
			organizationId: runRow.organizationId,
			lastSeq: 1,
		})
		.onConflictDoUpdate({
			target: crossProductEventOrgSequence.organizationId,
			set: {
				lastSeq: sql`${crossProductEventOrgSequence.lastSeq} + 1`,
			},
		})
		.returning({ lastSeq: crossProductEventOrgSequence.lastSeq });
	const sequenceNumber = Number(seqRows[0].lastSeq);

	// 4. Build the sealed payload. The delivery worker POSTs this verbatim
	//    (after computing the HMAC over body + timestamp). Re-deriving any
	//    field at drain time would invite drift.
	const payload: Record<string, unknown> = {
		eventId,
		sequenceNumber,
		eventType: args.eventType,
		occurredAt: occurredAt.toISOString(),
		organizationId: runRow.organizationId,
		runId: runRow.id,
		runTitle: runRow.title,
		workflowId: runRow.workflowId,
		workflowVersionId: runRow.workflowVersionId,
		crossProductOrigin: args.crossProductOrigin ?? null,
		callback: {
			pmServiceRequestId: runRow.callbackPmServiceRequestId,
			pmWorkOrderId: runRow.callbackPmWorkOrderId,
		},
	};
	if (args.previousStatus !== undefined) payload.previousStatus = args.previousStatus;
	if (args.currentStatus !== undefined) payload.currentStatus = args.currentStatus;

	// 5. Insert the outbox row. Status starts as `pending` with next_attempt_at
	//    = now() so the next worker poll picks it up immediately. The delivery
	//    worker (step 3c part 3) handles claim semantics.
	await executor.insert(crossProductEventOutbox).values({
		id: eventId,
		organizationId: runRow.organizationId,
		sequenceNumber,
		eventType: args.eventType,
		consumerProduct: V1_CONSUMER_PRODUCT,
		runId: runRow.id,
		vendorId: null,
		callbackPmServiceRequestId: runRow.callbackPmServiceRequestId,
		callbackPmWorkOrderId: runRow.callbackPmWorkOrderId,
		payload,
		nextAttemptAt: occurredAt,
	});

	return { id: eventId, sequenceNumber };
}

/** Forensic read for the admin UI / debug tooling: list outbox rows for one
 * run, newest first. Not part of the delivery hot path. */
export async function listOutboxEventsForRun(
	organizationId: string,
	runId: string,
): Promise<(typeof crossProductEventOutbox.$inferSelect)[]> {
	return await db
		.select()
		.from(crossProductEventOutbox)
		.where(
			sql`${crossProductEventOutbox.organizationId} = ${organizationId} and ${crossProductEventOutbox.runId} = ${runId}`,
		)
		.orderBy(sql`${crossProductEventOutbox.sequenceNumber} desc`);
}

// Suppress an unused-import warning when the run table relation is only used
// via `executor.query.run.findFirst` -- we still need the symbol referenced so
// tree-shaking doesn't drop the relation registration.
void run;
