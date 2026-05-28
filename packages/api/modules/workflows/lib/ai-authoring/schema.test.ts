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

	it("rejects dueType values the run engine can't resolve yet", () => {
		const wf = baseWorkflow();
		(wf.steps[0] as unknown as { dueType: string }).dueType = "offset_from_step";
		expect(AuthoredWorkflowSchema.safeParse(wf).success).toBe(false);
		(wf.steps[0] as unknown as { dueType: string }).dueType = "from_date_field";
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

	it("AI_ALLOWED_DUE_TYPES matches launchRun reality", () => {
		// Per memory `due_type_ui_constraint`: Builder Pass 3 only offers none +
		// offset_from_start until launchRun.computeStepDueAt is extended.
		expect([...AI_ALLOWED_DUE_TYPES]).toEqual(["none", "offset_from_start"]);
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
});
