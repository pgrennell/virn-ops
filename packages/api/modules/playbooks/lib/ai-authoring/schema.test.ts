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
});
