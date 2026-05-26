// packages/api/orpc/rate-limit.ts
//
// In-process token-bucket rate limiter for the three public (token-authed) guest
// procedures. Defense-in-depth against abuse and accidental DoS; token guessing isn't a
// real threat (256-bit random) but unauthenticated endpoints exposed to the open internet
// should have basic rate limiting.
//
// Scope limit (deliberate): in-memory, single-process. On a multi-instance deploy
// (e.g. Vercel) this provides per-instance limiting, not global. That's acceptable for
// the current scale of the guest surface; when global limiting matters, swap to Vercel
// KV or Redis behind the same `enforceRateLimit` API.

import { ORPCError } from "@orpc/server";

interface Bucket {
	tokens: number;
	lastRefillMs: number;
}

const buckets = new Map<string, Bucket>();

// Naive size cap so a torrent of unique IPs can't OOM the process. When the cap is hit
// we drop oldest entries; under sustained attack the rate-limit semantics degrade
// gracefully (attackers get fresh buckets) but the process stays up.
const MAX_BUCKETS = 50_000;

interface RateLimitOptions {
	/** Procedure-specific key, e.g. "guest:get-run". Prepended to the IP to scope buckets. */
	key: string;
	/** Maximum requests in the window. */
	limit: number;
	/** Window length in milliseconds (used for the linear refill rate: `limit / windowMs`). */
	windowMs: number;
}

/** Throws ORPCError("TOO_MANY_REQUESTS") when the bucket for (key, ip) is empty. Otherwise
 * consumes one token and returns. Safe to call multiple times per request if needed. */
export function enforceRateLimit(headers: Headers, opts: RateLimitOptions): void {
	const ip = getClientIp(headers);
	const bucketKey = `${opts.key}:${ip}`;
	const now = Date.now();
	const refillRatePerMs = opts.limit / opts.windowMs;

	let bucket = buckets.get(bucketKey);
	if (!bucket) {
		bucket = { tokens: opts.limit, lastRefillMs: now };
		if (buckets.size >= MAX_BUCKETS) {
			// Drop the first (insertion-order) entry. Acceptable degradation -- worst case
			// is a sustained attacker burns one slot, the limit re-applies on next refill.
			const firstKey = buckets.keys().next().value;
			if (firstKey !== undefined) buckets.delete(firstKey);
		}
		buckets.set(bucketKey, bucket);
	} else {
		const elapsedMs = now - bucket.lastRefillMs;
		bucket.tokens = Math.min(opts.limit, bucket.tokens + elapsedMs * refillRatePerMs);
		bucket.lastRefillMs = now;
	}

	if (bucket.tokens < 1) {
		throw new ORPCError("TOO_MANY_REQUESTS", {
			message: "Rate limit exceeded. Slow down and try again in a moment.",
		});
	}
	bucket.tokens -= 1;
}

/** Extract the first client IP from standard reverse-proxy headers. Falls back to a
 * static bucket key when no IP can be derived (e.g., direct localhost dev) -- in that
 * case every dev request shares one bucket, which is fine for local. */
function getClientIp(headers: Headers): string {
	const fwd = headers.get("x-forwarded-for");
	if (fwd) {
		const first = fwd.split(",")[0]?.trim();
		if (first) return first;
	}
	const real = headers.get("x-real-ip");
	if (real) return real;
	return "_unknown";
}

/** Test-only helper: reset all buckets. Used by unit tests so cases don't leak state. */
export function _resetRateLimitBuckets(): void {
	buckets.clear();
}
