// packages/api/modules/integrations/lib/cross-product-delivery.ts
//
// Cross-product webhook delivery worker (Phase 11a step 3c part 2 step 3).
// Drains the cross_product_event_outbox: claims a batch of pending rows,
// resolves each one's target consumer credential, decrypts the signing
// secret, POSTs the sealed payload with an HMAC-SHA256 signature, and marks
// the row delivered / failed (retryable) / dead based on the response.
//
// Triggers (both call this same lib function -- parity with the SLA-sweep
// pattern in runs/lib/sla-sweep.ts):
//   - Vercel Cron HTTP endpoint at /api/cron/cross-product-deliver (prod) --
//     fires every minute (vercel.json crons array).
//   - One-shot dev script `pnpm cross-product-deliver:dev` -- the same HTTP
//     POST with the right CRON_SECRET header for local-tree iteration.
//
// Backoff schedule (configurable; defaults below):
//   - attempt 1 fail -> retry in 2 min
//   - attempt 2 fail -> retry in 4 min
//   - attempt 3 fail -> retry in 8 min
//   - attempt 4 fail -> retry in 16 min
//   - attempt 5 fail -> dead-letter
// Caps at 60 min for any future bump to maxAttempts.
//
// Permanent failures (mark dead immediately, no retry):
//   - 4xx response other than 408 / 429 -- the consumer is rejecting the
//     payload shape or auth; retrying won't change the outcome.
//   - No active credential registered for the (org, consumer) pair -- nothing
//     to POST to.
//
// Retryable failures (mark failed with backoff):
//   - 5xx response -- consumer-side outage.
//   - Network error / timeout / abort.
//   - 408 Request Timeout, 429 Rate Limit -- temporary 4xx codes.
//
// HMAC scheme (X-Virn-Signature header):
//   value = hex(hmac-sha256(secret, `${timestamp}.${body}`))
// The body is the JSON-stringified payload exactly as POSTed. Timestamp is a
// Unix-seconds string; consumer should reject if it's stale (>5 minutes off)
// to defeat replay attacks. Format matches Stripe / GitHub style signing.

import { createHmac } from "node:crypto";

import {
	claimNextOutboxBatch,
	type ClaimedOutboxRow,
	decryptWebhookSigningSecret,
	getActiveConsumerCredentialForOrg,
	markOutboxDead,
	markOutboxDelivered,
	markOutboxFailed,
} from "@virn/database";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_BACKOFF_BASE_MS = 60_000; // 1 minute
const DEFAULT_BACKOFF_CAP_MS = 60 * 60 * 1000; // 1 hour

/** Exponential backoff: base * 2^(attempt-1), capped. attempt is the
 * just-completed attempt number (1-indexed). For attempt=1 returns base*1
 * (= 1 min by default), attempt=2 returns base*2 (= 2 min), etc. */
export function computeBackoffMs(input: {
	attempt: number;
	baseMs?: number;
	capMs?: number;
}): number {
	const base = input.baseMs ?? DEFAULT_BACKOFF_BASE_MS;
	const cap = input.capMs ?? DEFAULT_BACKOFF_CAP_MS;
	const raw = base * 2 ** Math.max(0, input.attempt - 1);
	return Math.min(raw, cap);
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export interface DeliveryWorkerInput {
	/** Override for tests / time-travel. Defaults to `new Date()`. */
	now?: Date;
	/** How many rows to claim per tick. */
	batchSize?: number;
	/** Hard cap on delivery attempts. After this many fails, row -> dead. */
	maxAttempts?: number;
	/** Per-request timeout (AbortController). */
	requestTimeoutMs?: number;
	/** Injectable fetch for tests. Defaults to globalThis.fetch. */
	fetchImpl?: typeof fetch;
}

export interface DeliveryWorkerResult {
	claimed: number;
	delivered: number;
	failed: number;
	dead: number;
	durationMs: number;
	/** Per-row outcome detail for cron-log forensics + the admin debug view. */
	outcomes: Array<{
		eventId: string;
		outcome: "delivered" | "failed" | "dead";
		reason?: string;
	}>;
}

export async function runCrossProductDeliveryWorker(
	input: DeliveryWorkerInput = {},
): Promise<DeliveryWorkerResult> {
	const startedAt = Date.now();
	const now = input.now ?? new Date();
	const batchSize = input.batchSize ?? DEFAULT_BATCH_SIZE;
	const maxAttempts = input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
	const requestTimeoutMs = input.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
	const fetchImpl = input.fetchImpl ?? globalThis.fetch;

	const claimed = await claimNextOutboxBatch({ now, batchSize });

	let delivered = 0;
	let failed = 0;
	let dead = 0;
	const outcomes: DeliveryWorkerResult["outcomes"] = [];

	for (const row of claimed) {
		const outcome = await deliverOne({
			row,
			now,
			maxAttempts,
			requestTimeoutMs,
			fetchImpl,
		});
		if (outcome.kind === "delivered") {
			delivered += 1;
			outcomes.push({ eventId: row.id, outcome: "delivered" });
		} else if (outcome.kind === "failed") {
			failed += 1;
			outcomes.push({ eventId: row.id, outcome: "failed", reason: outcome.reason });
		} else {
			dead += 1;
			outcomes.push({ eventId: row.id, outcome: "dead", reason: outcome.reason });
		}
	}

	return {
		claimed: claimed.length,
		delivered,
		failed,
		dead,
		durationMs: Date.now() - startedAt,
		outcomes,
	};
}

// ---------------------------------------------------------------------------
// Per-row delivery
// ---------------------------------------------------------------------------

type DeliveryOutcome =
	| { kind: "delivered" }
	| { kind: "failed"; reason: string }
	| { kind: "dead"; reason: string };

async function deliverOne(input: {
	row: ClaimedOutboxRow;
	now: Date;
	maxAttempts: number;
	requestTimeoutMs: number;
	fetchImpl: typeof fetch;
}): Promise<DeliveryOutcome> {
	const { row, now, maxAttempts, requestTimeoutMs, fetchImpl } = input;

	// 1. Resolve the consumer credential. Missing / disabled credential ->
	//    dead-letter immediately; no point retrying a delivery to a target
	//    that doesn't exist.
	const credential = await getActiveConsumerCredentialForOrg({
		organizationId: row.organizationId,
		consumerProduct: row.consumerProduct,
	});
	if (!credential) {
		const reason = `No active credential for consumer "${row.consumerProduct}" in this organization.`;
		await markOutboxDead({ id: row.id, lastError: reason });
		return { kind: "dead", reason };
	}

	// 2. Decrypt the signing secret. A decryption failure means either the
	//    env key was rotated without re-encrypting, or the ciphertext was
	//    tampered with -- both permanent failures from the worker's POV.
	let plaintextSecret: string;
	try {
		plaintextSecret = decryptWebhookSigningSecret(credential.signingSecretEncrypted);
	} catch (e) {
		const reason = `Failed to decrypt signing secret: ${e instanceof Error ? e.message : String(e)}`;
		await markOutboxDead({ id: row.id, lastError: reason });
		return { kind: "dead", reason };
	}

	// 3. POST the sealed payload with an HMAC signature header. AbortController
	//    enforces the per-request timeout; network errors are caught + treated
	//    as retryable.
	const body = JSON.stringify(row.payload);
	const timestampSeconds = Math.floor(now.getTime() / 1000).toString();
	const signature = createHmac("sha256", plaintextSecret)
		.update(`${timestampSeconds}.${body}`)
		.digest("hex");

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), requestTimeoutMs);

	let response: Response | null = null;
	let networkError: string | null = null;
	try {
		response = await fetchImpl(credential.endpointUrl, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Virn-Signature": signature,
				"X-Virn-Timestamp": timestampSeconds,
				"X-Virn-Event-Id": row.id,
				"X-Virn-Event-Type": row.eventType,
			},
			body,
			signal: controller.signal,
		});
	} catch (e) {
		networkError = e instanceof Error ? e.message : String(e);
	} finally {
		clearTimeout(timer);
	}

	// 4. Outcome.
	if (response && response.status >= 200 && response.status < 300) {
		await markOutboxDelivered({ id: row.id, deliveredAt: new Date() });
		return { kind: "delivered" };
	}

	const statusInfo = response
		? `HTTP ${response.status}`
		: `network error: ${networkError ?? "unknown"}`;

	// Permanent 4xx (other than 408/429) -> dead immediately.
	const isPermanentFailure =
		response !== null &&
		response.status >= 400 &&
		response.status < 500 &&
		response.status !== 408 &&
		response.status !== 429;
	if (isPermanentFailure) {
		const reason = `Permanent failure: ${statusInfo}`;
		await markOutboxDead({ id: row.id, lastError: reason });
		return { kind: "dead", reason };
	}

	// Retryable failure -- check the attempt budget before scheduling another try.
	// row.attemptCount already includes the just-claimed attempt (the claim helper
	// bumps it inside the same UPDATE).
	if (row.attemptCount >= maxAttempts) {
		const reason = `Attempt budget exhausted (${row.attemptCount}/${maxAttempts}); last failure: ${statusInfo}`;
		await markOutboxDead({ id: row.id, lastError: reason });
		return { kind: "dead", reason };
	}

	const backoffMs = computeBackoffMs({ attempt: row.attemptCount });
	const nextAttemptAt = new Date(now.getTime() + backoffMs);
	const reason = `Retryable failure: ${statusInfo}; next attempt at ${nextAttemptAt.toISOString()}`;
	await markOutboxFailed({
		id: row.id,
		lastError: reason,
		nextAttemptAt,
	});
	return { kind: "failed", reason };
}
