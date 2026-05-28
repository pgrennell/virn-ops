// outbound-webhook-credential-crypto.test.ts
//
// Pure-function tests for the AES-256-GCM helpers. Mirrors the
// agents-credentials.test.ts shape -- deep import so we don't pull the DB
// client just to test crypto, and we mutate process.env per-test through the
// _reset cache seam.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Deep import (same reason as agent-credentials.test.ts -- avoid pulling in
// the DB client through the @virn/database barrel).
import {
	_resetEncryptionKeyCacheForTesting,
	decryptWebhookSigningSecret,
	encryptWebhookSigningSecret,
	generateWebhookSigningSecret,
	webhookSigningSecretLastFour,
} from "@virn/database/drizzle/queries/outbound-webhook-credential-crypto";

const TEST_KEY_HEX = "0".repeat(63) + "a"; // 64 hex chars -> 32 bytes; not zero so timing-attack tests look real-ish.

describe("outbound webhook credential crypto helpers", () => {
	const originalEnv = process.env.WEBHOOK_SECRET_ENCRYPTION_KEY;

	beforeEach(() => {
		process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = TEST_KEY_HEX;
		_resetEncryptionKeyCacheForTesting();
	});

	afterEach(() => {
		if (originalEnv === undefined) {
			delete process.env.WEBHOOK_SECRET_ENCRYPTION_KEY;
		} else {
			process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = originalEnv;
		}
		_resetEncryptionKeyCacheForTesting();
	});

	it("plaintext format: 32 random bytes base64url-encoded (~43 chars)", () => {
		const p = generateWebhookSigningSecret();
		expect(p).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(webhookSigningSecretLastFour(p)).toBe(p.slice(-4));
	});

	it("two generated secrets differ (entropy sanity)", () => {
		expect(generateWebhookSigningSecret()).not.toBe(generateWebhookSigningSecret());
	});

	it("encrypt format: aes-256-gcm$<24-hex iv>$<32-hex tag>$<ct hex>", () => {
		const encrypted = encryptWebhookSigningSecret(generateWebhookSigningSecret());
		expect(encrypted).toMatch(
			/^aes-256-gcm\$[0-9a-f]{24}\$[0-9a-f]{32}\$[0-9a-f]+$/,
		);
	});

	it("encrypt + decrypt roundtrip preserves the plaintext", () => {
		const plaintext = generateWebhookSigningSecret();
		const encrypted = encryptWebhookSigningSecret(plaintext);
		expect(decryptWebhookSigningSecret(encrypted)).toBe(plaintext);
	});

	it("decrypt throws on a tampered ciphertext (GCM auth-tag mismatch)", () => {
		const plaintext = generateWebhookSigningSecret();
		const encrypted = encryptWebhookSigningSecret(plaintext);
		// Flip one hex char in the ciphertext portion. We rebuild the string to keep
		// the iv + tag fields intact -- a tampered ct is what we want to detect.
		const parts = encrypted.split("$");
		const tamperedCt = parts[3].endsWith("0") ? parts[3].slice(0, -1) + "1" : parts[3].slice(0, -1) + "0";
		const tampered = `${parts[0]}$${parts[1]}$${parts[2]}$${tamperedCt}`;
		expect(() => decryptWebhookSigningSecret(tampered)).toThrow();
	});

	it("decrypt throws on a different encryption key (key separation)", () => {
		const plaintext = generateWebhookSigningSecret();
		const encrypted = encryptWebhookSigningSecret(plaintext);
		// Rotate the env key, reset the cache; decrypt now should fail.
		process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = "f".repeat(63) + "1";
		_resetEncryptionKeyCacheForTesting();
		expect(() => decryptWebhookSigningSecret(encrypted)).toThrow();
	});

	it("decrypt rejects malformed stored ciphertext (bad field count, unknown algo)", () => {
		expect(() => decryptWebhookSigningSecret("garbage")).toThrow(/4 fields/);
		expect(() => decryptWebhookSigningSecret("a$b$c$d")).toThrow(/Unsupported.*algorithm/);
		expect(() => decryptWebhookSigningSecret("aes-256-gcm$00$00$00")).toThrow();
	});

	it("missing WEBHOOK_SECRET_ENCRYPTION_KEY throws at first use", () => {
		delete process.env.WEBHOOK_SECRET_ENCRYPTION_KEY;
		_resetEncryptionKeyCacheForTesting();
		expect(() => encryptWebhookSigningSecret("anything")).toThrow(
			/WEBHOOK_SECRET_ENCRYPTION_KEY env var is not set/,
		);
	});

	it("wrong-length WEBHOOK_SECRET_ENCRYPTION_KEY throws with a clear message", () => {
		process.env.WEBHOOK_SECRET_ENCRYPTION_KEY = "abcd"; // 4 chars, way too short
		_resetEncryptionKeyCacheForTesting();
		expect(() => encryptWebhookSigningSecret("anything")).toThrow(/must be 64 hex chars/);
	});
});
