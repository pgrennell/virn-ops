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
	writeAuditAndActivity: vi.fn(),
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
