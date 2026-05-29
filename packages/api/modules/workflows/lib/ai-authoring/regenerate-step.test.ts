// regenerate-step.test.ts
//
// Unit coverage for the Phase 12 regenerateStep lib (D-040, PRD §6.3 G10).
// Mocks @virn/database at the boundary (same pattern as authoring.test.ts)
// and injects a stub callClaude so no network is required.

import { beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted DB stub -- tx === db; transaction is a passthrough.
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
	getStepWithVersion: vi.fn(),
	getVersionEditBundle: vi.fn(),
	getWorkflowForOrg: vi.fn(),
	deleteFieldsForStep: vi.fn(),
	insertAuthoringPrompt: vi.fn(),
	insertField: vi.fn(),
	updateStep: vi.fn(),
	writeAuditAndActivity: vi.fn(),
}));

vi.mock("@virn/ai", () => ({
	VIRN_AI_MODEL: "claude-sonnet-4-6",
	getAnthropicClient: vi.fn(() => {
		throw new Error("default Anthropic client should not be reached in tests");
	}),
}));

import {
	deleteFieldsForStep,
	getStepWithVersion,
	getVersionEditBundle,
	getWorkflowForOrg,
	insertAuthoringPrompt,
	insertField,
	updateStep,
	writeAuditAndActivity,
} from "@virn/database";

import { WorkflowEngineError } from "../errors";
import { regenerateStep } from "./regenerate-step";

const CTX = { organizationId: "org_1", userId: "user_1" };

function makeStubClaude(rawText: string) {
	return vi.fn(async () => ({ text: rawText }));
}

function validRegeneratedStepJson(
	overrides: Partial<Record<string, unknown>> = {},
): string {
	return JSON.stringify({
		title: "Inspect kitchen (revised)",
		description: "Walk the kitchen; verify appliances + faucet seal.",
		type: "task",
		isRequired: true,
		isStopTask: false,
		dueType: "offset_from_start",
		dueOffsetDays: 1,
		fields: [
			{
				key: "kitchen_seal_ok",
				label: "Kitchen sink seal verified",
				fieldType: "select",
				isRequired: true,
				config: {
					options: [
						{ value: "yes", label: "Yes" },
						{ value: "no", label: "No" },
					],
				},
			},
		],
		...overrides,
	});
}

const STEP_ROW = {
	id: "st_target",
	workflowVersionId: "ver_1",
	sectionId: "sec_1",
	assignedRoleId: null,
	type: "task",
	title: "Inspect kitchen",
	description: "Walk the kitchen.",
	position: 1,
	isRequired: true,
	requiresAllAssignees: false,
	isStopTask: false,
	hiddenByDefault: false,
	dueType: "none",
	dueOffsetDays: null,
	dueAnchorStepId: null,
	dueSourceFieldId: null,
	provenance: "ai_generated",
};

const VERSION_DRAFT = {
	id: "ver_1",
	workflowId: "wf_1",
	status: "draft" as const,
};

const WORKFLOW_ROW = {
	id: "wf_1",
	organizationId: "org_1",
	title: "Onboarding",
};

beforeEach(() => {
	vi.resetAllMocks();
	dbStub.transaction.mockImplementation(
		async (fn: (tx: unknown) => Promise<unknown>) => fn(dbStub),
	);
	vi.mocked(getStepWithVersion).mockResolvedValue({
		step: STEP_ROW,
		version: VERSION_DRAFT,
	} as never);
	vi.mocked(getWorkflowForOrg).mockResolvedValue(WORKFLOW_ROW as never);
	vi.mocked(getVersionEditBundle).mockResolvedValue({
		version: VERSION_DRAFT,
		sections: [{ id: "sec_1", title: "Pre-arrival", position: 0 }],
		steps: [
			STEP_ROW,
			{ ...STEP_ROW, id: "st_sib_ai", title: "Inspect bath", position: 2, provenance: "ai_generated" },
			{ ...STEP_ROW, id: "st_sib_manual", title: "Operator-edited step", position: 3, provenance: "manually_edited" },
		],
		fields: [
			{
				id: "fld_kickoff",
				stepId: null,
				key: "guest_name",
				label: "Guest name",
				fieldType: "text",
				config: null,
				isRequired: false,
				position: 0,
				isKeyLocked: false,
			},
			{
				id: "fld_target_old",
				stepId: "st_target",
				key: "kitchen_notes",
				label: "Kitchen notes",
				fieldType: "textarea",
				config: null,
				isRequired: false,
				position: 0,
				isKeyLocked: false,
			},
		],
		dependencies: [],
	} as never);
	vi.mocked(insertAuthoringPrompt).mockResolvedValue({
		id: "ap_regen_1",
		createdAt: new Date("2026-05-29T00:00:00Z"),
	});
	vi.mocked(insertField).mockResolvedValue({ id: "fld_new" });
	vi.mocked(updateStep).mockResolvedValue(undefined);
	vi.mocked(deleteFieldsForStep).mockResolvedValue(undefined);
	vi.mocked(writeAuditAndActivity).mockResolvedValue(undefined);
});

describe("regenerateStep", () => {
	it("AI_REGENERATE_TARGET_NOT_FOUND when the step doesn't exist", async () => {
		vi.mocked(getStepWithVersion).mockResolvedValueOnce(null);
		await expect(
			regenerateStep(
				{ ...CTX, callClaude: makeStubClaude(validRegeneratedStepJson()) },
				{ stepId: "st_missing" },
			),
		).rejects.toMatchObject({ code: "AI_REGENERATE_TARGET_NOT_FOUND" });
	});

	it("AI_REGENERATE_VERSION_NOT_DRAFT when the version is published", async () => {
		vi.mocked(getStepWithVersion).mockResolvedValueOnce({
			step: STEP_ROW,
			version: { ...VERSION_DRAFT, status: "published" },
		} as never);
		await expect(
			regenerateStep(
				{ ...CTX, callClaude: makeStubClaude(validRegeneratedStepJson()) },
				{ stepId: "st_target" },
			),
		).rejects.toMatchObject({ code: "AI_REGENERATE_VERSION_NOT_DRAFT" });
	});

	it("AI_REGENERATE_TARGET_NOT_FOUND when the workflow is in another org (cross-org isolation)", async () => {
		vi.mocked(getWorkflowForOrg).mockResolvedValueOnce(null);
		await expect(
			regenerateStep(
				{ ...CTX, callClaude: makeStubClaude(validRegeneratedStepJson()) },
				{ stepId: "st_target" },
			),
		).rejects.toMatchObject({ code: "AI_REGENERATE_TARGET_NOT_FOUND" });
	});

	it("AI_AUTHORING_MODEL_ERROR when the Claude call throws", async () => {
		const failingClaude = vi.fn(async () => {
			throw new Error("503 upstream");
		});
		await expect(
			regenerateStep(
				{ ...CTX, callClaude: failingClaude },
				{ stepId: "st_target" },
			),
		).rejects.toMatchObject({ code: "AI_AUTHORING_MODEL_ERROR" });
	});

	it("AI_AUTHORING_INVALID_OUTPUT on malformed JSON", async () => {
		await expect(
			regenerateStep(
				{ ...CTX, callClaude: makeStubClaude("not json") },
				{ stepId: "st_target" },
			),
		).rejects.toMatchObject({ code: "AI_AUTHORING_INVALID_OUTPUT" });
	});

	it("regenerate-scope refusal: rejects cross-step due rules (offset_from_step)", async () => {
		const json = validRegeneratedStepJson({
			dueType: "offset_from_step",
			dueOffsetDays: 1,
			dueAnchorStepIndex: 0,
		});
		const err = await regenerateStep(
			{ ...CTX, callClaude: makeStubClaude(json) },
			{ stepId: "st_target" },
		).catch((e) => e);
		expect(err).toBeInstanceOf(WorkflowEngineError);
		expect(err.code).toBe("AI_AUTHORING_INVALID_OUTPUT");
		expect(String(err.message)).toMatch(/cross-step due rules/i);
	});

	it("regenerate-scope refusal: rejects from_date_field source references", async () => {
		const json = validRegeneratedStepJson({
			dueType: "from_date_field",
			dueOffsetDays: -1,
			dueSourceFieldKey: "guest_name",
		});
		await expect(
			regenerateStep(
				{ ...CTX, callClaude: makeStubClaude(json) },
				{ stepId: "st_target" },
			),
		).rejects.toMatchObject({ code: "AI_AUTHORING_INVALID_OUTPUT" });
	});

	it("regenerate-scope refusal: rejects sectionIndex changes", async () => {
		const json = validRegeneratedStepJson({ sectionIndex: 1 });
		await expect(
			regenerateStep(
				{ ...CTX, callClaude: makeStubClaude(json) },
				{ stepId: "st_target" },
			),
		).rejects.toMatchObject({ code: "AI_AUTHORING_INVALID_OUTPUT" });
	});

	it("happy path: deletes target step's fields, inserts new fields, updates step with provenance='ai_generated'", async () => {
		const result = await regenerateStep(
			{ ...CTX, callClaude: makeStubClaude(validRegeneratedStepJson()) },
			{ stepId: "st_target", refinementPrompt: "make it terser" },
		);

		expect(result).toMatchObject({
			stepId: "st_target",
			authoringPromptId: "ap_regen_1",
			previousTitle: "Inspect kitchen",
			newTitle: "Inspect kitchen (revised)",
			fieldCountBefore: 1,
			fieldCountAfter: 1,
		});

		expect(deleteFieldsForStep).toHaveBeenCalledWith(
			{ stepId: "st_target" },
			expect.anything(),
		);
		expect(insertField).toHaveBeenCalledWith(
			expect.objectContaining({
				stepId: "st_target",
				workflowVersionId: "ver_1",
				key: "kitchen_seal_ok",
				fieldType: "select",
			}),
			expect.anything(),
		);
		expect(updateStep).toHaveBeenCalledWith(
			expect.objectContaining({
				stepId: "st_target",
				title: "Inspect kitchen (revised)",
				provenance: "ai_generated",
				dueType: "offset_from_start",
				dueOffsetDays: 1,
				dueAnchorStepId: null,
				dueSourceFieldId: null,
			}),
			expect.anything(),
		);
	});

	it("audit row records previous + new title + provenance + refinement-prompt presence", async () => {
		await regenerateStep(
			{ ...CTX, callClaude: makeStubClaude(validRegeneratedStepJson()) },
			{ stepId: "st_target", refinementPrompt: "shorter please" },
		);
		expect(writeAuditAndActivity).toHaveBeenCalledTimes(1);
		const auditArg = vi.mocked(writeAuditAndActivity).mock.calls[0][0];
		expect(auditArg.action).toBe("step.ai_regenerated");
		expect(auditArg.entityType).toBe("step");
		expect(auditArg.entityId).toBe("st_target");
		expect(auditArg.changes).toMatchObject({
			previousTitle: "Inspect kitchen",
			newTitle: "Inspect kitchen (revised)",
			fieldCountBefore: 1,
			fieldCountAfter: 1,
			model: "claude-sonnet-4-6",
			aiAuthoringPromptId: "ap_regen_1",
			hadRefinementPrompt: true,
		});
	});

	it("provenance row stores the refinement prompt (or '(no refinement)') + the regenerated response", async () => {
		await regenerateStep(
			{ ...CTX, callClaude: makeStubClaude(validRegeneratedStepJson()) },
			{ stepId: "st_target", refinementPrompt: "use SI units" },
		);
		const provArg = vi.mocked(insertAuthoringPrompt).mock.calls[0][0];
		expect(provArg.prompt).toBe("use SI units");
		expect(provArg.organizationId).toBe("org_1");
		expect(provArg.userId).toBe("user_1");
		expect(provArg.model).toBe("claude-sonnet-4-6");
		expect(provArg.responseJson).toMatchObject({
			title: "Inspect kitchen (revised)",
			type: "task",
		});
	});

	it("manually_edited siblings are excluded from the user message body (D-040 sibling isolation)", async () => {
		const stubClaude = makeStubClaude(validRegeneratedStepJson());
		await regenerateStep(
			{ ...CTX, callClaude: stubClaude },
			{ stepId: "st_target" },
		);
		const callArgs = stubClaude.mock.calls[0][0];
		const userMessage = callArgs.userMessage;
		// AI-generated sibling should appear by title.
		expect(userMessage).toContain("Inspect bath");
		// Manually-edited sibling should NOT appear by title -- only as an
		// opaque placeholder citing its position.
		expect(userMessage).not.toContain("Operator-edited step");
		expect(userMessage).toContain("[manually-edited step at position 3]");
	});
});
