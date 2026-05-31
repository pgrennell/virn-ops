// Phase 18b-2 -- unit tests for the pure dispatcher matching + fingerprint logic.

import { describe, expect, it } from "vitest";

import {
	buildDispatchFingerprint,
	playbookTriggerMatches,
	selectMatchingPlaybooks,
} from "./dispatch";

function trigger(over: Partial<Parameters<typeof playbookTriggerMatches>[0]> = {}) {
	return {
		triggerType: "lifecycle_event" as const,
		triggerEvent: "run.completed",
		entitySetIds: [],
		...over,
	};
}

describe("playbookTriggerMatches", () => {
	it("matches a lifecycle trigger on event with an empty (any-entity) scope", () => {
		expect(playbookTriggerMatches(trigger(), "run.completed", [])).toBe(true);
	});

	it("rejects a different event", () => {
		expect(playbookTriggerMatches(trigger(), "vendor.upserted", [])).toBe(false);
	});

	it("rejects manual triggers (only the dispatcher's lifecycle path)", () => {
		expect(
			playbookTriggerMatches(trigger({ triggerType: "manual" }), "run.completed", []),
		).toBe(false);
	});

	it("honors entity-set scope: matches only on intersection", () => {
		const scoped = trigger({ entitySetIds: ["set-a", "set-b"] });
		expect(playbookTriggerMatches(scoped, "run.completed", ["set-b"])).toBe(true);
		expect(playbookTriggerMatches(scoped, "run.completed", ["set-z"])).toBe(false);
		expect(playbookTriggerMatches(scoped, "run.completed", [])).toBe(false);
	});
});

describe("selectMatchingPlaybooks", () => {
	it("filters a trigger set down to the firing playbooks", () => {
		const triggers = [
			{ playbookId: "p1", playbookVersionId: "v1", triggerType: "lifecycle_event" as const, triggerEvent: "run.completed", entitySetIds: [] },
			{ playbookId: "p2", playbookVersionId: "v2", triggerType: "lifecycle_event" as const, triggerEvent: "vendor.upserted", entitySetIds: [] },
			{ playbookId: "p3", playbookVersionId: "v3", triggerType: "manual" as const, triggerEvent: null, entitySetIds: [] },
			{ playbookId: "p4", playbookVersionId: "v4", triggerType: "lifecycle_event" as const, triggerEvent: "run.completed", entitySetIds: ["set-x"] },
		];
		const matched = selectMatchingPlaybooks(triggers, "run.completed", ["set-x"]);
		expect(matched.map((m) => m.playbookId)).toEqual(["p1", "p4"]);
	});
});

describe("buildDispatchFingerprint", () => {
	it("is deterministic per subject so duplicate events dedup", () => {
		const a = buildDispatchFingerprint({ event: "run.completed", entityId: "lst-1", payload: { runId: "run-9" } });
		const b = buildDispatchFingerprint({ event: "run.completed", entityId: "lst-1", payload: { runId: "run-9" } });
		expect(a).toBe(b);
		expect(a).toBe("run.completed:run-9");
	});

	it("falls back to entityId then a placeholder", () => {
		expect(buildDispatchFingerprint({ event: "vendor.upserted", entityId: "ven-1" })).toBe("vendor.upserted:ven-1");
		expect(buildDispatchFingerprint({ event: "x", entityId: null })).toBe("x:_");
	});

	// Phase 18 hardening (A2): the fingerprint must split distinct subjects so two
	// genuinely-different events never collide on uq_playbook_run_dedup.
	it("falls back to entityId when payload.runId is not a string", () => {
		expect(
			buildDispatchFingerprint({ event: "run.completed", entityId: "lst-1", payload: { runId: 42 } }),
		).toBe("run.completed:lst-1");
	});

	it("falls back to entityId when payload has no runId", () => {
		expect(
			buildDispatchFingerprint({ event: "run.completed", entityId: "lst-1", payload: { other: "x" } }),
		).toBe("run.completed:lst-1");
	});

	it("differs across distinct subjects (different runId)", () => {
		const a = buildDispatchFingerprint({ event: "run.completed", entityId: "lst-1", payload: { runId: "run-1" } });
		const b = buildDispatchFingerprint({ event: "run.completed", entityId: "lst-1", payload: { runId: "run-2" } });
		expect(a).not.toBe(b);
	});

	it("differs across distinct events for the same subject", () => {
		const a = buildDispatchFingerprint({ event: "run.completed", entityId: "lst-1" });
		const b = buildDispatchFingerprint({ event: "run.state_changed", entityId: "lst-1" });
		expect(a).not.toBe(b);
	});

	it("differs across distinct entities for the same event", () => {
		const a = buildDispatchFingerprint({ event: "vendor.upserted", entityId: "ven-1" });
		const b = buildDispatchFingerprint({ event: "vendor.upserted", entityId: "ven-2" });
		expect(a).not.toBe(b);
	});
});

describe("selectMatchingPlaybooks -- boundary cases", () => {
	it("returns an empty array when there are no triggers", () => {
		expect(selectMatchingPlaybooks([], "run.completed", ["set-x"])).toEqual([]);
	});

	it("returns an empty array when no trigger matches the event", () => {
		const triggers = [
			{ playbookId: "p1", playbookVersionId: "v1", triggerType: "lifecycle_event" as const, triggerEvent: "vendor.upserted", entitySetIds: [] },
		];
		expect(selectMatchingPlaybooks(triggers, "run.completed", [])).toEqual([]);
	});

	it("matches a scoped trigger when ANY candidate set intersects", () => {
		const scoped = trigger({ entitySetIds: ["set-a", "set-b"] });
		expect(playbookTriggerMatches(scoped, "run.completed", ["set-x", "set-b", "set-y"])).toBe(true);
	});
});
