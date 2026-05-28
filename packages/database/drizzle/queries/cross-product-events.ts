// packages/database/drizzle/queries/cross-product-events.ts
//
// Outbox writes for cross-product webhook events (Phase 11a step 3c part 2).
// The delivery worker (step 3c part 3) drains the outbox; this module never
// performs HTTP.
//
// Two enqueue helpers with different transactionality posture:
//   - enqueueCrossProductEventForRun: meant to be called INSIDE the same
//     transaction as the state-write that generated the event (e.g. inside
//     complete-step.ts's withTransaction block), so a `run.completed` outbox
//     row exists if and only if the run actually transitioned to completed.
//   - enqueueCrossProductEventForVendor: fans out to every active consumer
//     for the org. v1 vendor write paths don't run inside a transaction (the
//     existing audit/activity writes don't either), so this helper accepts
//     the small inconsistency window -- a crash between vendor.update and
//     enqueue means the consumer misses the event. Matches the existing
//     non-transactional audit pattern; a future refactor can wrap the whole
//     vendor surface in a tx without changing this signature.

import { createId } from "@paralleldrive/cuid2";
import { and, eq, isNull, sql } from "drizzle-orm";

import { db, type DbExecutor } from "../client";
import {
	crossProductEventOrgSequence,
	crossProductEventOutbox,
	outboundWebhookCredential,
	run,
	vendor,
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

export interface EnqueueCrossProductEventForVendorInput {
	vendorId: string;
	eventType: Extract<CrossProductEventType, "vendor.upserted">;
	occurredAt?: Date;
	crossProductOrigin?: string | null;
}

export interface VendorEnqueueResult {
	id: string;
	sequenceNumber: number;
	consumerProduct: string;
}

/** Enqueue a vendor lifecycle event. Fans out across every active consumer
 * registered for the vendor's org; returns one result entry per outbox row
 * written. Returns `[]` when the org has no active consumers (nobody's
 * listening). Throws if the vendor doesn't exist.
 *
 * Unlike `enqueueCrossProductEventForRun`, this helper is NOT meant to live
 * inside a transaction with the vendor write today -- the existing vendor
 * write paths (procedures/create.ts, procedures/update.ts) call this AFTER
 * their non-transactional audit/activity writes. A future refactor that wraps
 * the vendor surface in `withTransaction` should thread `executor` through
 * this call too; the signature already accepts it. */
export async function enqueueCrossProductEventForVendor(
	args: EnqueueCrossProductEventForVendorInput,
	executor: DbExecutor = db,
): Promise<VendorEnqueueResult[]> {
	// 1. Pull the vendor's identity columns. Soft-deleted rows are excluded --
	//    a hard-deleted vendor shouldn't fire an upsert event (the caller is a
	//    bug if that happens).
	const vendorRow = await executor.query.vendor.findFirst({
		where: (v, { and: a, eq: e, isNull: n }) => a(e(v.id, args.vendorId), n(v.deletedAt)),
		columns: {
			id: true,
			organizationId: true,
			name: true,
			description: true,
			categoryId: true,
			status: true,
			isActive: true,
		},
	});
	if (!vendorRow) {
		throw new Error(
			`enqueueCrossProductEventForVendor: vendor not found (vendorId=${args.vendorId}).`,
		);
	}

	// 2. Find active consumers for this org. No active consumers means nobody's
	//    listening -- skip the writes entirely. The credential-active flag is
	//    flipped by softDelete (sets is_active=false) so the same query
	//    excludes soft-deleted rows via the partial check.
	const consumers = await executor
		.select({ id: outboundWebhookCredential.id, consumerProduct: outboundWebhookCredential.consumerProduct })
		.from(outboundWebhookCredential)
		.where(
			and(
				eq(outboundWebhookCredential.organizationId, vendorRow.organizationId),
				eq(outboundWebhookCredential.isActive, true),
				isNull(outboundWebhookCredential.deletedAt),
			),
		);
	if (consumers.length === 0) return [];

	const occurredAt = args.occurredAt ?? new Date();
	const results: VendorEnqueueResult[] = [];

	// 3. Bump-and-insert per consumer. Sequence is shared across consumers per
	//    org (v1 limitation -- with multiple consumers their individual
	//    sequence streams have gaps; revisit when a second consumer ships).
	for (const consumer of consumers) {
		const eventId = createId();
		const seqRows = await executor
			.insert(crossProductEventOrgSequence)
			.values({
				organizationId: vendorRow.organizationId,
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

		const payload: Record<string, unknown> = {
			eventId,
			sequenceNumber,
			eventType: args.eventType,
			occurredAt: occurredAt.toISOString(),
			organizationId: vendorRow.organizationId,
			vendorId: vendorRow.id,
			vendorName: vendorRow.name,
			vendorStatus: vendorRow.status,
			vendorIsActive: vendorRow.isActive,
			vendorCategoryId: vendorRow.categoryId,
			crossProductOrigin: args.crossProductOrigin ?? null,
		};

		await executor.insert(crossProductEventOutbox).values({
			id: eventId,
			organizationId: vendorRow.organizationId,
			sequenceNumber,
			eventType: args.eventType,
			consumerProduct: consumer.consumerProduct,
			runId: null,
			vendorId: vendorRow.id,
			callbackPmServiceRequestId: null,
			callbackPmWorkOrderId: null,
			payload,
			nextAttemptAt: occurredAt,
		});

		results.push({ id: eventId, sequenceNumber, consumerProduct: consumer.consumerProduct });
	}

	return results;
}

// ---------------------------------------------------------------------------
// Delivery worker (Phase 11a step 3c part 2 step 3) -- claim + mark helpers.
// The orchestrator lives in packages/api/modules/integrations/lib; this module
// owns the SQL for atomic state transitions.
// ---------------------------------------------------------------------------

export interface ClaimedOutboxRow {
	id: string;
	organizationId: string;
	consumerProduct: string;
	eventType: string;
	payload: Record<string, unknown>;
	attemptCount: number;
}

/** Atomically claim a batch of pending outbox rows. Uses
 * `FOR UPDATE SKIP LOCKED` so concurrent workers each get a disjoint slice
 * without blocking on each other. The UPDATE flips status to 'delivering' and
 * bumps attempt_count in the same statement; if delivery succeeds the row
 * goes to 'delivered', otherwise back to 'pending' (with backoff) or 'dead'
 * via the marker helpers below.
 *
 * Returns the claimed rows' delivery-relevant columns -- enough to compute
 * the HMAC + POST without re-reading. */
export async function claimNextOutboxBatch(input: {
	now: Date;
	batchSize: number;
}): Promise<ClaimedOutboxRow[]> {
	// Raw SQL because the CTE + FOR UPDATE SKIP LOCKED + UPDATE...FROM pattern
	// isn't ergonomic through Drizzle's query builder. Mirrors the inline-raw
	// approach `listWorkflowsForEntity` uses for its Postgres-specific operators.
	const result = await db.execute(sql`
		WITH claimed AS (
			SELECT id FROM cross_product_event_outbox
			WHERE status = 'pending'
			  AND next_attempt_at <= ${input.now}
			ORDER BY next_attempt_at ASC
			LIMIT ${input.batchSize}
			FOR UPDATE SKIP LOCKED
		)
		UPDATE cross_product_event_outbox o
		SET status = 'delivering',
		    attempt_count = o.attempt_count + 1,
		    updated_at = now()
		FROM claimed
		WHERE o.id = claimed.id
		RETURNING o.id,
		          o.organization_id,
		          o.consumer_product,
		          o.event_type,
		          o.payload,
		          o.attempt_count
	`);

	const rows = (result as unknown as { rows: Array<Record<string, unknown>> }).rows;
	return rows.map((r) => ({
		id: r.id as string,
		organizationId: r.organization_id as string,
		consumerProduct: r.consumer_product as string,
		eventType: r.event_type as string,
		payload: r.payload as Record<string, unknown>,
		attemptCount: Number(r.attempt_count),
	}));
}

/** Mark a row as successfully delivered. Terminal state -- next_attempt_at
 * cleared, last_error cleared, delivered_at stamped. */
export async function markOutboxDelivered(input: {
	id: string;
	deliveredAt: Date;
}): Promise<void> {
	await db
		.update(crossProductEventOutbox)
		.set({
			status: "delivered",
			nextAttemptAt: null,
			lastError: null,
			deliveredAt: input.deliveredAt,
		})
		.where(eq(crossProductEventOutbox.id, input.id));
}

/** Mark a row as failed but retryable. The worker computes nextAttemptAt
 * from the backoff schedule; this helper just persists the decision. */
export async function markOutboxFailed(input: {
	id: string;
	lastError: string;
	nextAttemptAt: Date;
}): Promise<void> {
	await db
		.update(crossProductEventOutbox)
		.set({
			status: "pending",
			nextAttemptAt: input.nextAttemptAt,
			lastError: input.lastError,
		})
		.where(eq(crossProductEventOutbox.id, input.id));
}

/** Mark a row dead-lettered. Terminal state. Reasons: attempt budget
 * exhausted, permanent 4xx from the consumer, or no credential registered
 * for the org. Admin UI can replay these manually (future feature; today the
 * dead row is just visible in the table). */
export async function markOutboxDead(input: {
	id: string;
	lastError: string;
}): Promise<void> {
	await db
		.update(crossProductEventOutbox)
		.set({
			status: "dead",
			nextAttemptAt: null,
			lastError: input.lastError,
		})
		.where(eq(crossProductEventOutbox.id, input.id));
}

export interface ActiveConsumerCredential {
	id: string;
	endpointUrl: string;
	signingSecretEncrypted: string;
}

/** Look up the active credential for an (org, consumer_product) pair. Used by
 * the delivery worker to resolve the row's target endpoint + signing secret.
 * Returns null when no credential is registered or all are soft-deleted /
 * inactive -- the worker maps that to dead-letter the row. */
export async function getActiveConsumerCredentialForOrg(input: {
	organizationId: string;
	consumerProduct: string;
}): Promise<ActiveConsumerCredential | null> {
	const row = await db.query.outboundWebhookCredential.findFirst({
		where: (c, { and: a, eq: e, isNull: n }) =>
			a(
				e(c.organizationId, input.organizationId),
				e(c.consumerProduct, input.consumerProduct),
				e(c.isActive, true),
				n(c.deletedAt),
			),
		columns: {
			id: true,
			endpointUrl: true,
			signingSecretEncrypted: true,
		},
	});
	return row ?? null;
}

// ---------------------------------------------------------------------------
// Return-URL allowlist resolution (Phase 11a step 3c part 2 step d, D-037).
// Used by the guest run view to decide whether to honor a `?returnUrl=` query
// parameter as a "Return to <consumer brand>" affordance. Keeping the
// resolution server-side prevents any client-side bypass.
// ---------------------------------------------------------------------------

/** Read every active credential's returnUrl allowlist for this org, merged
 * into one array. Empty result means no consumer is registered (so no
 * returnUrl will validate). Excludes soft-deleted + inactive credentials so
 * disabling a consumer immediately invalidates any returnUrls it had whitelisted. */
export async function getActiveReturnUrlAllowlistForOrg(
	organizationId: string,
): Promise<string[]> {
	const rows = await db
		.select({
			allowedReturnUrlPrefixes: outboundWebhookCredential.allowedReturnUrlPrefixes,
		})
		.from(outboundWebhookCredential)
		.where(
			and(
				eq(outboundWebhookCredential.organizationId, organizationId),
				eq(outboundWebhookCredential.isActive, true),
				isNull(outboundWebhookCredential.deletedAt),
			),
		);
	const out: string[] = [];
	for (const r of rows) {
		for (const p of r.allowedReturnUrlPrefixes) out.push(p);
	}
	return out;
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

// Suppress unused-import warnings on table symbols only referenced through
// `executor.query.<name>.findFirst` -- we still need the imports so the
// relation registrations land for the typed query builder.
void run;
void vendor;
