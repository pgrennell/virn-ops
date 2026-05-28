// packages/database/drizzle/queries/outbound-webhook-credential-crypto.ts
//
// Pure-function symmetric-encryption helpers for outbound_webhook_credential
// (Phase 11a step 3c). Split from outbound-webhook-credentials.ts (the CRUD
// module) for the same reason agent-credentials.ts is split from agents.ts:
// keep node:crypto helpers loadable in tests without dragging in the DB
// client (which would force DATABASE_URL into every unit-test runtime).
//
// Why symmetric encryption (not one-way hash like agent credentials):
//   - Agent credentials are VERIFIED on inbound requests -- one-way hash works
//     because we only need to compare.
//   - Webhook signing secrets are USED on every outbound delivery to compute
//     the HMAC signature header -- we need the plaintext back.
//
// Storage format:
//   `aes-256-gcm$<ivHex>$<authTagHex>$<ciphertextHex>`
//
// The algo prefix is for forward-compatibility: a future rotation to a
// different scheme (e.g. a KMS-backed envelope) can detect old ciphertexts and
// migrate them lazily.
//
// Key source: WEBHOOK_SECRET_ENCRYPTION_KEY env var, 64 hex chars = 32 bytes.
// Missing/short keys raise a startup-time error rather than a write-time error
// so misconfigured deployments fail fast. See .env.local.example.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12; // GCM standard nonce length

/** Read + validate the encryption key from the env. Cached per-process. */
let cachedKey: Buffer | null = null;
function getEncryptionKey(): Buffer {
	if (cachedKey) return cachedKey;
	const hex = process.env.WEBHOOK_SECRET_ENCRYPTION_KEY;
	if (!hex || hex.length === 0) {
		throw new Error(
			"WEBHOOK_SECRET_ENCRYPTION_KEY env var is not set. Required for outbound webhook credential encryption (Phase 11a step 3c). " +
				"Generate one with: `node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"` and add to .env.local.",
		);
	}
	if (hex.length !== KEY_BYTES * 2) {
		throw new Error(
			`WEBHOOK_SECRET_ENCRYPTION_KEY must be ${KEY_BYTES * 2} hex chars (${KEY_BYTES} bytes). Got ${hex.length} chars.`,
		);
	}
	const buf = Buffer.from(hex, "hex");
	if (buf.length !== KEY_BYTES) {
		throw new Error(
			`WEBHOOK_SECRET_ENCRYPTION_KEY decoded to ${buf.length} bytes; expected ${KEY_BYTES}. Check for non-hex chars.`,
		);
	}
	cachedKey = buf;
	return buf;
}

/** Test seam: clear the cached key so tests that mutate process.env mid-run
 * see the new value. Not exported from the package barrel -- internal use. */
export function _resetEncryptionKeyCacheForTesting(): void {
	cachedKey = null;
}

/** Generate a fresh signing secret to hand to the consumer (PM). 32 bytes of
 * randomness, base64url-encoded -- shape mirrors agent credentials so PM's
 * config UI can display it the same way. Shown ONCE on creation/rotation. */
export function generateWebhookSigningSecret(): string {
	return randomBytes(32).toString("base64url");
}

/** Last 4 chars of the plaintext for UI display ("...a3f9"). Not a secret. */
export function webhookSigningSecretLastFour(plaintext: string): string {
	return plaintext.slice(-4);
}

/** Encrypt a plaintext signing secret. Returns the storage-format string. */
export function encryptWebhookSigningSecret(plaintext: string): string {
	const key = getEncryptionKey();
	const iv = randomBytes(IV_BYTES);
	const cipher = createCipheriv(ALGO, key, iv);
	const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
	const authTag = cipher.getAuthTag();
	return `${ALGO}$${iv.toString("hex")}$${authTag.toString("hex")}$${ciphertext.toString("hex")}`;
}

/** Decrypt back to plaintext for HMAC computation in the delivery worker.
 * Throws on malformed input or auth-tag mismatch (tampered ciphertext or wrong
 * key). The delivery worker's error handler downgrades this to a row-level
 * delivery failure rather than crashing the entire emission pass. */
export function decryptWebhookSigningSecret(stored: string): string {
	const parts = stored.split("$");
	if (parts.length !== 4) {
		throw new Error(
			`Malformed encrypted webhook secret: expected 4 fields separated by '$', got ${parts.length}.`,
		);
	}
	const [algo, ivHex, authTagHex, ctHex] = parts;
	if (algo !== ALGO) {
		throw new Error(
			`Unsupported encrypted-secret algorithm: ${algo}. Expected ${ALGO}. (A future rotation may legitimately leave old rows under a prior scheme -- if you see this, the migration to re-encrypt didn't run.)`,
		);
	}
	const key = getEncryptionKey();
	const iv = Buffer.from(ivHex, "hex");
	const authTag = Buffer.from(authTagHex, "hex");
	const ciphertext = Buffer.from(ctHex, "hex");
	if (iv.length !== IV_BYTES) {
		throw new Error(`Encrypted secret IV is ${iv.length} bytes; expected ${IV_BYTES}.`);
	}
	const decipher = createDecipheriv(ALGO, key, iv);
	decipher.setAuthTag(authTag);
	const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
	return plaintext.toString("utf8");
}
