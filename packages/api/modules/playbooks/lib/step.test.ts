// Playbooks lib hardening -- the MANUAL builder step CRUD (create/update/delete/reorder
// on a draft version). Uncovered by the AI-authoring + publish + procedure-gate tests.
// Pins the full refusal matrix + the D-040 provenance flip + the reorder
// completeness/version-mismatch guards. Mocks @virn/database.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@virn/database", () => ({
	getPlaybookVersionForOrg: vi.fn(),
	getPlaybookStepForOrg: vi.fn(),
	getPlaybookStepsForOrg: vi.fn(),
	insertPlaybookStep: vi.fn(),
	listPlaybookStepsForVersion: vi.fn(),
	reorderPlaybookSteps: vi.fn(),
	updatePlaybookStep: vi.fn(),
	deletePlaybookStep: vi.fn(),
	writeAuditAndActivity: vi.fn(),
	getPlaybookForOrg: vi.fn(),
}));

import {
	deletePlaybookStep,
	getPlaybookStepForOrg,
	getPlaybookStepsForOrg,
	getPlaybookVersionForOrg,
	insertPlaybookStep,
	listPlaybookStepsForVersion,
	reorderPlaybookSteps,
	updatePlaybookStep,
	writeAuditAndActivity,
} from "@virn/database";

import {
	createPlaybookStepOp,
	deletePlaybookStepOp,
	reorderPlaybookStepsOp,
	updatePlaybookStepOp,
} from "./step";

const ctx = { organizationId: "org-1", userId: "user-1" };
const draftV = { id: "v1", playbookId: "pb1", publishedAt: null };

function step(over: Record<string, unknown> = {}) {
	return {
		id: "s1",
		playbookVersionId: "v1",
		type: "send_notification",
		position: 0,
		branchLabel: null,
		parentStepId: null,
		...over,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(writeAuditAndActivity).mockResolvedValue(undefined);
	vi.mocked(insertPlaybookStep).mockResolvedValue({ id: "s_new" } as never);
	vi.mocked(updatePlaybookStep).mockResolvedValue(undefined as never);
	vi.mocked(deletePlaybookStep).mockResolvedValue(undefined as never);
	vi.mocked(reorderPlaybookSteps).mockResolvedValue(undefined as never);
});

describe("createPlaybookStepOp", () => {
	const input = { playbookVersionId: "v1", position: 0, type: "send_notification" as const, config: {} };

	it("throws VERSION_NOT_FOUND when the version is missing/cross-org", async () => {
		vi.mocked(getPlaybookVersionForOrg).mockResolvedValueOnce(null as never);
		await expect(createPlaybookStepOp(ctx, input)).rejects.toMatchObject({ code: "VERSION_NOT_FOUND" });
	});

	it("throws VERSION_PUBLISHED_IMMUTABLE on a published version", async () => {
		vi.mocked(getPlaybookVersionForOrg).mockResolvedValueOnce({ ...draftV, publishedAt: new Date() } as never);
		await expect(createPlaybookStepOp(ctx, input)).rejects.toMatchObject({ code: "VERSION_PUBLISHED_IMMUTABLE" });
	});

	it("throws STEP_PARENT_INVALID when the parent isn't found", async () => {
		vi.mocked(getPlaybookVersionForOrg).mockResolvedValueOnce(draftV as never);
		vi.mocked(getPlaybookStepForOrg).mockResolvedValueOnce(null as never);
		await expect(createPlaybookStepOp(ctx, { ...input, parentStepId: "p_x" })).rejects.toMatchObject({
			code: "STEP_PARENT_INVALID",
		});
	});

	it("throws STEP_PARENT_INVALID when the parent is in a different version", async () => {
		vi.mocked(getPlaybookVersionForOrg).mockResolvedValueOnce(draftV as never);
		vi.mocked(getPlaybookStepForOrg).mockResolvedValueOnce(step({ id: "p1", playbookVersionId: "v_other", type: "branch_on_data_set" }) as never);
		await expect(createPlaybookStepOp(ctx, { ...input, parentStepId: "p1" })).rejects.toMatchObject({
			code: "STEP_PARENT_INVALID",
		});
	});

	it("throws STEP_PARENT_NOT_BRANCH when the parent isn't a branch step", async () => {
		vi.mocked(getPlaybookVersionForOrg).mockResolvedValueOnce(draftV as never);
		vi.mocked(getPlaybookStepForOrg).mockResolvedValueOnce(step({ id: "p1", type: "wait_for_duration" }) as never);
		await expect(createPlaybookStepOp(ctx, { ...input, parentStepId: "p1" })).rejects.toMatchObject({
			code: "STEP_PARENT_NOT_BRANCH",
		});
	});

	it("inserts the step + audits playbook_step.created (valid branch parent)", async () => {
		vi.mocked(getPlaybookVersionForOrg).mockResolvedValueOnce(draftV as never);
		vi.mocked(getPlaybookStepForOrg).mockResolvedValueOnce(step({ id: "p1", type: "branch_on_data_set" }) as never);
		const res = await createPlaybookStepOp(ctx, { ...input, parentStepId: "p1", branchLabel: "approved" });
		expect(res).toEqual({ stepId: "s_new" });
		expect(writeAuditAndActivity).toHaveBeenCalledWith(
			expect.objectContaining({ action: "playbook_step.created", metadata: { playbookId: "pb1" } }),
		);
	});
});

describe("updatePlaybookStepOp", () => {
	it("throws STEP_NOT_FOUND when the step is missing", async () => {
		vi.mocked(getPlaybookStepForOrg).mockResolvedValueOnce(null as never);
		await expect(updatePlaybookStepOp(ctx, { stepId: "s_x", position: 1 })).rejects.toMatchObject({
			code: "STEP_NOT_FOUND",
		});
	});

	it("throws VERSION_PUBLISHED_IMMUTABLE when the step's version was published mid-edit", async () => {
		vi.mocked(getPlaybookStepForOrg).mockResolvedValueOnce(step() as never);
		vi.mocked(getPlaybookVersionForOrg).mockResolvedValueOnce({ ...draftV, publishedAt: new Date() } as never);
		await expect(updatePlaybookStepOp(ctx, { stepId: "s1", position: 1 })).rejects.toMatchObject({
			code: "VERSION_PUBLISHED_IMMUTABLE",
		});
	});

	it("throws STEP_PARENT_SELF_REFERENCE when a step is set as its own parent", async () => {
		vi.mocked(getPlaybookStepForOrg).mockResolvedValueOnce(step() as never);
		vi.mocked(getPlaybookVersionForOrg).mockResolvedValueOnce(draftV as never);
		await expect(updatePlaybookStepOp(ctx, { stepId: "s1", parentStepId: "s1" })).rejects.toMatchObject({
			code: "STEP_PARENT_SELF_REFERENCE",
		});
	});

	it("is a NO-OP when nothing changed (no update, no audit)", async () => {
		vi.mocked(getPlaybookStepForOrg).mockResolvedValueOnce(step({ position: 3 }) as never);
		vi.mocked(getPlaybookVersionForOrg).mockResolvedValueOnce(draftV as never);
		await updatePlaybookStepOp(ctx, { stepId: "s1", position: 3 });
		expect(updatePlaybookStep).not.toHaveBeenCalled();
		expect(writeAuditAndActivity).not.toHaveBeenCalled();
	});

	it("flips provenance to manually_edited on any real edit (D-040) + audits", async () => {
		vi.mocked(getPlaybookStepForOrg).mockResolvedValueOnce(step({ position: 0 }) as never);
		vi.mocked(getPlaybookVersionForOrg).mockResolvedValueOnce(draftV as never);
		await updatePlaybookStepOp(ctx, { stepId: "s1", position: 5 });
		expect(updatePlaybookStep).toHaveBeenCalledWith(
			expect.objectContaining({ stepId: "s1", provenance: "manually_edited" }),
		);
		expect(writeAuditAndActivity).toHaveBeenCalledWith(
			expect.objectContaining({ action: "playbook_step.updated", changes: expect.objectContaining({ stepId: "s1" }) }),
		);
	});
});

describe("deletePlaybookStepOp", () => {
	it("throws STEP_NOT_FOUND when the step is missing", async () => {
		vi.mocked(getPlaybookStepForOrg).mockResolvedValueOnce(null as never);
		await expect(deletePlaybookStepOp(ctx, { stepId: "s_x" })).rejects.toMatchObject({ code: "STEP_NOT_FOUND" });
	});

	it("deletes the step + audits playbook_step.deleted (hadParent metadata)", async () => {
		vi.mocked(getPlaybookStepForOrg).mockResolvedValueOnce(step({ parentStepId: "p1" }) as never);
		vi.mocked(getPlaybookVersionForOrg).mockResolvedValueOnce(draftV as never);
		await deletePlaybookStepOp(ctx, { stepId: "s1" });
		expect(deletePlaybookStep).toHaveBeenCalledWith({ stepId: "s1" });
		expect(writeAuditAndActivity).toHaveBeenCalledWith(
			expect.objectContaining({ action: "playbook_step.deleted", metadata: { hadParent: true } }),
		);
	});
});

describe("reorderPlaybookStepsOp", () => {
	it("throws VERSION_NOT_FOUND when the version is missing", async () => {
		vi.mocked(getPlaybookVersionForOrg).mockResolvedValueOnce(null as never);
		await expect(
			reorderPlaybookStepsOp(ctx, { playbookVersionId: "v_x", items: [{ stepId: "s1", position: 0 }] }),
		).rejects.toMatchObject({ code: "VERSION_NOT_FOUND" });
	});

	it("is a no-op for an empty reorder set", async () => {
		vi.mocked(getPlaybookVersionForOrg).mockResolvedValueOnce(draftV as never);
		await reorderPlaybookStepsOp(ctx, { playbookVersionId: "v1", items: [] });
		expect(reorderPlaybookSteps).not.toHaveBeenCalled();
	});

	it("throws STEP_NOT_FOUND when a reordered step id doesn't resolve in the org", async () => {
		vi.mocked(getPlaybookVersionForOrg).mockResolvedValueOnce(draftV as never);
		vi.mocked(getPlaybookStepsForOrg).mockResolvedValueOnce(new Map() as never);
		await expect(
			reorderPlaybookStepsOp(ctx, { playbookVersionId: "v1", items: [{ stepId: "s_x", position: 0 }] }),
		).rejects.toMatchObject({ code: "STEP_NOT_FOUND" });
	});

	it("throws REORDER_STEPS_VERSION_MISMATCH when a step is from another version", async () => {
		vi.mocked(getPlaybookVersionForOrg).mockResolvedValueOnce(draftV as never);
		vi.mocked(getPlaybookStepsForOrg).mockResolvedValueOnce(
			new Map([["s1", { playbookVersionId: "v_other" }]]) as never,
		);
		await expect(
			reorderPlaybookStepsOp(ctx, { playbookVersionId: "v1", items: [{ stepId: "s1", position: 0 }] }),
		).rejects.toMatchObject({ code: "REORDER_STEPS_VERSION_MISMATCH" });
	});

	it("throws REORDER_STEPS_INCOMPLETE when a version step is omitted from the set", async () => {
		vi.mocked(getPlaybookVersionForOrg).mockResolvedValueOnce(draftV as never);
		vi.mocked(getPlaybookStepsForOrg).mockResolvedValueOnce(
			new Map([["s1", { playbookVersionId: "v1" }]]) as never,
		);
		vi.mocked(listPlaybookStepsForVersion).mockResolvedValueOnce([{ id: "s1" }, { id: "s2" }] as never);
		await expect(
			reorderPlaybookStepsOp(ctx, { playbookVersionId: "v1", items: [{ stepId: "s1", position: 0 }] }),
		).rejects.toMatchObject({ code: "REORDER_STEPS_INCOMPLETE" });
	});

	it("reorders + audits when the full set is provided", async () => {
		vi.mocked(getPlaybookVersionForOrg).mockResolvedValueOnce(draftV as never);
		vi.mocked(getPlaybookStepsForOrg).mockResolvedValueOnce(
			new Map([
				["s1", { playbookVersionId: "v1" }],
				["s2", { playbookVersionId: "v1" }],
			]) as never,
		);
		vi.mocked(listPlaybookStepsForVersion).mockResolvedValueOnce([{ id: "s1" }, { id: "s2" }] as never);

		await reorderPlaybookStepsOp(ctx, {
			playbookVersionId: "v1",
			items: [
				{ stepId: "s2", position: 0 },
				{ stepId: "s1", position: 1 },
			],
		});

		expect(reorderPlaybookSteps).toHaveBeenCalledWith({
			items: [
				{ stepId: "s2", position: 0 },
				{ stepId: "s1", position: 1 },
			],
		});
		expect(writeAuditAndActivity).toHaveBeenCalledWith(
			expect.objectContaining({ action: "playbook_step.reordered", changes: { stepCount: 2 } }),
		);
	});
});
