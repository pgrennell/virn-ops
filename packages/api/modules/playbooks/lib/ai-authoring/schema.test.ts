// Phase 18c -- tests for the AI playbook-output Zod contract + reference checker.

import { describe, expect, it } from "vitest";

import {
	AuthoredPlaybookSchema,
	assertAuthoredPlaybookReferences,
	type AuthoredPlaybook,
} from "./schema";

function parse(input: unknown) {
	return AuthoredPlaybookSchema.safeParse(input);
}

describe("AuthoredPlaybookSchema -- parse guard", () => {
	it("accepts a valid multi-type playbook", () => {
		const r = parse({
			name: "STR post-stay review",
			steps: [
				{ type: "wait_for_duration", config: { amount: 1, unit: "days" } },
				{ type: "send_notification", config: { type: "ACKNOWLEDGMENT_DUE" } },
			],
		});
		expect(r.success).toBe(true);
	});

	it("rejects an unknown step type", () => {
		const r = parse({
			name: "x",
			steps: [{ type: "frobnicate", config: {} }],
		});
		expect(r.success).toBe(false);
	});

	it("rejects a wait_for_duration with a bad unit", () => {
		const r = parse({
			name: "x",
			steps: [{ type: "wait_for_duration", config: { amount: 1, unit: "fortnights" } }],
		});
		expect(r.success).toBe(false);
	});

	it("rejects a non-positive duration amount", () => {
		const r = parse({
			name: "x",
			steps: [{ type: "wait_for_duration", config: { amount: 0, unit: "days" } }],
		});
		expect(r.success).toBe(false);
	});

	it("requires at least one step + a name", () => {
		expect(parse({ name: "x", steps: [] }).success).toBe(false);
		expect(parse({ steps: [{ type: "send_notification", config: {} }] }).success).toBe(false);
	});

	it("requires branch_on_data_set to declare branches", () => {
		const r = parse({
			name: "x",
			steps: [{ type: "branch_on_data_set", config: { source: "run.status", branches: [] } }],
		});
		expect(r.success).toBe(false);
	});
});

describe("assertAuthoredPlaybookReferences", () => {
	const ok = (pb: AuthoredPlaybook) => assertAuthoredPlaybookReferences(pb);

	it("passes a clean linear playbook", () => {
		expect(
			ok({
				name: "x",
				steps: [
					{ type: "wait_for_duration", config: { amount: 1, unit: "hours" } },
					{ type: "send_notification", config: { userId: "u1", type: "APP_UPDATE" } },
				],
			}),
		).toEqual([]);
	});

	it("flags launch_workflow without exactly one target", () => {
		const none = ok({
			name: "x",
			steps: [{ type: "launch_workflow", config: {} }],
		});
		expect(none).toHaveLength(1);
		const both = ok({
			name: "x",
			steps: [{ type: "launch_workflow", config: { workflowId: "w1", workflowSlug: "s1" } }],
		});
		expect(both).toHaveLength(1);
		const oneId = ok({
			name: "x",
			steps: [{ type: "launch_workflow", config: { workflowId: "w1" } }],
		});
		expect(oneId).toEqual([]);
	});

	it("accepts a valid branch parent + child", () => {
		expect(
			ok({
				name: "x",
				steps: [
					{ type: "branch_on_data_set", config: { source: "run.status", branches: ["completed", "failed"] } },
					{ type: "send_notification", config: { type: "APP_UPDATE" }, parentStepIndex: 0, branchLabel: "completed" },
				],
			}),
		).toEqual([]);
	});

	it("flags a branch child whose label isn't one of the parent's branches", () => {
		const issues = ok({
			name: "x",
			steps: [
				{ type: "branch_on_data_set", config: { source: "s", branches: ["yes", "no"] } },
				{ type: "send_notification", config: {}, parentStepIndex: 0, branchLabel: "maybe" },
			],
		});
		expect(issues).toHaveLength(1);
		expect(issues[0].path).toBe("steps[1].branchLabel");
	});

	it("flags a parentStepIndex that isn't a branch step", () => {
		const issues = ok({
			name: "x",
			steps: [
				{ type: "wait_for_duration", config: { amount: 1, unit: "days" } },
				{ type: "send_notification", config: {}, parentStepIndex: 0, branchLabel: "x" },
			],
		});
		expect(issues).toHaveLength(1);
		expect(issues[0].message).toMatch(/branch_on_data_set/);
	});

	it("flags a forward / self parent reference", () => {
		const forward = ok({
			name: "x",
			steps: [
				{ type: "send_notification", config: {}, parentStepIndex: 1, branchLabel: "a" },
				{ type: "branch_on_data_set", config: { source: "s", branches: ["a"] } },
			],
		});
		expect(forward).toHaveLength(1);
		expect(forward[0].message).toMatch(/EARLIER/);
	});

	it("flags branchLabel without parentStepIndex (and vice versa)", () => {
		const labelOnly = ok({
			name: "x",
			steps: [{ type: "send_notification", config: {}, branchLabel: "a" }],
		});
		expect(labelOnly).toHaveLength(1);
		const parentOnly = ok({
			name: "x",
			steps: [
				{ type: "branch_on_data_set", config: { source: "s", branches: ["a"] } },
				{ type: "send_notification", config: {}, parentStepIndex: 0 },
			],
		});
		expect(parentOnly).toHaveLength(1);
	});

	// Phase 18 hardening (A4) -- reference-checker edge cases not yet pinned.
	it("flags a parentStepIndex that is out of range", () => {
		const issues = ok({
			name: "x",
			steps: [
				{ type: "branch_on_data_set", config: { source: "s", branches: ["a"] } },
				{ type: "send_notification", config: {}, parentStepIndex: 5, branchLabel: "a" },
			],
		});
		expect(issues).toHaveLength(1);
		expect(issues[0].path).toBe("steps[1].parentStepIndex");
		expect(issues[0].message).toMatch(/out of range/);
	});

	it("flags a step that references ITSELF as its branch parent", () => {
		const issues = ok({
			name: "x",
			steps: [
				{ type: "send_notification", config: {}, parentStepIndex: 0, branchLabel: "a" },
			],
		});
		expect(issues).toHaveLength(1);
		expect(issues[0].message).toMatch(/EARLIER/);
	});

	it("accumulates multiple independent issues in a single pass", () => {
		const issues = ok({
			name: "x",
			steps: [
				// issue 1: launch_workflow has no target
				{ type: "launch_workflow", config: {} },
				// issue 2: parent (index 0) is not a branch step
				{ type: "send_notification", config: {}, parentStepIndex: 0, branchLabel: "x" },
			],
		});
		expect(issues).toHaveLength(2);
	});

	it("accepts two children sharing the same valid branch label (fan-out)", () => {
		expect(
			ok({
				name: "x",
				steps: [
					{ type: "branch_on_data_set", config: { source: "s", branches: ["go"] } },
					{ type: "send_notification", config: {}, parentStepIndex: 0, branchLabel: "go" },
					{ type: "wait_for_duration", config: { amount: 1, unit: "days" }, parentStepIndex: 0, branchLabel: "go" },
				],
			}),
		).toEqual([]);
	});

	// DECISION (A4): the reference checker does NOT reject duplicate labels inside a
	// branch_on_data_set's `branches` array. Duplicates are harmless at runtime
	// (evaluateBranch uses branches.includes, and non-taken children are skipped by
	// label match), and rejecting them would be a speculative authoring-strictness
	// rule with no correctness basis -- so we characterize current behaviour instead
	// of tightening it. Revisit only if a real authoring confusion surfaces.
	it("permits duplicate labels within a branch's `branches` array (documented)", () => {
		const pb: AuthoredPlaybook = {
			name: "x",
			steps: [
				{ type: "branch_on_data_set", config: { source: "s", branches: ["yes", "yes"] } },
				{ type: "send_notification", config: {}, parentStepIndex: 0, branchLabel: "yes" },
			],
		};
		expect(parse(pb).success).toBe(true);
		expect(ok(pb)).toEqual([]);
	});
});

describe("AuthoredPlaybookSchema -- write_to_data_set parse guard", () => {
	it("requires both dataSetKey and label", () => {
		expect(parse({ name: "x", steps: [{ type: "write_to_data_set", config: { label: "y" } }] }).success).toBe(false);
		expect(parse({ name: "x", steps: [{ type: "write_to_data_set", config: { dataSetKey: "k" } }] }).success).toBe(false);
		expect(parse({ name: "x", steps: [{ type: "write_to_data_set", config: { dataSetKey: "k", label: "y" } }] }).success).toBe(true);
	});

	it("requires a non-empty eventName for wait_for_event", () => {
		expect(parse({ name: "x", steps: [{ type: "wait_for_event", config: { eventName: "" } }] }).success).toBe(false);
		expect(parse({ name: "x", steps: [{ type: "wait_for_event", config: { eventName: "approved" } }] }).success).toBe(true);
	});
});
