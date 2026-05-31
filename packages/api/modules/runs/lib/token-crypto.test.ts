// D-046 payoff -- the participant-token crypto was trapped in queries/participant-tokens.ts
// (imports the drizzle client). It now lives in the client-free queries/_pure/token-crypto.ts
// and is imported here via that DEEP path, so this test runs with NO DATABASE_URL: the import
// proves the decoupling. First coverage of the security-relevant token HMAC + the
// constant-time compare. The secret below is a throwaway TEST value, not a real secret.

import { afterAll, beforeEach, describe, expect, it } from "vitest";

// Deep, client-free import -- NOT the @virn/database barrel (which would load the client).
import {
	generateTokenPlaintext,
	hashToken,
	safeEqual,
} from "@virn/database/drizzle/queries/_pure/token-crypto";

const TEST_SECRET = "test-participant-token-secret-0123456789"; // 40 chars, dummy fixture

beforeEach(() => {
	process.env.PARTICIPANT_TOKEN_SECRET = TEST_SECRET;
});

afterAll(() => {
	delete process.env.PARTICIPANT_TOKEN_SECRET;
});

describe("hashToken", () => {
	it("is deterministic (same plaintext + secret -> same hash, the UNIQUE-index property)", () => {
		expect(hashToken("abc")).toBe(hashToken("abc"));
	});

	it("produces a distinct hash for a distinct plaintext", () => {
		expect(hashToken("abc")).not.toBe(hashToken("abd"));
	});

	it("returns a 64-char lowercase hex string (HMAC-SHA256)", () => {
		const h = hashToken("anything");
		expect(h).toMatch(/^[0-9a-f]{64}$/);
	});

	it("is keyed by the secret (a different secret -> a different hash)", () => {
		const a = hashToken("abc");
		process.env.PARTICIPANT_TOKEN_SECRET = "a-completely-different-secret-0123456789";
		expect(hashToken("abc")).not.toBe(a);
	});

	it("throws when PARTICIPANT_TOKEN_SECRET is unset", () => {
		delete process.env.PARTICIPANT_TOKEN_SECRET;
		expect(() => hashToken("abc")).toThrow(/PARTICIPANT_TOKEN_SECRET/);
	});

	it("throws when the secret is shorter than 32 chars", () => {
		process.env.PARTICIPANT_TOKEN_SECRET = "tooshort";
		expect(() => hashToken("abc")).toThrow(/32 chars/);
	});
});

describe("generateTokenPlaintext", () => {
	it("is URL-safe base64url (~43 chars, no +/= padding)", () => {
		const t = generateTokenPlaintext();
		expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(t.length).toBeGreaterThanOrEqual(42);
		expect(t.length).toBeLessThanOrEqual(44);
	});

	it("yields a fresh value each call (256 bits of entropy)", () => {
		expect(generateTokenPlaintext()).not.toBe(generateTokenPlaintext());
	});
});

describe("safeEqual", () => {
	it("returns true for identical strings", () => {
		expect(safeEqual("deadbeef", "deadbeef")).toBe(true);
	});

	it("returns false for same-length but different strings", () => {
		expect(safeEqual("deadbeef", "deadbeff")).toBe(false);
	});

	it("returns false for different-length strings (short-circuits before timingSafeEqual)", () => {
		expect(safeEqual("abc", "abcd")).toBe(false);
	});
});
