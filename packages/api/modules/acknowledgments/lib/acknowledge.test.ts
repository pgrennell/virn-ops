// Phase 16 -- acknowledge lib tests. Database is mocked at the @virn/database
// boundary; verifies the gating composition (org-scope + published-status +
// capability) + idempotency + audit emission rules.

import { ORPCError } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@virn/database", () => ({
	acknowledgeWorkflowVersion: vi.fn(),
	getVersionWithWorkflow: vi.fn(),
	hasUserAcknowledgedVersion: vi.fn(),
	isCapabilityEnabledForOrg: vi.fn(),
	writeAuditAndActivity: vi.fn(),
}));

import {
	acknowledgeWorkflowVersion,
	getVersionWithWorkflow,
	hasUserAcknowledgedVersion,
	isCapabilityEnabledForOrg,
	writeAuditAndActivity,
} from "@virn/database";

import { acknowledgeVersion, getMyAcknowledgmentStatus } from "./acknowledge";

const ctx = { organizationId: "org-1", userId: "user-1" };

function makeBundle(overrides: Partial<Record<string, unknown>> = {}) {
	return {
		workflow: { id: "wf_1", organizationId: "org-1" },
		version: { id: "wv_1", versionNumber: 2, status: "published" },
		...overrides,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(isCapabilityEnabledForOrg).mockResolvedValue(true);
	vi.mocked(writeAuditAndActivity).mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// acknowledgeVersion
// ---------------------------------------------------------------------------

describe("acknowledgeVersion -- happy path", () => {
	it("writes the row + emits one audit/activity for a fresh acknowledgment", async () => {
		vi.mocked(getVersionWithWorkflow).mockResolvedValueOnce(makeBundle() as never);
		vi.mocked(acknowledgeWorkflowVersion).mockResolvedValueOnce({
			id: "ack_1",
			acknowledgedAt: new Date("2026-05-30T10:00:00Z"),
			alreadyExisted: false,
		});

		const result = await acknowledgeVersion(ctx, { workflowVersionId: "wv_1" });

		expect(result.alreadyExisted).toBe(false);
		expect(acknowledgeWorkflowVersion).toHaveBeenCalledWith({
			organizationId: "org-1",
			workflowVersionId: "wv_1",
			userId: "user-1",
		});
		expect(writeAuditAndActivity).toHaveBeenCalledTimes(1);
		expect(writeAuditAndActivity).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "acknowledgment.created",
				verb: "acknowledged",
				entityType: "acknowledgment",
				entityId: "ack_1",
				actorKind: "user",
			}),
		);
	});

	it("re-acknowledging is a no-op for audit (alreadyExisted=true skips writeAuditAndActivity)", async () => {
		vi.mocked(getVersionWithWorkflow).mockResolvedValueOnce(makeBundle() as never);
		vi.mocked(acknowledgeWorkflowVersion).mockResolvedValueOnce({
			id: "ack_1",
			acknowledgedAt: new Date("2026-05-30T10:00:00Z"),
			alreadyExisted: true,
		});

		const result = await acknowledgeVersion(ctx, { workflowVersionId: "wv_1" });

		expect(result.alreadyExisted).toBe(true);
		expect(writeAuditAndActivity).not.toHaveBeenCalled();
	});
});

describe("acknowledgeVersion -- refusal paths", () => {
	it("refuses with NOT_FOUND when the version doesn't exist", async () => {
		vi.mocked(getVersionWithWorkflow).mockResolvedValueOnce(null);

		await expect(
			acknowledgeVersion(ctx, { workflowVersionId: "wv_missing" }),
		).rejects.toMatchObject({
			code: "NOT_FOUND",
			data: { code: "VERSION_NOT_FOUND" },
		});
		expect(acknowledgeWorkflowVersion).not.toHaveBeenCalled();
	});

	it("refuses cross-org access with NOT_FOUND (anti-enumeration posture)", async () => {
		vi.mocked(getVersionWithWorkflow).mockResolvedValueOnce(
			makeBundle({
				workflow: { id: "wf_1", organizationId: "other-org" },
			}) as never,
		);

		await expect(
			acknowledgeVersion(ctx, { workflowVersionId: "wv_1" }),
		).rejects.toMatchObject({
			code: "NOT_FOUND",
			data: { code: "VERSION_NOT_FOUND" },
		});
	});

	it("refuses draft versions with BAD_REQUEST/VERSION_NOT_PUBLISHED", async () => {
		vi.mocked(getVersionWithWorkflow).mockResolvedValueOnce(
			makeBundle({
				version: { id: "wv_1", versionNumber: 1, status: "draft" },
			}) as never,
		);

		await expect(
			acknowledgeVersion(ctx, { workflowVersionId: "wv_1" }),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
			data: { code: "VERSION_NOT_PUBLISHED" },
		});
	});

	it("refuses when capability is off with FORBIDDEN/CAPABILITY_DISABLED", async () => {
		vi.mocked(getVersionWithWorkflow).mockResolvedValueOnce(makeBundle() as never);
		vi.mocked(isCapabilityEnabledForOrg).mockResolvedValueOnce(false);

		await expect(
			acknowledgeVersion(ctx, { workflowVersionId: "wv_1" }),
		).rejects.toMatchObject({
			code: "FORBIDDEN",
			data: { code: "CAPABILITY_DISABLED" },
		});
		expect(acknowledgeWorkflowVersion).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// getMyAcknowledgmentStatus
// ---------------------------------------------------------------------------

describe("getMyAcknowledgmentStatus", () => {
	it("returns hasAcknowledged=false for cross-org versions (no error)", async () => {
		vi.mocked(getVersionWithWorkflow).mockResolvedValueOnce(
			makeBundle({
				workflow: { id: "wf_1", organizationId: "other-org" },
			}) as never,
		);

		const result = await getMyAcknowledgmentStatus(ctx, { workflowVersionId: "wv_1" });

		expect(result).toEqual({ hasAcknowledged: false, acknowledgedAt: null });
		// Notably: hasUserAcknowledgedVersion is NOT called -- we short-circuit on
		// the org-scope check.
		expect(hasUserAcknowledgedVersion).not.toHaveBeenCalled();
	});

	it("returns the row when present", async () => {
		const ackedAt = new Date("2026-05-30T10:00:00Z");
		vi.mocked(getVersionWithWorkflow).mockResolvedValueOnce(makeBundle() as never);
		vi.mocked(hasUserAcknowledgedVersion).mockResolvedValueOnce({
			id: "ack_1",
			acknowledgedAt: ackedAt,
		});

		const result = await getMyAcknowledgmentStatus(ctx, { workflowVersionId: "wv_1" });

		expect(result).toEqual({ hasAcknowledged: true, acknowledgedAt: ackedAt });
	});

	it("returns hasAcknowledged=false when no row", async () => {
		vi.mocked(getVersionWithWorkflow).mockResolvedValueOnce(makeBundle() as never);
		vi.mocked(hasUserAcknowledgedVersion).mockResolvedValueOnce(null);

		const result = await getMyAcknowledgmentStatus(ctx, { workflowVersionId: "wv_1" });

		expect(result).toEqual({ hasAcknowledged: false, acknowledgedAt: null });
	});
});
