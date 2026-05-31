// packages/database/drizzle/queries/_pure/token-crypto.ts
//
// Client-free participant-token crypto, extracted from queries/participant-tokens.ts per
// D-046 so it can be unit-tested without initialising the drizzle client. Pure node:crypto
// + a PARTICIPANT_TOKEN_SECRET env lookup -- no db. queries/participant-tokens.ts imports
// these (it uses them internally) and re-exports the public ones (generateTokenPlaintext,
// hashToken) for back-compat. safeEqual stays internal (not part of the original API).
//
// HMAC (not argon2id) is deliberate: deterministic so tokenHash can be a UNIQUE index for
// O(1) lookups. The secret defends against DB-only leaks. Rotating PARTICIPANT_TOKEN_SECRET
// invalidates every outstanding guest link by design.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Lazy env loader. Throws on first use if unset/too short. */
function getSecret(): string {
	const secret = process.env.PARTICIPANT_TOKEN_SECRET;
	if (!secret || secret.length < 32) {
		throw new Error(
			"PARTICIPANT_TOKEN_SECRET is not set or shorter than 32 chars. " +
				"Generate one with `openssl rand -hex 32` and put it in .env.local (dev) and Vercel " +
				"env (prod). It must remain stable -- rotating invalidates every outstanding guest link.",
		);
	}
	return secret;
}

/** 256 bits of URL-safe random; this is what we send in the URL fragment. ~43 chars. */
export function generateTokenPlaintext(): string {
	return randomBytes(32).toString("base64url");
}

/** Deterministic HMAC-SHA256 hex of the plaintext keyed by the server secret. The DB only
 * ever sees this hash. */
export function hashToken(plaintext: string): string {
	return createHmac("sha256", getSecret()).update(plaintext).digest("hex");
}

/** Constant-time string compare on hashes (defense against timing oracles even though we
 * fetch by the indexed hash directly -- belt + suspenders). */
export function safeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
