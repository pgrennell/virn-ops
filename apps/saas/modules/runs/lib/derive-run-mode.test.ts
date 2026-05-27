// apps/saas/modules/runs/lib/derive-run-mode.test.ts
//
// Pure-function tests for the run-mode classifier. Mirrors the launcher's mode
// taxonomy (Phase 8 step 3) -- the classifier is the inverse of LaunchModePicker:
// given the snapshot a run carries, infer which mode launched it.

import { describe, expect, it } from "vitest";

import { deriveRunMode } from "./derive-run-mode";

const user = (id: string) => ({ id, kind: "user" });
const guest = (id: string) => ({ id, kind: "guest" });
const agent = (id: string) => ({ id, kind: "agent" });
const vendor = (id: string) => ({ id, kind: "vendor" });

const step = (...participantIds: string[]) => ({
	assignees: participantIds.map((id) => ({ participant: { id } })),
});

describe("deriveRunMode", () => {
	it("returns 'human' when no participants are agents", () => {
		expect(
			deriveRunMode([step("p1"), step("p2")], [user("p1"), user("p2")]),
		).toBe("human");
	});

	it("returns 'human' when there are no steps (edge case)", () => {
		expect(deriveRunMode([], [agent("p1")])).toBe("human");
	});

	it("returns 'human' when no participants at all", () => {
		expect(deriveRunMode([step("p1")], [])).toBe("human");
	});

	it("returns 'human' for a run with vendors + users but no agents (vendor doesn't shift mode)", () => {
		expect(
			deriveRunMode(
				[step("p1"), step("p2")],
				[user("p1"), vendor("p2")],
			),
		).toBe("human");
	});

	it("returns 'automated' when every step has an agent assignee", () => {
		expect(
			deriveRunMode([step("a1"), step("a1"), step("a1")], [agent("a1")]),
		).toBe("automated");
	});

	it("returns 'ai_assisted' when some but not all steps have an agent assignee", () => {
		expect(
			deriveRunMode(
				[step("a1"), step("u1"), step("a1")],
				[agent("a1"), user("u1")],
			),
		).toBe("ai_assisted");
	});

	it("returns 'human' when there's an agent participant but no agent-owned steps (defensive)", () => {
		// Can happen if a launch tried ai_assisted mode but no step.type='ai' steps existed --
		// the agent participant row is suppressed in launch-run.ts but the helper guards too.
		expect(
			deriveRunMode([step("u1"), step("u1")], [user("u1"), agent("a1")]),
		).toBe("human");
	});

	it("counts a step with mixed (user + agent) assignees as agent-owned", () => {
		// Steps can have multiple assignees post-Phase-8; if any assignee is the agent, the
		// step is agent-owned for the mode-classification purpose.
		expect(
			deriveRunMode(
				[step("u1", "a1"), step("u1")],
				[user("u1"), agent("a1")],
			),
		).toBe("ai_assisted");
	});

	it("ignores guest + vendor assignees when counting agent ownership", () => {
		expect(
			deriveRunMode(
				[step("a1"), step("v1"), step("g1")],
				[agent("a1"), vendor("v1"), guest("g1")],
			),
		).toBe("ai_assisted");
		// (Not 'automated' -- only 1 of 3 steps is agent-owned.)
	});
});
