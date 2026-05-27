// agents-credentials.test.ts
//
// Pure-function tests for the credential generator + scrypt hash/verify roundtrip. Lives in
// its own file so it doesn't get caught by agents.test.ts's vi.mock("@virn/database") that
// stubs procedure helpers -- credential helpers test against the real impl.

import { describe, expect, it } from "vitest";

// Deep import on purpose -- the credential helpers are pure (no db client). Importing via
// the @virn/database barrel would load the client (which throws if DATABASE_URL isn't set);
// this test is for pure functions and shouldn't need a configured DB.
import {
	credentialLastFour,
	generateAgentCredential,
	hashAgentCredential,
	verifyAgentCredential,
} from "@virn/database/drizzle/queries/agent-credentials";

describe("agent credential helpers", () => {
	it("plaintext format: agent_<base64url>, last 4 chars match credentialLastFour helper", () => {
		const p = generateAgentCredential();
		expect(p).toMatch(/^agent_[A-Za-z0-9_-]{40,}$/);
		expect(credentialLastFour(p)).toBe(p.slice(-4));
	});

	it("two generated credentials are not equal (entropy sanity)", () => {
		expect(generateAgentCredential()).not.toBe(generateAgentCredential());
	});

	it("hash format: scrypt$<32-hex>$<128-hex>", () => {
		const hash = hashAgentCredential(generateAgentCredential());
		expect(hash).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
	});

	it("hash + verify roundtrip", () => {
		const plaintext = generateAgentCredential();
		const hash = hashAgentCredential(plaintext);
		expect(verifyAgentCredential(plaintext, hash)).toBe(true);
	});

	it("verify rejects a wrong plaintext", () => {
		const hash = hashAgentCredential(generateAgentCredential());
		expect(verifyAgentCredential("wrong", hash)).toBe(false);
	});

	it("verify rejects malformed stored hashes (different prefix, wrong field count, bad hex)", () => {
		const plaintext = generateAgentCredential();
		expect(verifyAgentCredential(plaintext, "garbage")).toBe(false);
		expect(verifyAgentCredential(plaintext, "argon2$00$00")).toBe(false);
		expect(verifyAgentCredential(plaintext, "scrypt$00$00")).toBe(false);
		expect(verifyAgentCredential(plaintext, "scrypt$xx$yy")).toBe(false);
	});

	it("hashing the same plaintext twice gives different hashes (salt is randomized)", () => {
		const plaintext = generateAgentCredential();
		const h1 = hashAgentCredential(plaintext);
		const h2 = hashAgentCredential(plaintext);
		expect(h1).not.toBe(h2);
		// Both still verify.
		expect(verifyAgentCredential(plaintext, h1)).toBe(true);
		expect(verifyAgentCredential(plaintext, h2)).toBe(true);
	});
});
