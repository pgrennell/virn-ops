// Phase 18c -- authorPlaybook lib tests. Stubs the Claude call (no network) + mocks
// @virn/database / @virn/ai so the build path is exercised without a DB.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@virn/database", () => {
	const tx = { __tx: true };
	return {
		db: { transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)) },
		insertAuthoringPrompt: vi.fn(),
		insertPlaybookWithDraft: vi.fn(),
		insertPlaybookStep: vi.fn(),
		updatePlaybook: vi.fn(),
		writeAuditAndActivity: vi.fn(),
	};
});

vi.mock("@virn/ai", () => ({
	VIRN_AI_MODEL: "claude-test",
	getAnthropicClient: vi.fn(),
}));

import {
	insertAuthoringPrompt,
	insertPlaybookStep,
	insertPlaybookWithDraft,
	updatePlaybook,
	writeAuditAndActivity,
} from "@virn/database";

import { authorPlaybook, type CallClaudeFn } from "./authoring";

const ctxBase = { organizationId: "org-1", userId: "user-1" };

function claudeReturning(obj: unknown): CallClaudeFn {
	return async () => ({ text: JSON.stringify(obj) });
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(insertAuthoringPrompt).mockResolvedValue({ id: "ap-1", createdAt: new Date() });
	vi.mocked(insertPlaybookWithDraft).mockResolvedValue({ playbookId: "pb-1", versionId: "ver-1" });
	let n = 0;
	vi.mocked(insertPlaybookStep).mockImplementation(async () => ({ id: `step-${n++}` }) as never);
	vi.mocked(writeAuditAndActivity).mockResolvedValue(undefined);
	vi.mocked(updatePlaybook).mockResolvedValue(undefined as never);
});

describe("authorPlaybook -- happy path", () => {
	it("builds a playbook + steps from valid model output (provenance ai_generated)", async () => {
		const callClaude = claudeReturning({
			name: "STR post-stay review",
			steps: [
				{ type: "wait_for_duration", config: { amount: 1, unit: "days" } },
				{ type: "send_notification", config: { type: "ACKNOWLEDGMENT_DUE" } },
			],
		});
		const res = await authorPlaybook({ ...ctxBase, callClaude }, { prompt: "post-stay review cadence" });

		expect(res).toMatchObject({ playbookId: "pb-1", draftVersionId: "ver-1", stepCount: 2, name: "STR post-stay review" });
		expect(insertAuthoringPrompt).toHaveBeenCalledTimes(1);
		expect(insertPlaybookWithDraft).toHaveBeenCalledWith(
			expect.objectContaining({ name: "STR post-stay review", aiAuthoringPromptId: "ap-1" }),
			expect.anything(),
		);
		expect(insertPlaybookStep).toHaveBeenCalledTimes(2);
		expect(insertPlaybookStep).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({ type: "wait_for_duration", provenance: "ai_generated", position: 0 }),
			expect.anything(),
		);
		expect(writeAuditAndActivity).toHaveBeenCalledWith(
			expect.objectContaining({ action: "playbook.ai_authored", entityId: "pb-1" }),
		);
	});

	it("resolves a branch child's parentStepIndex to the parent step id", async () => {
		const callClaude = claudeReturning({
			name: "branchy",
			steps: [
				{ type: "branch_on_data_set", config: { source: "run.status", branches: ["completed"] } },
				{ type: "send_notification", config: { type: "APP_UPDATE" }, parentStepIndex: 0, branchLabel: "completed" },
			],
		});
		await authorPlaybook({ ...ctxBase, callClaude }, { prompt: "x" });

		// Child (2nd insert) must carry parentStepId = the first inserted step's id ("step-0").
		expect(insertPlaybookStep).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ branchLabel: "completed", parentStepId: "step-0" }),
			expect.anything(),
		);
	});

	it("applies entity-set hints after the build", async () => {
		const callClaude = claudeReturning({
			name: "scoped",
			steps: [{ type: "send_notification", config: {} }],
		});
		await authorPlaybook({ ...ctxBase, callClaude }, { prompt: "x", entitySetHints: ["set-a"] });
		expect(updatePlaybook).toHaveBeenCalledWith(
			expect.objectContaining({ playbookId: "pb-1", entitySetIds: ["set-a"] }),
		);
	});
});

describe("authorPlaybook -- refusal paths", () => {
	it("maps non-JSON output to AI_AUTHORING_INVALID_OUTPUT", async () => {
		await expect(
			authorPlaybook({ ...ctxBase, callClaude: async () => ({ text: "sorry, I cannot" }) }, { prompt: "x" }),
		).rejects.toMatchObject({ code: "AI_AUTHORING_INVALID_OUTPUT" });
		expect(insertPlaybookWithDraft).not.toHaveBeenCalled();
	});

	it("maps schema-invalid output to AI_AUTHORING_INVALID_OUTPUT", async () => {
		await expect(
			authorPlaybook(
				{ ...ctxBase, callClaude: claudeReturning({ name: "x", steps: [{ type: "bogus", config: {} }] }) },
				{ prompt: "x" },
			),
		).rejects.toMatchObject({ code: "AI_AUTHORING_INVALID_OUTPUT" });
	});

	it("maps reference-inconsistent output to AI_AUTHORING_INVALID_OUTPUT", async () => {
		await expect(
			authorPlaybook(
				{
					...ctxBase,
					callClaude: claudeReturning({
						name: "x",
						steps: [{ type: "launch_workflow", config: {} }], // no target
					}),
				},
				{ prompt: "x" },
			),
		).rejects.toMatchObject({ code: "AI_AUTHORING_INVALID_OUTPUT" });
	});

	it("maps a model/network failure to AI_AUTHORING_MODEL_ERROR", async () => {
		await expect(
			authorPlaybook(
				{ ...ctxBase, callClaude: async () => { throw new Error("503 overloaded"); } },
				{ prompt: "x" },
			),
		).rejects.toMatchObject({ code: "AI_AUTHORING_MODEL_ERROR" });
		expect(insertAuthoringPrompt).not.toHaveBeenCalled();
	});
});
