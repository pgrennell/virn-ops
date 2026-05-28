// schema.test.ts
//
// Validator tests for the AI authoring output (Phase 12.1). These tests verify the
// palette/dueType gates that prevent the model from emitting values the run engine
// can't handle (per memory `due_type_ui_constraint` -- only `none` and
// `offset_from_start` are wired into launchRun.computeStepDueAt today).
//
// No DB. No network. Pure validator coverage.

import { describe, expect, it } from "vitest";

import {
	AI_ALLOWED_DUE_TYPES,
	AI_ALLOWED_STEP_TYPES,
	AuthoredWorkflowSchema,
	assertAuthoredWorkflowReferences,
} from "./schema";

interface MutableField {
	key: string;
	label: string;
	fieldType: string;
	isRequired?: boolean;
	config?: Record<string, unknown> | null;
}
interface MutableStep {
	title: string;
	description?: string | null;
	type: string;
	isRequired?: boolean;
	isStopTask?: boolean;
	sectionIndex?: number | null;
	dueType?: string;
	dueOffsetDays?: number | null;
	dueAnchorStepIndex?: number | null;
	dueSourceFieldKey?: string | null;
	fields?: MutableField[];
}
interface MutableWorkflow {
	title: string;
	description?: string | null;
	type?: string;
	sections?: Array<{ title: string }>;
	kickoffFields?: MutableField[];
	steps: MutableStep[];
}

function baseWorkflow(): MutableWorkflow {
	return {
		title: "Test workflow",
		description: "Generated for tests",
		type: "procedure",
		sections: [{ title: "Setup" }],
		kickoffFields: [],
		steps: [
			{
				title: "First step",
				description: null,
				type: "task",
				sectionIndex: 0,
				dueType: "none",
				fields: [],
			},
		],
	};
}

describe("AuthoredWorkflowSchema -- closed-set gates", () => {
	it("accepts a minimal valid workflow", () => {
		const result = AuthoredWorkflowSchema.safeParse(baseWorkflow());
		expect(result.success).toBe(true);
	});

	it("rejects step.type values outside the allowed palette", () => {
		const wf = baseWorkflow();
		// `code` exists in the DB enum but is reserved -- the AI must not emit it.
		(wf.steps[0] as unknown as { type: string }).type = "code";
		const result = AuthoredWorkflowSchema.safeParse(wf);
		expect(result.success).toBe(false);
		// Also `ai`:
		(wf.steps[0] as unknown as { type: string }).type = "ai";
		expect(AuthoredWorkflowSchema.safeParse(wf).success).toBe(false);
	});

	it("accepts the full launchRun-resolvable dueType set", () => {
		// Phase 12.2 -- launchRun + recompute hook now handle all four dueTypes.
		const wf = baseWorkflow();
		// offset_from_step requires an anchor + offset
		wf.steps[0].dueType = "offset_from_step";
		wf.steps[0].dueOffsetDays = 2;
		wf.steps[0].dueAnchorStepIndex = 0;
		expect(AuthoredWorkflowSchema.safeParse(wf).success).toBe(true);
		// from_date_field requires a source key + offset
		wf.steps[0].dueType = "from_date_field";
		wf.steps[0].dueAnchorStepIndex = null;
		wf.steps[0].dueSourceFieldKey = "guest_arrival";
		expect(AuthoredWorkflowSchema.safeParse(wf).success).toBe(true);
	});

	it("rejects step types reserved for future modules (`code`, `ai`)", () => {
		const wf = baseWorkflow();
		wf.steps[0].type = "code";
		expect(AuthoredWorkflowSchema.safeParse(wf).success).toBe(false);
		wf.steps[0].type = "ai";
		expect(AuthoredWorkflowSchema.safeParse(wf).success).toBe(false);
	});

	it("AI_ALLOWED_STEP_TYPES matches Builder Pass 3 reality", () => {
		// Documents the contract -- if the run engine adds support for `code` or `ai`,
		// the test should fail and force a deliberate widening.
		expect([...AI_ALLOWED_STEP_TYPES]).toEqual([
			"task",
			"approval",
			"heading",
			"one_off",
		]);
	});

	it("AI_ALLOWED_DUE_TYPES matches launchRun reality (Phase 12.2: all four)", () => {
		expect([...AI_ALLOWED_DUE_TYPES]).toEqual([
			"none",
			"offset_from_start",
			"offset_from_step",
			"from_date_field",
		]);
	});

	it("rejects workflow with zero steps", () => {
		const wf = baseWorkflow();
		wf.steps = [];
		expect(AuthoredWorkflowSchema.safeParse(wf).success).toBe(false);
	});
});

describe("assertAuthoredWorkflowReferences -- cross-field invariants", () => {
	it("catches duplicate field keys across kickoff + step fields (shared namespace)", () => {
		const wf = baseWorkflow();
		wf.kickoffFields = [
			{ key: "owner_name", label: "Owner name", fieldType: "text" } as never,
		];
		wf.steps[0].fields = [
			{ key: "owner_name", label: "Owner (again)", fieldType: "text" } as never,
		];
		const issues = assertAuthoredWorkflowReferences(wf as never);
		expect(issues.length).toBe(1);
		expect(issues[0].message).toContain("Duplicate field key");
		expect(issues[0].path).toContain("steps[0].fields[0]");
	});

	it("catches out-of-range sectionIndex", () => {
		const wf = baseWorkflow();
		wf.steps[0].sectionIndex = 5; // only one section exists
		const issues = assertAuthoredWorkflowReferences(wf as never);
		expect(issues.length).toBe(1);
		expect(issues[0].path).toBe("steps[0].sectionIndex");
		expect(issues[0].message).toMatch(/out of range/);
	});

	it("allows null sectionIndex", () => {
		const wf = baseWorkflow();
		wf.steps[0].sectionIndex = null;
		const issues = assertAuthoredWorkflowReferences(wf as never);
		expect(issues).toEqual([]);
	});

	it("requires dueOffsetDays when dueType is offset_from_start", () => {
		const wf = baseWorkflow();
		wf.steps[0].dueType = "offset_from_start";
		// no dueOffsetDays
		const issues = assertAuthoredWorkflowReferences(wf as never);
		expect(issues.length).toBe(1);
		expect(issues[0].path).toBe("steps[0].dueOffsetDays");
		expect(issues[0].message).toMatch(/requires dueOffsetDays/);
	});

	it("refuses dueOffsetDays when dueType is none (ignored values are misleading)", () => {
		const wf = baseWorkflow();
		wf.steps[0].dueType = "none";
		(wf.steps[0] as unknown as { dueOffsetDays: number }).dueOffsetDays = 7;
		const issues = assertAuthoredWorkflowReferences(wf as never);
		expect(issues.length).toBe(1);
		expect(issues[0].path).toBe("steps[0].dueOffsetDays");
		expect(issues[0].message).toMatch(/must be omitted/);
	});

	it("returns empty list for a fully-consistent workflow", () => {
		const wf = baseWorkflow();
		wf.steps[0].dueType = "offset_from_start";
		(wf.steps[0] as unknown as { dueOffsetDays: number }).dueOffsetDays = 7;
		wf.kickoffFields = [
			{ key: "owner_name", label: "Owner", fieldType: "text" } as never,
		];
		wf.steps[0].fields = [
			{ key: "completion_notes", label: "Notes", fieldType: "textarea" } as never,
		];
		const issues = assertAuthoredWorkflowReferences(wf as never);
		expect(issues).toEqual([]);
	});

	// ---- Phase 12.2: offset_from_step ----

	function twoStepWorkflow(): MutableWorkflow {
		return {
			title: "Two-step workflow",
			type: "procedure",
			sections: [],
			kickoffFields: [],
			steps: [
				{ title: "First", type: "task" },
				{ title: "Second", type: "task" },
			],
		};
	}

	it("offset_from_step requires dueOffsetDays + dueAnchorStepIndex", () => {
		const wf = twoStepWorkflow();
		wf.steps[1].dueType = "offset_from_step";
		// neither offset nor anchor
		let issues = assertAuthoredWorkflowReferences(wf as never);
		expect(issues.map((i) => i.path)).toEqual(
			expect.arrayContaining([
				"steps[1].dueOffsetDays",
				"steps[1].dueAnchorStepIndex",
			]),
		);

		// offset set, still no anchor
		wf.steps[1].dueOffsetDays = 2;
		issues = assertAuthoredWorkflowReferences(wf as never);
		expect(issues.length).toBe(1);
		expect(issues[0].path).toBe("steps[1].dueAnchorStepIndex");

		// anchor set -- now valid
		wf.steps[1].dueAnchorStepIndex = 0;
		expect(assertAuthoredWorkflowReferences(wf as never)).toEqual([]);
	});

	it("offset_from_step rejects out-of-range anchor index", () => {
		const wf = twoStepWorkflow();
		wf.steps[1].dueType = "offset_from_step";
		wf.steps[1].dueOffsetDays = 2;
		wf.steps[1].dueAnchorStepIndex = 5; // only 2 steps
		const issues = assertAuthoredWorkflowReferences(wf as never);
		expect(issues.length).toBe(1);
		expect(issues[0].path).toBe("steps[1].dueAnchorStepIndex");
		expect(issues[0].message).toMatch(/out of range/);
	});

	it("offset_from_step rejects self-anchor", () => {
		const wf = twoStepWorkflow();
		wf.steps[1].dueType = "offset_from_step";
		wf.steps[1].dueOffsetDays = 2;
		wf.steps[1].dueAnchorStepIndex = 1; // step 1 anchoring on itself
		const issues = assertAuthoredWorkflowReferences(wf as never);
		expect(issues.length).toBe(1);
		expect(issues[0].message).toMatch(/cannot anchor on itself/);
	});

	it("offset_from_step rejects spurious dueSourceFieldKey", () => {
		const wf = twoStepWorkflow();
		wf.steps[1].dueType = "offset_from_step";
		wf.steps[1].dueOffsetDays = 2;
		wf.steps[1].dueAnchorStepIndex = 0;
		wf.steps[1].dueSourceFieldKey = "stray";
		const issues = assertAuthoredWorkflowReferences(wf as never);
		expect(issues.some((i) => i.path === "steps[1].dueSourceFieldKey")).toBe(true);
	});

	// ---- Phase 12.2: from_date_field ----

	it("from_date_field requires offset + dueSourceFieldKey that references a date field", () => {
		const wf = twoStepWorkflow();
		wf.kickoffFields = [
			{ key: "guest_arrival", label: "Guest arrival", fieldType: "date" },
		];
		wf.steps[1].dueType = "from_date_field";
		// missing offset + key
		let issues = assertAuthoredWorkflowReferences(wf as never);
		expect(issues.length).toBe(2);

		wf.steps[1].dueOffsetDays = -1;
		wf.steps[1].dueSourceFieldKey = "guest_arrival";
		expect(assertAuthoredWorkflowReferences(wf as never)).toEqual([]);
	});

	it("from_date_field rejects unknown source field key", () => {
		const wf = twoStepWorkflow();
		wf.steps[1].dueType = "from_date_field";
		wf.steps[1].dueOffsetDays = 2;
		wf.steps[1].dueSourceFieldKey = "nonexistent";
		const issues = assertAuthoredWorkflowReferences(wf as never);
		expect(issues.length).toBe(1);
		expect(issues[0].message).toMatch(/doesn't match any field/);
	});

	it("from_date_field rejects non-date source field", () => {
		const wf = twoStepWorkflow();
		wf.kickoffFields = [
			{ key: "owner_name", label: "Owner", fieldType: "text" },
		];
		wf.steps[1].dueType = "from_date_field";
		wf.steps[1].dueOffsetDays = 2;
		wf.steps[1].dueSourceFieldKey = "owner_name";
		const issues = assertAuthoredWorkflowReferences(wf as never);
		expect(issues.length).toBe(1);
		expect(issues[0].message).toMatch(/must reference a 'date' field/);
	});

	it("from_date_field can source a date field on another step (not just kickoff)", () => {
		const wf = twoStepWorkflow();
		wf.steps[0].fields = [
			{ key: "lease_start", label: "Lease start", fieldType: "date" },
		];
		wf.steps[1].dueType = "from_date_field";
		wf.steps[1].dueOffsetDays = 7;
		wf.steps[1].dueSourceFieldKey = "lease_start";
		expect(assertAuthoredWorkflowReferences(wf as never)).toEqual([]);
	});

	// ---- Phase 12.2 follow-up: position ordering (#5 from code review) ----

	it("offset_from_step rejects anchoring on a LATER step (recompute would never fire)", () => {
		const wf = twoStepWorkflow();
		wf.steps[0].dueType = "offset_from_step";
		wf.steps[0].dueOffsetDays = 2;
		wf.steps[0].dueAnchorStepIndex = 1; // step 0 anchoring on step 1 (later)
		const issues = assertAuthoredWorkflowReferences(wf as never);
		expect(issues.length).toBe(1);
		expect(issues[0].path).toBe("steps[0].dueAnchorStepIndex");
		expect(issues[0].message).toMatch(/later than this one/);
	});

	it("from_date_field rejects sourcing from a LATER step's field", () => {
		const wf = twoStepWorkflow();
		wf.steps[1].fields = [
			{ key: "lease_start", label: "Lease start", fieldType: "date" },
		];
		wf.steps[0].dueType = "from_date_field";
		wf.steps[0].dueOffsetDays = 3;
		wf.steps[0].dueSourceFieldKey = "lease_start";
		const issues = assertAuthoredWorkflowReferences(wf as never);
		expect(issues.length).toBe(1);
		expect(issues[0].path).toBe("steps[0].dueSourceFieldKey");
		expect(issues[0].message).toMatch(/runs AFTER this step/);
	});

	it("from_date_field rejects sourcing from a field on the SAME step", () => {
		const wf = twoStepWorkflow();
		wf.steps[0].fields = [
			{ key: "lease_start", label: "Lease start", fieldType: "date" },
		];
		wf.steps[0].dueType = "from_date_field";
		wf.steps[0].dueOffsetDays = 3;
		wf.steps[0].dueSourceFieldKey = "lease_start";
		const issues = assertAuthoredWorkflowReferences(wf as never);
		expect(issues.length).toBe(1);
		expect(issues[0].message).toMatch(/lives on the same step/);
	});

	it("from_date_field allows kickoff date sources regardless of dependent step position", () => {
		const wf = twoStepWorkflow();
		wf.kickoffFields = [
			{ key: "guest_arrival", label: "Guest arrival", fieldType: "date" },
		];
		wf.steps[0].dueType = "from_date_field";
		wf.steps[0].dueOffsetDays = -1;
		wf.steps[0].dueSourceFieldKey = "guest_arrival";
		expect(assertAuthoredWorkflowReferences(wf as never)).toEqual([]);
	});

	it("none + spurious dueAnchorStepIndex / dueSourceFieldKey are flagged", () => {
		const wf = twoStepWorkflow();
		wf.steps[0].dueType = "none";
		wf.steps[0].dueAnchorStepIndex = 1;
		wf.steps[0].dueSourceFieldKey = "stray";
		const issues = assertAuthoredWorkflowReferences(wf as never);
		expect(issues.map((i) => i.path)).toEqual(
			expect.arrayContaining([
				"steps[0].dueAnchorStepIndex",
				"steps[0].dueSourceFieldKey",
			]),
		);
	});
});
