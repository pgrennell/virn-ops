// Workflows lib hardening -- workflow-level create/update/archive. Already covered
// elsewhere: updateWorkflowMeta's entitySetIds path by workflow-scope.test.ts (procedure
// layer); the review-state transitions (submitForReview/sendBackToDraft) by
// review-state.test.ts. This pins the genuinely-uncovered lib logic: createWorkflow
// (insert-with-draft + audit), archiveWorkflowOp (idempotent no-op when already
// archived), and updateWorkflowMeta's non-entitySetIds branches -- WORKFLOW_NOT_FOUND /
// WORKFLOW_ARCHIVED, the no-op short-circuit, and the Phase 16 reviewIntervalDays ->
// nextReviewAt computation. Mocks @virn/database.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@virn/database", () => ({
	insertWorkflowWithDraft: vi.fn(),
	getWorkflowForOrg: vi.fn(),
	updateWorkflow: vi.fn(),
	archiveWorkflow: vi.fn(),
	writeAuditAndActivity: vi.fn(),
	// imported by the review-state fns at module load (unused on these paths)
	getOrganizationById: vi.fn(),
	getWorkflowWithVersions: vi.fn(),
	transitionWorkflowReviewState: vi.fn(),
}));

import {
	archiveWorkflow,
	getWorkflowForOrg,
	insertWorkflowWithDraft,
	updateWorkflow,
	writeAuditAndActivity,
} from "@virn/database";

import { archiveWorkflowOp, createWorkflow, updateWorkflowMeta } from "./workflow";

const ctx = { organizationId: "org-1", userId: "user-1" };

function wf(over: Record<string, unknown> = {}) {
	return {
		id: "wf_1",
		title: "Onboarding",
		description: null,
		type: "procedure",
		isActive: true,
		entitySetIds: [] as string[],
		reviewIntervalDays: null as number | null,
		nextReviewAt: null as Date | null,
		deletedAt: null as Date | null,
		...over,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(writeAuditAndActivity).mockResolvedValue(undefined);
	vi.mocked(updateWorkflow).mockResolvedValue(undefined as never);
	vi.mocked(archiveWorkflow).mockResolvedValue(undefined as never);
});

describe("createWorkflow", () => {
	it("inserts the workflow + initial draft + audits workflow.created (type defaults to procedure)", async () => {
		vi.mocked(insertWorkflowWithDraft).mockResolvedValueOnce({ workflowId: "wf_1", versionId: "ver_1" } as never);

		const res = await createWorkflow(ctx, { title: "Onboarding" });

		expect(res).toEqual({ workflowId: "wf_1", draftVersionId: "ver_1" });
		expect(insertWorkflowWithDraft).toHaveBeenCalledWith(
			expect.objectContaining({ organizationId: "org-1", title: "Onboarding", type: "procedure", createdBy: "user-1" }),
		);
		expect(writeAuditAndActivity).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "workflow.created",
				entityId: "wf_1",
				changes: { title: "Onboarding", type: "procedure" },
				metadata: { initialDraftVersionId: "ver_1" },
			}),
		);
	});

	it("threads an explicit type into the insert + audit", async () => {
		vi.mocked(insertWorkflowWithDraft).mockResolvedValueOnce({ workflowId: "wf_2", versionId: "ver_2" } as never);
		await createWorkflow(ctx, { title: "Policy doc", type: "policy" });
		expect(insertWorkflowWithDraft).toHaveBeenCalledWith(expect.objectContaining({ type: "policy" }));
		expect(writeAuditAndActivity).toHaveBeenCalledWith(
			expect.objectContaining({ changes: { title: "Policy doc", type: "policy" } }),
		);
	});
});

describe("updateWorkflowMeta -- non-entitySetIds branches", () => {
	it("throws WORKFLOW_NOT_FOUND when the workflow isn't in the org", async () => {
		vi.mocked(getWorkflowForOrg).mockResolvedValueOnce(null as never);
		await expect(updateWorkflowMeta(ctx, { workflowId: "wf_x", title: "x" })).rejects.toMatchObject({
			code: "WORKFLOW_NOT_FOUND",
		});
	});

	it("throws WORKFLOW_ARCHIVED when the workflow is soft-deleted", async () => {
		vi.mocked(getWorkflowForOrg).mockResolvedValueOnce(wf({ deletedAt: new Date() }) as never);
		await expect(updateWorkflowMeta(ctx, { workflowId: "wf_1", title: "x" })).rejects.toMatchObject({
			code: "WORKFLOW_ARCHIVED",
		});
	});

	it("is a NO-OP when the patched value matches the current value (no update, no audit)", async () => {
		vi.mocked(getWorkflowForOrg).mockResolvedValueOnce(wf({ title: "Onboarding" }) as never);
		await updateWorkflowMeta(ctx, { workflowId: "wf_1", title: "Onboarding" });
		expect(updateWorkflow).not.toHaveBeenCalled();
		expect(writeAuditAndActivity).not.toHaveBeenCalled();
	});

	it("updates + audits a changed title (only the changed field in the diff)", async () => {
		vi.mocked(getWorkflowForOrg).mockResolvedValueOnce(wf({ title: "Onboarding" }) as never);
		await updateWorkflowMeta(ctx, { workflowId: "wf_1", title: "Tenant Onboarding" });
		expect(updateWorkflow).toHaveBeenCalledWith(expect.objectContaining({ workflowId: "wf_1", title: "Tenant Onboarding" }));
		expect(writeAuditAndActivity).toHaveBeenCalledWith(
			expect.objectContaining({ action: "workflow.updated", changes: { title: "Tenant Onboarding" } }),
		);
	});

	it("computes nextReviewAt = now + N days when a positive reviewIntervalDays is set", async () => {
		vi.mocked(getWorkflowForOrg).mockResolvedValueOnce(wf({ reviewIntervalDays: null }) as never);
		await updateWorkflowMeta(ctx, { workflowId: "wf_1", reviewIntervalDays: 30 });

		const arg = vi.mocked(updateWorkflow).mock.calls[0][0] as { nextReviewAt: Date };
		expect(arg.nextReviewAt).toBeInstanceOf(Date);
		const days = Math.round((arg.nextReviewAt.getTime() - Date.now()) / 86_400_000);
		expect(days).toBe(30);
		expect(writeAuditAndActivity).toHaveBeenCalledWith(
			expect.objectContaining({ changes: expect.objectContaining({ reviewIntervalDays: { from: null, to: 30 } }) }),
		);
	});

	it("clears nextReviewAt (null) when reviewIntervalDays is set to null", async () => {
		vi.mocked(getWorkflowForOrg).mockResolvedValueOnce(wf({ reviewIntervalDays: 30 }) as never);
		await updateWorkflowMeta(ctx, { workflowId: "wf_1", reviewIntervalDays: null });
		expect(updateWorkflow).toHaveBeenCalledWith(expect.objectContaining({ nextReviewAt: null }));
		expect(writeAuditAndActivity).toHaveBeenCalledWith(
			expect.objectContaining({ changes: expect.objectContaining({ reviewIntervalDays: { from: 30, to: null } }) }),
		);
	});
});

describe("archiveWorkflowOp", () => {
	it("throws WORKFLOW_NOT_FOUND when the workflow isn't in the org", async () => {
		vi.mocked(getWorkflowForOrg).mockResolvedValueOnce(null as never);
		await expect(archiveWorkflowOp(ctx, { workflowId: "wf_x" })).rejects.toMatchObject({ code: "WORKFLOW_NOT_FOUND" });
	});

	it("is idempotent: an already-archived workflow is a no-op (no archive call, no audit)", async () => {
		vi.mocked(getWorkflowForOrg).mockResolvedValueOnce(wf({ deletedAt: new Date() }) as never);
		await archiveWorkflowOp(ctx, { workflowId: "wf_1" });
		expect(archiveWorkflow).not.toHaveBeenCalled();
		expect(writeAuditAndActivity).not.toHaveBeenCalled();
	});

	it("archives a live workflow + audits workflow.archived", async () => {
		vi.mocked(getWorkflowForOrg).mockResolvedValueOnce(wf() as never);
		await archiveWorkflowOp(ctx, { workflowId: "wf_1" });
		expect(archiveWorkflow).toHaveBeenCalledWith({ organizationId: "org-1", workflowId: "wf_1" });
		expect(writeAuditAndActivity).toHaveBeenCalledWith(
			expect.objectContaining({ action: "workflow.archived", entityId: "wf_1" }),
		);
	});
});
