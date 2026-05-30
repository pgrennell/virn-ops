// Phase 16 -- approval lib tests. Mocks the @virn/database boundary; verifies
// gating composition (capability + draft + no-duplicate-pending) for
// requestApproval, idempotency guard for decideApproval, and the audit
// emission shape on both paths.

import { ORPCError } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@virn/database", () => ({
	decideVersionApprovalRow: vi.fn(),
	getApprovalRowForOrg: vi.fn(),
	getLatestApprovalForVersion: vi.fn(),
	getVersionWithWorkflow: vi.fn(),
	insertVersionApproval: vi.fn(),
	isCapabilityEnabledForOrg: vi.fn(),
	listApprovalsForVersion: vi.fn(),
	listPendingApprovalsForOrg: vi.fn(),
	writeAuditAndActivity: vi.fn(),
}));

import {
	decideVersionApprovalRow,
	getApprovalRowForOrg,
	getLatestApprovalForVersion,
	getVersionWithWorkflow,
	insertVersionApproval,
	isCapabilityEnabledForOrg,
	writeAuditAndActivity,
} from "@virn/database";

import { decideApproval, requestApproval } from "./approval";

const ctx = { organizationId: "org-1", userId: "user-1" };

function makeBundle(overrides: Partial<Record<string, unknown>> = {}) {
	return {
		workflow: { id: "wf_1", organizationId: "org-1" },
		version: { id: "wv_1", versionNumber: 2, status: "draft" },
		...overrides,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(isCapabilityEnabledForOrg).mockResolvedValue(true);
	vi.mocked(writeAuditAndActivity).mockResolvedValue(undefined);
	vi.mocked(getLatestApprovalForVersion).mockResolvedValue(null);
});

// ---------------------------------------------------------------------------
// requestApproval
// ---------------------------------------------------------------------------

describe("requestApproval -- happy path", () => {
	it("inserts a pending row + emits one audit/activity", async () => {
		vi.mocked(getVersionWithWorkflow).mockResolvedValueOnce(makeBundle() as never);
		vi.mocked(insertVersionApproval).mockResolvedValueOnce({
			id: "appr_1",
			createdAt: new Date("2026-05-30T10:00:00Z"),
		});

		const result = await requestApproval(ctx, { workflowVersionId: "wv_1" });

		expect(result.id).toBe("appr_1");
		expect(insertVersionApproval).toHaveBeenCalledWith({
			workflowVersionId: "wv_1",
			requestedByUserId: "user-1",
			approverId: null,
		});
		expect(writeAuditAndActivity).toHaveBeenCalledTimes(1);
		expect(writeAuditAndActivity).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "version_approval.requested",
				verb: "requested approval",
				entityType: "version_approval",
				entityId: "appr_1",
			}),
		);
	});
});

describe("requestApproval -- refusal paths", () => {
	it("refuses NOT_FOUND when version is missing", async () => {
		vi.mocked(getVersionWithWorkflow).mockResolvedValueOnce(null);
		await expect(
			requestApproval(ctx, { workflowVersionId: "wv_missing" }),
		).rejects.toMatchObject({ code: "NOT_FOUND", data: { code: "VERSION_NOT_FOUND" } });
		expect(insertVersionApproval).not.toHaveBeenCalled();
	});

	it("refuses cross-org with NOT_FOUND (anti-enumeration)", async () => {
		vi.mocked(getVersionWithWorkflow).mockResolvedValueOnce(
			makeBundle({ workflow: { id: "wf_1", organizationId: "other-org" } }) as never,
		);
		await expect(
			requestApproval(ctx, { workflowVersionId: "wv_1" }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("refuses on a non-draft version", async () => {
		vi.mocked(getVersionWithWorkflow).mockResolvedValueOnce(
			makeBundle({ version: { id: "wv_1", versionNumber: 1, status: "published" } }) as never,
		);
		await expect(
			requestApproval(ctx, { workflowVersionId: "wv_1" }),
		).rejects.toMatchObject({ code: "BAD_REQUEST", data: { code: "VERSION_NOT_DRAFT" } });
	});

	it("refuses when capability is off", async () => {
		vi.mocked(getVersionWithWorkflow).mockResolvedValueOnce(makeBundle() as never);
		vi.mocked(isCapabilityEnabledForOrg).mockResolvedValueOnce(false);
		await expect(
			requestApproval(ctx, { workflowVersionId: "wv_1" }),
		).rejects.toMatchObject({ code: "FORBIDDEN", data: { code: "CAPABILITY_DISABLED" } });
	});

	it("refuses CONFLICT when a pending approval already exists", async () => {
		vi.mocked(getVersionWithWorkflow).mockResolvedValueOnce(makeBundle() as never);
		vi.mocked(getLatestApprovalForVersion).mockResolvedValueOnce({
			id: "appr_existing",
			decision: "pending",
		} as never);
		await expect(
			requestApproval(ctx, { workflowVersionId: "wv_1" }),
		).rejects.toMatchObject({
			code: "CONFLICT",
			data: { code: "APPROVAL_ALREADY_PENDING" },
		});
		expect(insertVersionApproval).not.toHaveBeenCalled();
	});

	it("refuses CONFLICT when already approved (publish instead)", async () => {
		vi.mocked(getVersionWithWorkflow).mockResolvedValueOnce(makeBundle() as never);
		vi.mocked(getLatestApprovalForVersion).mockResolvedValueOnce({
			id: "appr_existing",
			decision: "approved",
		} as never);
		await expect(
			requestApproval(ctx, { workflowVersionId: "wv_1" }),
		).rejects.toMatchObject({
			code: "CONFLICT",
			data: { code: "APPROVAL_ALREADY_APPROVED" },
		});
	});

	it("allows requesting again after rejection (re-request flow)", async () => {
		vi.mocked(getVersionWithWorkflow).mockResolvedValueOnce(makeBundle() as never);
		vi.mocked(getLatestApprovalForVersion).mockResolvedValueOnce({
			id: "appr_old",
			decision: "rejected",
		} as never);
		vi.mocked(insertVersionApproval).mockResolvedValueOnce({
			id: "appr_new",
			createdAt: new Date(),
		});

		const result = await requestApproval(ctx, { workflowVersionId: "wv_1" });
		expect(result.id).toBe("appr_new");
	});
});

// ---------------------------------------------------------------------------
// decideApproval
// ---------------------------------------------------------------------------

describe("decideApproval -- happy paths", () => {
	it("approves a pending row + emits the approved audit", async () => {
		vi.mocked(getApprovalRowForOrg).mockResolvedValueOnce({
			id: "appr_1",
			workflowId: "wf_1",
			workflowVersionId: "wv_1",
			workflowVersionNumber: 2,
			decision: "pending",
		});
		vi.mocked(decideVersionApprovalRow).mockResolvedValueOnce({
			id: "appr_1",
			decidedAt: new Date("2026-05-30T11:00:00Z"),
		});

		const result = await decideApproval(ctx, {
			approvalId: "appr_1",
			decision: "approved",
		});

		expect(result.decision).toBe("approved");
		expect(writeAuditAndActivity).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "version_approval.approved",
				verb: "approved",
			}),
		);
	});

	it("rejects with a note + emits the rejected audit + changes diff", async () => {
		vi.mocked(getApprovalRowForOrg).mockResolvedValueOnce({
			id: "appr_1",
			workflowId: "wf_1",
			workflowVersionId: "wv_1",
			workflowVersionNumber: 2,
			decision: "pending",
		});
		vi.mocked(decideVersionApprovalRow).mockResolvedValueOnce({
			id: "appr_1",
			decidedAt: new Date(),
		});

		await decideApproval(ctx, {
			approvalId: "appr_1",
			decision: "rejected",
			note: "Add a stop-task after step 4.",
		});

		expect(writeAuditAndActivity).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "version_approval.rejected",
				changes: { note: { from: null, to: "Add a stop-task after step 4." } },
			}),
		);
	});
});

describe("decideApproval -- refusal paths", () => {
	it("refuses NOT_FOUND when the approval isn't in this org", async () => {
		vi.mocked(getApprovalRowForOrg).mockResolvedValueOnce(null);
		await expect(
			decideApproval(ctx, { approvalId: "appr_x", decision: "approved" }),
		).rejects.toMatchObject({ code: "NOT_FOUND", data: { code: "APPROVAL_NOT_FOUND" } });
		expect(decideVersionApprovalRow).not.toHaveBeenCalled();
	});

	it("refuses CONFLICT when the approval was already decided", async () => {
		vi.mocked(getApprovalRowForOrg).mockResolvedValueOnce({
			id: "appr_1",
			workflowId: "wf_1",
			workflowVersionId: "wv_1",
			workflowVersionNumber: 2,
			decision: "approved",
		});
		await expect(
			decideApproval(ctx, { approvalId: "appr_1", decision: "rejected" }),
		).rejects.toMatchObject({
			code: "CONFLICT",
			data: { code: "APPROVAL_ALREADY_DECIDED" },
		});
		expect(decideVersionApprovalRow).not.toHaveBeenCalled();
	});

	it("refuses CONFLICT when the WHERE-pending update matched zero rows (concurrent decider)", async () => {
		vi.mocked(getApprovalRowForOrg).mockResolvedValueOnce({
			id: "appr_1",
			workflowId: "wf_1",
			workflowVersionId: "wv_1",
			workflowVersionNumber: 2,
			decision: "pending",
		});
		vi.mocked(decideVersionApprovalRow).mockResolvedValueOnce(null);

		await expect(
			decideApproval(ctx, { approvalId: "appr_1", decision: "approved" }),
		).rejects.toMatchObject({
			code: "CONFLICT",
			data: { code: "APPROVAL_ALREADY_DECIDED" },
		});
	});
});
