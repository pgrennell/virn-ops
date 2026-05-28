// authoring.test.ts
//
// Unit coverage for the Phase 12.1 authorWorkflow lib. Mocks @virn/database at the
// boundary (same pattern as publish.test.ts) and injects a stub callClaude so no
// network is required.
//
// Three scopes:
//   1. Happy path -- valid JSON in, workflow built with provenance row + correct
//      step/field/section structure.
//   2. Validation refusals -- malformed JSON, schema violations, ref-check failures
//      all surface as WorkflowEngineError('AI_AUTHORING_INVALID_OUTPUT').
//   3. Field-key namespace -- duplicate keys across kickoff + step get caught by the
//      validator (not the DB) so the user gets a structured error, not a 500.

import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted DB stub -- tx === db; transaction is a passthrough.
// ---------------------------------------------------------------------------

const { dbStub } = vi.hoisted(() => {
	const stub: { transaction: ReturnType<typeof vi.fn> } = {
		transaction: vi.fn(),
	};
	stub.transaction.mockImplementation(
		async (fn: (tx: unknown) => Promise<unknown>) => fn(stub),
	);
	return { dbStub: stub };
});

vi.mock("@virn/database", () => ({
	db: dbStub,
	insertAuthoringPrompt: vi.fn(),
	insertField: vi.fn(),
	insertSection: vi.fn(),
	insertStep: vi.fn(),
	insertWorkflowWithDraft: vi.fn(),
	updateStep: vi.fn(),
	writeAuditAndActivity: vi.fn(),
	// assertStepDueRefs (called from authoring's second pass) reads these via
	// the same path structure.ts's assertDueRefs does -- stub to return rows
	// in the same version so the guard passes by default. Individual tests
	// can override for failure-path coverage if needed.
	getStepWithVersion: vi.fn(async () => ({
		step: { id: "st_anchor" },
		version: { id: "ver_1" },
	})),
	getFieldWithVersion: vi.fn(async () => ({
		field: { id: "fld_src", fieldType: "date" },
		version: { id: "ver_1" },
	})),
}));

// Anthropic SDK isn't loaded in tests; the lib imports VIRN_AI_MODEL +
// getAnthropicClient from @virn/ai. We replace the module so the default callClaude
// path isn't dragged in.
vi.mock("@virn/ai", () => ({
	VIRN_AI_MODEL: "claude-sonnet-4-6",
	getAnthropicClient: vi.fn(() => {
		throw new Error("default Anthropic client should not be reached in tests");
	}),
}));

import {
	insertAuthoringPrompt,
	insertField,
	insertSection,
	insertStep,
	insertWorkflowWithDraft,
	updateStep,
	writeAuditAndActivity,
} from "@virn/database";

import { WorkflowEngineError } from "../errors";
import { authorWorkflow, __testables } from "./authoring";

const CTX = {
	organizationId: "org_1",
	userId: "user_1",
};

function makeStubClaude(rawText: string) {
	return vi.fn(async () => ({ text: rawText }));
}

function validAuthoredJson(overrides: Partial<Record<string, unknown>> = {}): string {
	return JSON.stringify({
		title: "Mid-stay inspection",
		description: "Check property between guests",
		type: "procedure",
		sections: [{ title: "Pre-arrival" }],
		kickoffFields: [
			{ key: "guest_arrival_date", label: "Guest arrival date", fieldType: "date" },
		],
		steps: [
			{
				title: "Inspect kitchen",
				type: "task",
				sectionIndex: 0,
				dueType: "offset_from_start",
				dueOffsetDays: 1,
				fields: [
					{
						key: "kitchen_notes",
						label: "Kitchen notes",
						fieldType: "textarea",
					},
				],
			},
			{
				title: "Manager sign-off",
				type: "approval",
				sectionIndex: null,
				dueType: "none",
				isStopTask: true,
			},
		],
		...overrides,
	});
}

beforeEach(() => {
	vi.resetAllMocks();
	dbStub.transaction.mockImplementation(
		async (fn: (tx: unknown) => Promise<unknown>) => fn(dbStub),
	);
	vi.mocked(insertAuthoringPrompt).mockResolvedValue({
		id: "ap_1",
		createdAt: new Date("2026-05-27T00:00:00Z"),
	});
	vi.mocked(insertWorkflowWithDraft).mockResolvedValue({
		workflowId: "wf_1",
		versionId: "ver_1",
	});
	vi.mocked(insertSection).mockImplementation(async (input) => ({
		id: `sec_${input.title.replace(/\s/g, "_")}`,
	}));
	vi.mocked(insertStep).mockImplementation(async (input) => ({
		id: `st_${input.title.replace(/\s/g, "_")}`,
	}));
	vi.mocked(insertField).mockImplementation(async (input) => ({
		id: `fld_${input.key}`,
	}));
	vi.mocked(updateStep).mockResolvedValue(undefined);
});

describe("authorWorkflow -- happy path", () => {
	it("builds workflow with provenance + sections + steps + fields", async () => {
		const callClaude = makeStubClaude(validAuthoredJson());

		const result = await authorWorkflow(
			{ ...CTX, callClaude },
			{ prompt: "Build a mid-stay inspection workflow." },
		);

		// Provenance row written before the workflow build, with the AI's parsed JSON.
		expect(insertAuthoringPrompt).toHaveBeenCalledTimes(1);
		const provArg = vi.mocked(insertAuthoringPrompt).mock.calls[0][0];
		expect(provArg.organizationId).toBe("org_1");
		expect(provArg.userId).toBe("user_1");
		expect(provArg.model).toBe("claude-sonnet-4-6");
		expect(provArg.entitySchemaSnapshot).toMatchObject({ snapshots: expect.any(Array) });

		// Workflow created with the FK pointing at provenance.id.
		expect(insertWorkflowWithDraft).toHaveBeenCalledTimes(1);
		const wfArg = vi.mocked(insertWorkflowWithDraft).mock.calls[0][0];
		expect(wfArg.aiAuthoringPromptId).toBe("ap_1");
		expect(wfArg.title).toBe("Mid-stay inspection");
		expect(wfArg.type).toBe("procedure");

		// One section, two steps, two fields (one kickoff + one step field).
		expect(insertSection).toHaveBeenCalledTimes(1);
		expect(insertStep).toHaveBeenCalledTimes(2);
		expect(insertField).toHaveBeenCalledTimes(2);

		// Step 1 (inspect kitchen) gets sectionIndex=0 -> the section we created.
		const firstStep = vi.mocked(insertStep).mock.calls[0][0];
		expect(firstStep.title).toBe("Inspect kitchen");
		expect(firstStep.sectionId).toBe("sec_Pre-arrival");
		expect(firstStep.dueType).toBe("offset_from_start");
		expect(firstStep.dueOffsetDays).toBe(1);

		// Step 2 (manager sign-off) gets sectionIndex=null -> null sectionId.
		const secondStep = vi.mocked(insertStep).mock.calls[1][0];
		expect(secondStep.title).toBe("Manager sign-off");
		expect(secondStep.sectionId).toBeNull();
		expect(secondStep.type).toBe("approval");
		expect(secondStep.isStopTask).toBe(true);

		// Kickoff field landed with stepId=null.
		const kickoffField = vi.mocked(insertField).mock.calls[0][0];
		expect(kickoffField.stepId).toBeNull();
		expect(kickoffField.key).toBe("guest_arrival_date");

		// Step field references the inspect-kitchen step.
		const stepField = vi.mocked(insertField).mock.calls[1][0];
		expect(stepField.stepId).toBe("st_Inspect_kitchen");
		expect(stepField.key).toBe("kitchen_notes");

		// Audit written outside the transaction.
		expect(writeAuditAndActivity).toHaveBeenCalledTimes(1);
		const auditArg = vi.mocked(writeAuditAndActivity).mock.calls[0][0];
		expect(auditArg.action).toBe("workflow.ai_authored");
		expect(auditArg.entityId).toBe("wf_1");
		expect(auditArg.metadata).toMatchObject({ aiAuthoringPromptId: "ap_1" });

		expect(result).toEqual({
			workflowId: "wf_1",
			draftVersionId: "ver_1",
			authoringPromptId: "ap_1",
			title: "Mid-stay inspection",
			stepCount: 2,
			fieldCount: 2,
		});
	});

	it("strips a ```json fence around the model's response", async () => {
		const fenced = `\`\`\`json\n${validAuthoredJson()}\n\`\`\``;
		const callClaude = makeStubClaude(fenced);

		await expect(
			authorWorkflow({ ...CTX, callClaude }, { prompt: "anything" }),
		).resolves.toMatchObject({ workflowId: "wf_1" });
	});

	it("D-040 -- every AI-emitted step lands with provenance='ai_generated'", async () => {
		const callClaude = makeStubClaude(validAuthoredJson());
		await authorWorkflow({ ...CTX, callClaude }, { prompt: "anything" });
		const calls = vi.mocked(insertStep).mock.calls;
		expect(calls.length).toBeGreaterThan(0);
		for (const [arg] of calls) {
			expect(arg.provenance).toBe("ai_generated");
		}
	});

	it("defaults workflow type to procedure when omitted", async () => {
		const json = JSON.stringify({
			title: "Untyped workflow",
			steps: [{ title: "Step 1", type: "task" }],
		});
		const callClaude = makeStubClaude(json);
		await authorWorkflow({ ...CTX, callClaude }, { prompt: "test" });
		expect(vi.mocked(insertWorkflowWithDraft).mock.calls[0][0].type).toBe(
			"procedure",
		);
	});
});

describe("authorWorkflow -- refusals", () => {
	it("refuses on empty model output", async () => {
		const callClaude = makeStubClaude("");
		await expect(
			authorWorkflow({ ...CTX, callClaude }, { prompt: "x" }),
		).rejects.toMatchObject({
			code: "AI_AUTHORING_INVALID_OUTPUT",
		});
		expect(insertWorkflowWithDraft).not.toHaveBeenCalled();
	});

	it("refuses on malformed JSON", async () => {
		const callClaude = makeStubClaude("{ this is not valid JSON");
		await expect(
			authorWorkflow({ ...CTX, callClaude }, { prompt: "x" }),
		).rejects.toMatchObject({ code: "AI_AUTHORING_INVALID_OUTPUT" });
	});

	it("refuses when the model emits a forbidden step type (palette gate)", async () => {
		const bad = JSON.stringify({
			title: "Bad",
			steps: [{ title: "Run code", type: "code" }],
		});
		const callClaude = makeStubClaude(bad);
		await expect(
			authorWorkflow({ ...CTX, callClaude }, { prompt: "x" }),
		).rejects.toMatchObject({ code: "AI_AUTHORING_INVALID_OUTPUT" });
	});

	it("refuses on duplicate field keys (kickoff + step share namespace)", async () => {
		const dup = JSON.stringify({
			title: "Dup-key wf",
			steps: [
				{
					title: "S",
					type: "task",
					fields: [{ key: "owner", label: "Owner", fieldType: "text" }],
				},
			],
			kickoffFields: [{ key: "owner", label: "Owner", fieldType: "text" }],
		});
		const callClaude = makeStubClaude(dup);

		const err = await authorWorkflow({ ...CTX, callClaude }, { prompt: "x" }).catch(
			(e) => e,
		);
		expect(err).toBeInstanceOf(WorkflowEngineError);
		expect(err.code).toBe("AI_AUTHORING_INVALID_OUTPUT");
		const issues = (err.details as { issues: Array<{ message: string }> }).issues;
		expect(issues.some((i) => i.message.includes("Duplicate field key"))).toBe(true);
	});

	it("maps model client errors to AI_AUTHORING_MODEL_ERROR", async () => {
		const callClaude = vi.fn(async () => {
			throw new Error("ECONNRESET");
		});
		const err = await authorWorkflow({ ...CTX, callClaude }, { prompt: "x" }).catch(
			(e) => e,
		);
		expect(err).toBeInstanceOf(WorkflowEngineError);
		expect(err.code).toBe("AI_AUTHORING_MODEL_ERROR");
		// No DB writes happened.
		expect(insertAuthoringPrompt).not.toHaveBeenCalled();
		expect(insertWorkflowWithDraft).not.toHaveBeenCalled();
	});
});

describe("authorWorkflow -- key normalization", () => {
	it("auto-slugs an invalid key from the label rather than refusing", async () => {
		// Use a label-derived auto-slug path: invalid raw key, valid label.
		// The validator accepts any non-empty 1-64 char string for `key` (Zod min/max
		// only) -- the lib normalizes via validateKeyShape from field-key.ts.
		const wf = {
			title: "Test",
			steps: [
				{
					title: "S",
					type: "task",
					fields: [
						{ key: "Bad Key!", label: "Inspector Name", fieldType: "text" },
					],
				},
			],
		};
		const callClaude = makeStubClaude(JSON.stringify(wf));
		await authorWorkflow({ ...CTX, callClaude }, { prompt: "x" });
		// After normalization, the inserted key should match [a-z][a-z0-9_]*.
		const fieldArg = vi.mocked(insertField).mock.calls[0][0];
		expect(fieldArg.key).toMatch(/^[a-z][a-z0-9_]*$/);
	});
});

describe("__testables -- pure helpers", () => {
	it("unwrapJsonFence strips fenced blocks", () => {
		expect(__testables.unwrapJsonFence("```json\n{}\n```")).toBe("{}");
		expect(__testables.unwrapJsonFence("```\n{}\n```")).toBe("{}");
		expect(__testables.unwrapJsonFence("plain")).toBe("plain");
	});
});

// ===========================================================================
// Phase 12.2 -- two-pass anchor + source-field resolution
// ===========================================================================

describe("authorWorkflow -- two-pass dueAnchor / dueSourceField resolution", () => {
	it("resolves offset_from_step dueAnchorStepIndex to the inserted step id", async () => {
		const wf = {
			title: "Sequenced workflow",
			steps: [
				{ title: "Photos", type: "task" },
				{
					title: "Sign off",
					type: "approval",
					dueType: "offset_from_step",
					dueOffsetDays: 2,
					dueAnchorStepIndex: 0,
				},
			],
		};
		const callClaude = makeStubClaude(JSON.stringify(wf));

		await authorWorkflow({ ...CTX, callClaude }, { prompt: "build the thing" });

		// Two inserts (one per step), then ONE updateStep patching the anchor.
		expect(insertStep).toHaveBeenCalledTimes(2);
		expect(updateStep).toHaveBeenCalledTimes(1);
		const patch = vi.mocked(updateStep).mock.calls[0][0];
		expect(patch.stepId).toBe("st_Sign_off");
		expect(patch.dueAnchorStepId).toBe("st_Photos");
	});

	it("resolves from_date_field dueSourceFieldKey to the inserted field id", async () => {
		const wf = {
			title: "Move-in workflow",
			kickoffFields: [
				{ key: "lease_start", label: "Lease start", fieldType: "date" },
			],
			steps: [
				{
					title: "Schedule walkthrough",
					type: "task",
					dueType: "from_date_field",
					dueOffsetDays: -2,
					dueSourceFieldKey: "lease_start",
				},
			],
		};
		const callClaude = makeStubClaude(JSON.stringify(wf));

		await authorWorkflow({ ...CTX, callClaude }, { prompt: "build it" });

		expect(updateStep).toHaveBeenCalledTimes(1);
		const patch = vi.mocked(updateStep).mock.calls[0][0];
		expect(patch.stepId).toBe("st_Schedule_walkthrough");
		expect(patch.dueSourceFieldId).toBe("fld_lease_start");
	});

	it("from_date_field can reference a date field on another step (not just kickoff)", async () => {
		const wf = {
			title: "Cross-step deadline",
			steps: [
				{
					title: "Capture move-in date",
					type: "task",
					fields: [
						{ key: "move_in_date", label: "Move-in date", fieldType: "date" },
					],
				},
				{
					title: "Inspect before move-in",
					type: "task",
					dueType: "from_date_field",
					dueOffsetDays: -3,
					dueSourceFieldKey: "move_in_date",
				},
			],
		};
		const callClaude = makeStubClaude(JSON.stringify(wf));

		await authorWorkflow({ ...CTX, callClaude }, { prompt: "go" });

		expect(updateStep).toHaveBeenCalledTimes(1);
		const patch = vi.mocked(updateStep).mock.calls[0][0];
		expect(patch.stepId).toBe("st_Inspect_before_move-in");
		expect(patch.dueSourceFieldId).toBe("fld_move_in_date");
	});

	it("does not call updateStep when no dueAnchor/dueSource refs exist", async () => {
		const wf = {
			title: "Plain workflow",
			steps: [
				{ title: "Step A", type: "task" },
				{
					title: "Step B",
					type: "task",
					dueType: "offset_from_start",
					dueOffsetDays: 7,
				},
			],
		};
		const callClaude = makeStubClaude(JSON.stringify(wf));

		await authorWorkflow({ ...CTX, callClaude }, { prompt: "go" });

		expect(updateStep).not.toHaveBeenCalled();
	});
});
