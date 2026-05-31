// Phase 18c -- regeneratePlaybookStep lib tests. Pins the D-040 contract:
//   - a manually_edited TARGET is refused (STEP_NOT_AI_GENERATED)
//   - manually_edited SIBLINGS' content never reaches the composed prompt
//   - a happy regen updates ONLY the target (type+config, provenance ai_generated)
// Mocks @virn/database + @virn/ai (no network).

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@virn/database", () => ({
	getPlaybookForOrg: vi.fn(),
	getCurrentDraftPlaybookVersion: vi.fn(),
	listPlaybookStepsForVersion: vi.fn(),
	updatePlaybookStep: vi.fn(),
	insertAuthoringPrompt: vi.fn(),
	writeAuditAndActivity: vi.fn(),
	// authoring.ts (imported for CallClaudeFn) pulls these at module load.
	db: { transaction: vi.fn() },
	insertPlaybookWithDraft: vi.fn(),
	insertPlaybookStep: vi.fn(),
	updatePlaybook: vi.fn(),
}));

vi.mock("@virn/ai", () => ({ VIRN_AI_MODEL: "claude-test", getAnthropicClient: vi.fn() }));

import {
	getCurrentDraftPlaybookVersion,
	getPlaybookForOrg,
	insertAuthoringPrompt,
	listPlaybookStepsForVersion,
	updatePlaybookStep,
} from "@virn/database";

import { regeneratePlaybookStep } from "./regenerate-step";

const ctxBase = { organizationId: "org-1", userId: "user-1" };

function aiStep(over: Record<string, unknown>) {
	return {
		id: "x",
		playbookVersionId: "ver-1",
		position: 0,
		type: "send_notification",
		config: {},
		branchLabel: null,
		parentStepId: null,
		provenance: "ai_generated",
		createdAt: new Date(),
		updatedAt: new Date(),
		...over,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(getPlaybookForOrg).mockResolvedValue({ id: "pb-1" } as never);
	vi.mocked(getCurrentDraftPlaybookVersion).mockResolvedValue({ id: "ver-1" } as never);
	vi.mocked(insertAuthoringPrompt).mockResolvedValue({ id: "ap-1", createdAt: new Date() });
	vi.mocked(updatePlaybookStep).mockResolvedValue(undefined);
});

describe("regeneratePlaybookStep -- refusals", () => {
	it("PLAYBOOK_NOT_FOUND for a cross-org playbook", async () => {
		vi.mocked(getPlaybookForOrg).mockResolvedValueOnce(null as never);
		await expect(
			regeneratePlaybookStep(ctxBase, { playbookId: "pb-x", stepId: "s1" }),
		).rejects.toMatchObject({ code: "PLAYBOOK_NOT_FOUND" });
	});

	it("PLAYBOOK_HAS_NO_DRAFT when there's no open draft", async () => {
		vi.mocked(getCurrentDraftPlaybookVersion).mockResolvedValueOnce(null as never);
		await expect(
			regeneratePlaybookStep(ctxBase, { playbookId: "pb-1", stepId: "s1" }),
		).rejects.toMatchObject({ code: "PLAYBOOK_HAS_NO_DRAFT" });
	});

	it("STEP_NOT_FOUND when the target isn't in the draft", async () => {
		vi.mocked(listPlaybookStepsForVersion).mockResolvedValueOnce([aiStep({ id: "other" })] as never);
		await expect(
			regeneratePlaybookStep(ctxBase, { playbookId: "pb-1", stepId: "s1" }),
		).rejects.toMatchObject({ code: "STEP_NOT_FOUND" });
	});

	it("STEP_NOT_AI_GENERATED when the target was manually edited (no write)", async () => {
		vi.mocked(listPlaybookStepsForVersion).mockResolvedValueOnce([
			aiStep({ id: "s1", provenance: "manually_edited" }),
		] as never);
		await expect(
			regeneratePlaybookStep(
				{ ...ctxBase, callClaude: async () => ({ text: "{}" }) },
				{ playbookId: "pb-1", stepId: "s1" },
			),
		).rejects.toMatchObject({ code: "STEP_NOT_AI_GENERATED" });
		expect(updatePlaybookStep).not.toHaveBeenCalled();
	});
});

describe("regeneratePlaybookStep -- D-040 sibling isolation + happy path", () => {
	it("excludes manually_edited siblings' content from the prompt; updates only the target", async () => {
		vi.mocked(listPlaybookStepsForVersion).mockResolvedValueOnce([
			aiStep({ id: "s1", type: "send_notification", config: { type: "OLD" }, position: 0 }),
			aiStep({
				id: "s2",
				type: "write_to_data_set",
				config: { dataSetKey: "SECRET_DATASET", label: "SECRET_LABEL" },
				position: 1,
				provenance: "manually_edited",
			}),
			aiStep({ id: "s3", type: "wait_for_duration", config: { amount: 1, unit: "days" }, position: 2 }),
		] as never);

		let capturedUserMessage = "";
		const callClaude = async (i: { userMessage: string }) => {
			capturedUserMessage = i.userMessage;
			return { text: JSON.stringify({ type: "send_notification", config: { type: "NEW" } }) };
		};

		const res = await regeneratePlaybookStep(
			{ ...ctxBase, callClaude },
			{ playbookId: "pb-1", stepId: "s1", refinementPrompt: "use SMS" },
		);

		// D-040: the manually_edited sibling's content must NOT appear; only its position.
		expect(capturedUserMessage).not.toContain("SECRET_DATASET");
		expect(capturedUserMessage).not.toContain("SECRET_LABEL");
		expect(capturedUserMessage).toContain("position 1"); // opaque placeholder
		// The ai_generated sibling IS shown (position + type).
		expect(capturedUserMessage).toContain("position 2");
		expect(capturedUserMessage).toContain("wait_for_duration");

		// Only the target is written, with the new config + ai_generated.
		expect(updatePlaybookStep).toHaveBeenCalledTimes(1);
		expect(updatePlaybookStep).toHaveBeenCalledWith({
			stepId: "s1",
			type: "send_notification",
			config: { type: "NEW" },
			provenance: "ai_generated",
		});
		expect(res).toMatchObject({ stepId: "s1", previousType: "send_notification", newType: "send_notification" });
	});

	it("rejects a regen output that tries to re-parent (parentStepIndex/branchLabel)", async () => {
		vi.mocked(listPlaybookStepsForVersion).mockResolvedValueOnce([
			aiStep({ id: "s1", type: "send_notification", config: {}, position: 0 }),
		] as never);
		const callClaude = async () => ({
			text: JSON.stringify({ type: "send_notification", config: {}, parentStepIndex: 0, branchLabel: "x" }),
		});
		await expect(
			regeneratePlaybookStep({ ...ctxBase, callClaude }, { playbookId: "pb-1", stepId: "s1" }),
		).rejects.toMatchObject({ code: "AI_AUTHORING_INVALID_OUTPUT" });
		expect(updatePlaybookStep).not.toHaveBeenCalled();
	});
});
