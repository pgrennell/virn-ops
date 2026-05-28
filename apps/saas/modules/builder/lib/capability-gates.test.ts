// capability-gates.test.ts
//
// Pass 3 palette gating tests (UX_SPEC §4.3 + memory: project_builder_pass3_constraints).
// Each authoring affordance must gate on a specific capability; flipping the cap on/off
// must enable/disable the corresponding picker option (not silently hide -- the option
// stays visible with a "needs X" hint so the operator can discover what's possible).

import { describe, expect, it } from "vitest";

import { buildGatingSnapshot } from "@shared/lib/gating";

import {
	computePaletteGates,
	getDueTypeOptions,
	getFieldTypeOptions,
	getStepTypeOptions,
} from "./capability-gates";

function snapshotWith(caps: string[]) {
	return buildGatingSnapshot("admin", caps);
}

describe("computePaletteGates -- capability -> palette flag mapping (UX_SPEC §4.3)", () => {
	it("all gates OFF when no capabilities are enabled", () => {
		const gates = computePaletteGates(snapshotWith([]));
		expect(gates).toEqual({
			approvalStepType: false,
			aiStepType: false,
			conditionEditor: false,
			stopTaskEditor: false,
			guestAssignees: false,
			advancedFieldTypes: false,
		});
	});

	it("approval step type unlocks with governance.approvals", () => {
		const gates = computePaletteGates(snapshotWith(["governance.approvals"]));
		expect(gates.approvalStepType).toBe(true);
		expect(gates.conditionEditor).toBe(false);
		expect(gates.stopTaskEditor).toBe(false);
	});

	it("AI step type unlocks with workflows.agent_steps (Phase 8 step 4 lift)", () => {
		const gates = computePaletteGates(snapshotWith(["workflows.agent_steps"]));
		expect(gates.aiStepType).toBe(true);
		expect(gates.approvalStepType).toBe(false);
	});

	it("automation.rules unlocks BOTH conditionEditor and stopTaskEditor (one cap, two affordances)", () => {
		const gates = computePaletteGates(snapshotWith(["automation.rules"]));
		expect(gates.conditionEditor).toBe(true);
		expect(gates.stopTaskEditor).toBe(true);
		expect(gates.approvalStepType).toBe(false);
		expect(gates.guestAssignees).toBe(false);
	});

	it("workflows.guest_participants unlocks guest assignees", () => {
		const gates = computePaletteGates(snapshotWith(["workflows.guest_participants"]));
		expect(gates.guestAssignees).toBe(true);
	});

	it("fields.custom_definitions unlocks advanced field types", () => {
		const gates = computePaletteGates(snapshotWith(["fields.custom_definitions"]));
		expect(gates.advancedFieldTypes).toBe(true);
	});
});

describe("getStepTypeOptions -- approval + ai gate on their capabilities; code stays reserved", () => {
	const allOff = computePaletteGates(snapshotWith([]));
	const allOn = computePaletteGates(
		snapshotWith([
			"governance.approvals",
			"workflows.agent_steps",
			"automation.rules",
			"workflows.guest_participants",
			"fields.custom_definitions",
		]),
	);

	it("task / heading / one_off are always enabled", () => {
		const opts = getStepTypeOptions(allOff);
		expect(opts.find((o) => o.value === "task")?.enabled).toBe(true);
		expect(opts.find((o) => o.value === "heading")?.enabled).toBe(true);
		expect(opts.find((o) => o.value === "one_off")?.enabled).toBe(true);
	});

	it("approval is DISABLED when governance.approvals is off, ENABLED when on", () => {
		expect(getStepTypeOptions(allOff).find((o) => o.value === "approval")?.enabled).toBe(false);
		expect(getStepTypeOptions(allOn).find((o) => o.value === "approval")?.enabled).toBe(true);
	});

	it("ai is DISABLED when workflows.agent_steps is off, ENABLED when on (Phase 8 step 4 lift)", () => {
		expect(getStepTypeOptions(allOff).find((o) => o.value === "ai")?.enabled).toBe(false);
		expect(getStepTypeOptions(allOn).find((o) => o.value === "ai")?.enabled).toBe(true);
	});

	it("disabled options carry an actionable disabledReason (not silently hidden)", () => {
		const approval = getStepTypeOptions(allOff).find((o) => o.value === "approval");
		expect(approval?.disabledReason).toMatch(/Governance/i);
		expect(approval?.disabledReason).toMatch(/Configuration/);

		const ai = getStepTypeOptions(allOff).find((o) => o.value === "ai");
		expect(ai?.disabledReason).toMatch(/AI Agent Steps/i);
		expect(ai?.disabledReason).toMatch(/Configuration/);
	});

	it("code stays always reserved (no script-execution capability today)", () => {
		expect(getStepTypeOptions(allOn).find((o) => o.value === "code")?.enabled).toBe(false);
		expect(getStepTypeOptions(allOff).find((o) => o.value === "code")?.enabled).toBe(false);
	});
});

describe("getFieldTypeOptions -- advanced types gate on fields.custom_definitions", () => {
	const allOff = computePaletteGates(snapshotWith([]));
	const customOn = computePaletteGates(snapshotWith(["fields.custom_definitions"]));

	const basicTypes = ["text", "textarea", "number", "date", "select", "multiselect"];
	const advancedTypes = ["file", "image", "signature", "member", "lookup"];

	it("basic types are always enabled", () => {
		for (const t of basicTypes) {
			expect(getFieldTypeOptions(allOff).find((o) => o.value === t)?.enabled).toBe(true);
		}
	});

	it("advanced types are disabled when capability is off", () => {
		for (const t of advancedTypes) {
			const opt = getFieldTypeOptions(allOff).find((o) => o.value === t);
			expect(opt?.enabled).toBe(false);
			expect(opt?.disabledReason).toMatch(/Custom Fields/i);
		}
	});

	it("advanced types remain disabled even with capability ON (storage pipeline + directory deferred)", () => {
		// This is the "reserved -- storage pipeline coming soon" carve-out. When the
		// pipeline lands, flip to expecting enabled=true with the capability on.
		for (const t of advancedTypes) {
			const opt = getFieldTypeOptions(customOn).find((o) => o.value === t);
			expect(opt?.enabled).toBe(false);
			expect(opt?.disabledReason).toMatch(/upload pipeline|member directory|data-sets/i);
		}
	});
});

describe("getDueTypeOptions -- Phase 12.2: all four resolvable in launchRun", () => {
	it("all four options are enabled (memory: project_due_type_ui_constraint cleared)", () => {
		const opts = getDueTypeOptions();
		expect(opts.find((o) => o.value === "none")?.enabled).toBe(true);
		expect(opts.find((o) => o.value === "offset_from_start")?.enabled).toBe(true);
		expect(opts.find((o) => o.value === "offset_from_step")?.enabled).toBe(true);
		expect(opts.find((o) => o.value === "from_date_field")?.enabled).toBe(true);
	});

	it("no option carries a disabledReason now that the run engine resolves them all", () => {
		const opts = getDueTypeOptions();
		for (const o of opts) {
			expect(o.disabledReason).toBeUndefined();
		}
	});
});
