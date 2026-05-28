// cross-product-delivery.test.ts
//
// Unit tests for the delivery worker orchestrator (Phase 11a step 3c part 2
// step 3). Mocks @virn/database at the helper boundary -- the worker's
// orchestration logic is what we test, not the SQL semantics (those are the
// claim helper's responsibility).

import { createHmac } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@virn/database", () => ({
	claimNextOutboxBatch: vi.fn(async () => []),
	getActiveConsumerCredentialForOrg: vi.fn(async () => null),
	markOutboxDelivered: vi.fn(async () => undefined),
	markOutboxFailed: vi.fn(async () => undefined),
	markOutboxDead: vi.fn(async () => undefined),
	// The crypto helper is real and called from the worker; we mock to a
	// passthrough so tests can assert what plaintext flowed into the HMAC.
	decryptWebhookSigningSecret: vi.fn((stored: string) => stored.replace(/^encrypted:/, "")),
}));

import {
	claimNextOutboxBatch,
	decryptWebhookSigningSecret,
	getActiveConsumerCredentialForOrg,
	markOutboxDead,
	markOutboxDelivered,
	markOutboxFailed,
} from "@virn/database";

import {
	computeBackoffMs,
	runCrossProductDeliveryWorker,
} from "./cross-product-delivery";

const FIXED_NOW = new Date("2026-06-01T12:00:00Z");

function makeRow(overrides: Partial<{ id: string; attemptCount: number }> = {}) {
	return {
		id: overrides.id ?? "evt_1",
		organizationId: "org_1",
		consumerProduct: "virn-pm",
		eventType: "run.completed",
		payload: { eventId: overrides.id ?? "evt_1", runId: "run_1", organizationId: "org_1" },
		attemptCount: overrides.attemptCount ?? 1,
	};
}

const CRED = {
	id: "cred_1",
	endpointUrl: "https://pm.example.com/webhooks/virn-ops",
	// Mock decryptor strips the `encrypted:` prefix; plaintext is what's left.
	signingSecretEncrypted: "encrypted:secret_abc",
};

beforeEach(() => {
	vi.clearAllMocks();
});

describe("computeBackoffMs", () => {
	it("attempt=1 yields base", () => {
		expect(computeBackoffMs({ attempt: 1, baseMs: 60_000 })).toBe(60_000);
	});
	it("doubles each attempt", () => {
		expect(computeBackoffMs({ attempt: 2, baseMs: 60_000 })).toBe(120_000);
		expect(computeBackoffMs({ attempt: 3, baseMs: 60_000 })).toBe(240_000);
		expect(computeBackoffMs({ attempt: 4, baseMs: 60_000 })).toBe(480_000);
	});
	it("caps at capMs", () => {
		expect(computeBackoffMs({ attempt: 10, baseMs: 60_000, capMs: 600_000 })).toBe(600_000);
	});
	it("attempt=0 stays at base (no negative exponent)", () => {
		expect(computeBackoffMs({ attempt: 0, baseMs: 60_000 })).toBe(60_000);
	});
});

describe("runCrossProductDeliveryWorker", () => {
	it("no claimed rows -> zeros across the board, no fetches issued", async () => {
		vi.mocked(claimNextOutboxBatch).mockResolvedValueOnce([]);
		const fetchImpl = vi.fn();
		const result = await runCrossProductDeliveryWorker({ now: FIXED_NOW, fetchImpl });
		expect(result.claimed).toBe(0);
		expect(result.delivered).toBe(0);
		expect(result.failed).toBe(0);
		expect(result.dead).toBe(0);
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it("happy path: 2xx response -> marked delivered with correct HMAC header", async () => {
		vi.mocked(claimNextOutboxBatch).mockResolvedValueOnce([makeRow()]);
		vi.mocked(getActiveConsumerCredentialForOrg).mockResolvedValueOnce(CRED);

		const fetchImpl: typeof fetch = vi.fn(
			async (): Promise<Response> => new Response(null, { status: 200 }),
		);
		const result = await runCrossProductDeliveryWorker({ now: FIXED_NOW, fetchImpl });

		expect(result.delivered).toBe(1);
		expect(result.failed).toBe(0);
		expect(result.dead).toBe(0);
		expect(markOutboxDelivered).toHaveBeenCalledWith(
			expect.objectContaining({ id: "evt_1" }),
		);

		// Verify the request shape.
		const calls = vi.mocked(fetchImpl).mock.calls;
		expect(calls.length).toBe(1);
		const [url, init] = calls[0];
		expect(url).toBe("https://pm.example.com/webhooks/virn-ops");
		const initHeaders = (init?.headers ?? {}) as Record<string, string>;
		expect(initHeaders["Content-Type"]).toBe("application/json");
		expect(initHeaders["X-Virn-Event-Id"]).toBe("evt_1");
		expect(initHeaders["X-Virn-Event-Type"]).toBe("run.completed");

		// HMAC: signature = hex(hmac-sha256(secret, `${ts}.${body}`)).
		const body = init?.body as string;
		const ts = initHeaders["X-Virn-Timestamp"];
		const expected = createHmac("sha256", "secret_abc")
			.update(`${ts}.${body}`)
			.digest("hex");
		expect(initHeaders["X-Virn-Signature"]).toBe(expected);

		expect(decryptWebhookSigningSecret).toHaveBeenCalledWith("encrypted:secret_abc");
	});

	it("5xx response -> marked failed with backoff scheduled", async () => {
		vi.mocked(claimNextOutboxBatch).mockResolvedValueOnce([makeRow({ attemptCount: 1 })]);
		vi.mocked(getActiveConsumerCredentialForOrg).mockResolvedValueOnce(CRED);
		const fetchImpl = vi.fn(
			async (): Promise<Response> => new Response("boom", { status: 503 }),
		);
		const result = await runCrossProductDeliveryWorker({ now: FIXED_NOW, fetchImpl });
		expect(result.failed).toBe(1);
		expect(markOutboxFailed).toHaveBeenCalledWith(
			expect.objectContaining({ id: "evt_1" }),
		);
		const failedArg = vi.mocked(markOutboxFailed).mock.calls[0][0];
		// attempt 1 with default 1-min base -> 1-min backoff.
		expect(failedArg.nextAttemptAt.getTime() - FIXED_NOW.getTime()).toBe(60_000);
		expect(failedArg.lastError).toMatch(/HTTP 503/);
	});

	it("4xx response (non-408/429) -> marked dead immediately", async () => {
		vi.mocked(claimNextOutboxBatch).mockResolvedValueOnce([makeRow()]);
		vi.mocked(getActiveConsumerCredentialForOrg).mockResolvedValueOnce(CRED);
		const fetchImpl = vi.fn(
			async (): Promise<Response> => new Response("bad", { status: 400 }),
		);
		const result = await runCrossProductDeliveryWorker({ now: FIXED_NOW, fetchImpl });
		expect(result.dead).toBe(1);
		expect(markOutboxDead).toHaveBeenCalledWith(
			expect.objectContaining({ id: "evt_1" }),
		);
		expect(markOutboxFailed).not.toHaveBeenCalled();
	});

	it("429 (rate limit) treated as retryable, not dead", async () => {
		vi.mocked(claimNextOutboxBatch).mockResolvedValueOnce([makeRow({ attemptCount: 1 })]);
		vi.mocked(getActiveConsumerCredentialForOrg).mockResolvedValueOnce(CRED);
		const fetchImpl = vi.fn(
			async (): Promise<Response> => new Response("slow down", { status: 429 }),
		);
		const result = await runCrossProductDeliveryWorker({ now: FIXED_NOW, fetchImpl });
		expect(result.failed).toBe(1);
		expect(result.dead).toBe(0);
	});

	it("network error -> marked failed with backoff", async () => {
		vi.mocked(claimNextOutboxBatch).mockResolvedValueOnce([makeRow({ attemptCount: 2 })]);
		vi.mocked(getActiveConsumerCredentialForOrg).mockResolvedValueOnce(CRED);
		const fetchImpl = vi.fn(async () => {
			throw new Error("ECONNREFUSED");
		});
		const result = await runCrossProductDeliveryWorker({ now: FIXED_NOW, fetchImpl });
		expect(result.failed).toBe(1);
		const failedArg = vi.mocked(markOutboxFailed).mock.calls[0][0];
		expect(failedArg.lastError).toMatch(/ECONNREFUSED/);
		// attempt=2 -> 2-min backoff.
		expect(failedArg.nextAttemptAt.getTime() - FIXED_NOW.getTime()).toBe(120_000);
	});

	it("attempt budget exhausted on retryable failure -> marked dead", async () => {
		// attemptCount=5 with maxAttempts=5 means the just-completed attempt was
		// the last one; next failure flips to dead.
		vi.mocked(claimNextOutboxBatch).mockResolvedValueOnce([makeRow({ attemptCount: 5 })]);
		vi.mocked(getActiveConsumerCredentialForOrg).mockResolvedValueOnce(CRED);
		const fetchImpl = vi.fn(
			async (): Promise<Response> => new Response("err", { status: 502 }),
		);
		const result = await runCrossProductDeliveryWorker({
			now: FIXED_NOW,
			fetchImpl,
			maxAttempts: 5,
		});
		expect(result.dead).toBe(1);
		expect(markOutboxDead).toHaveBeenCalledWith(
			expect.objectContaining({ id: "evt_1" }),
		);
		const deadArg = vi.mocked(markOutboxDead).mock.calls[0][0];
		expect(deadArg.lastError).toMatch(/budget exhausted/);
	});

	it("no credential registered for org -> marked dead, no fetch attempted", async () => {
		vi.mocked(claimNextOutboxBatch).mockResolvedValueOnce([makeRow()]);
		vi.mocked(getActiveConsumerCredentialForOrg).mockResolvedValueOnce(null);
		const fetchImpl = vi.fn();
		const result = await runCrossProductDeliveryWorker({ now: FIXED_NOW, fetchImpl });
		expect(result.dead).toBe(1);
		expect(fetchImpl).not.toHaveBeenCalled();
		expect(markOutboxDead).toHaveBeenCalledWith(
			expect.objectContaining({ id: "evt_1" }),
		);
	});

	it("decryption failure -> marked dead, no fetch attempted", async () => {
		vi.mocked(claimNextOutboxBatch).mockResolvedValueOnce([makeRow()]);
		vi.mocked(getActiveConsumerCredentialForOrg).mockResolvedValueOnce(CRED);
		vi.mocked(decryptWebhookSigningSecret).mockImplementationOnce(() => {
			throw new Error("auth-tag mismatch");
		});
		const fetchImpl = vi.fn();
		const result = await runCrossProductDeliveryWorker({ now: FIXED_NOW, fetchImpl });
		expect(result.dead).toBe(1);
		expect(fetchImpl).not.toHaveBeenCalled();
		const deadArg = vi.mocked(markOutboxDead).mock.calls[0][0];
		expect(deadArg.lastError).toMatch(/Failed to decrypt/);
	});

	it("processes a batch of mixed outcomes in one tick", async () => {
		vi.mocked(claimNextOutboxBatch).mockResolvedValueOnce([
			makeRow({ id: "evt_a" }),
			makeRow({ id: "evt_b" }),
			makeRow({ id: "evt_c" }),
		]);
		vi.mocked(getActiveConsumerCredentialForOrg).mockResolvedValue(CRED);
		const fetchImpl = vi.fn().mockImplementation(async (url, init) => {
			const headers = (init as RequestInit).headers as Record<string, string>;
			const eventId = headers["X-Virn-Event-Id"];
			if (eventId === "evt_a") return new Response(null, { status: 200 });
			if (eventId === "evt_b") return new Response("err", { status: 503 });
			return new Response("nope", { status: 400 });
		});
		const result = await runCrossProductDeliveryWorker({ now: FIXED_NOW, fetchImpl });
		expect(result.claimed).toBe(3);
		expect(result.delivered).toBe(1);
		expect(result.failed).toBe(1);
		expect(result.dead).toBe(1);
		expect(result.outcomes).toHaveLength(3);
	});
});
