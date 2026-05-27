// packages/database/drizzle/queries/agent-credentials.ts
//
// Pure-function credential helpers for agents (ADR-006 + D-022). Split from `agents.ts`
// because these don't touch the db client -- pulling them in for tests via @virn/database
// would otherwise require DATABASE_URL to be set just to load node:crypto helpers.
//
// Credential model:
//   - Plaintext shape: `agent_<43 chars base64url>` (~256 bits entropy, GitHub-PAT-shaped).
//     Shown ONCE on creation/rotation, never again -- the standard service-account pattern.
//   - Hash format: `scrypt$<saltHex>$<keyHex>`. The algo prefix lets Phase 11 swap to
//     argon2id (D-022 deferral) by detecting the algo from the prefix and supporting both
//     during a migration window. scrypt picked over a new dep because it's in node:crypto.
//   - credentialLastFour: last 4 chars of plaintext for UI display ("…a3f9"). Not a secret.

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// scrypt cost params (N, r, p). N=2^15 ~ 32MB memory; ~50ms on a modern CPU. Suitable for
// occasional credential-validation events at the MCP boundary (Phase 11). Tunable per
// OWASP guidance.
const SCRYPT_N = 1 << 15;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;
const SCRYPT_SALTLEN = 16;

/** Generate an agent credential plaintext: `agent_` + 43 chars base64url (256 bits). The
 * caller stores `hashAgentCredential(plaintext)` in `agent.credentialHash` and surfaces the
 * plaintext ONCE to the user. */
export function generateAgentCredential(): string {
	const random = randomBytes(32).toString("base64url");
	return `agent_${random}`;
}

/** Last 4 chars of the plaintext for UI display ("…a3f9"). Not a secret. */
export function credentialLastFour(plaintext: string): string {
	return plaintext.slice(-4);
}

/** Salted scrypt hash. Returns `scrypt$<saltHex>$<keyHex>`. */
export function hashAgentCredential(plaintext: string): string {
	const salt = randomBytes(SCRYPT_SALTLEN);
	const key = scryptSync(plaintext, salt, SCRYPT_KEYLEN, {
		N: SCRYPT_N,
		r: SCRYPT_R,
		p: SCRYPT_P,
		// Node's default maxmem is 32 MiB; N=2^15,r=8 needs ~32MB and trips the guard on
		// some platforms. 64 MiB gives headroom + room to bump N later if Phase 11 tunes up.
		maxmem: 64 * 1024 * 1024,
	});
	return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

/** Constant-time verify against the `scrypt$salt$key` stored hash. Phase 11 (MCP) will use
 * this at the credential-validating boundary. Returns false for any malformed input. */
export function verifyAgentCredential(plaintext: string, stored: string): boolean {
	const parts = stored.split("$");
	if (parts.length !== 3 || parts[0] !== "scrypt") return false;
	const saltHex = parts[1];
	const keyHex = parts[2];
	let salt: Buffer;
	let key: Buffer;
	try {
		salt = Buffer.from(saltHex, "hex");
		key = Buffer.from(keyHex, "hex");
	} catch {
		return false;
	}
	if (salt.length !== SCRYPT_SALTLEN || key.length !== SCRYPT_KEYLEN) return false;
	const candidate = scryptSync(plaintext, salt, SCRYPT_KEYLEN, {
		N: SCRYPT_N,
		r: SCRYPT_R,
		p: SCRYPT_P,
		maxmem: 64 * 1024 * 1024,
	});
	return timingSafeEqual(candidate, key);
}
