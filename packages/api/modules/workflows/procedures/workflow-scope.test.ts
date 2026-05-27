// packages/api/modules/workflows/procedures/workflow-scope.test.ts
//
// Phase 9.5e — workflow-level entity-set scope (PRD §6.2, §6.3) procedure tests.
//
// Covers:
//   - workflows.update accepts and persists `entitySetIds`
//   - workflows.update treats unchanged scope as a no-op (order-insensitive comparison)
//   - workflows.listForEntity is read-open to members; auth-resolves the active org
//     and delegates to the query helper with the right shape

import { call } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@virn/auth", () => ({
	auth: { api: { getSession: vi.fn() } },
}));

vi.mock("@virn/database", () => ({
	getOrganizationMembership: vi.fn(),
	getWorkflowForOrg: vi.fn(),
	updateWorkflow: vi.fn(),
	writeAuditAndActivity: vi.fn(),
	listWorkflowsForEntity: vi.fn(),
}));

import { auth } from "@virn/auth";
import {
	getOrganizationMembership,
	getWorkflowForOrg,
	listWorkflowsForEntity,
	updateWorkflow,
	writeAuditAndActivity,
} from "@virn/database";

import { listForEntityProc } from "./list-for-entity";
import { updateWorkflowProc } from "./update-workflow";

const ctx = { context: { headers: new Headers() } };

function makeSession() {
	return {
		session: {
			id: "session-1",
			userId: "user-1",
			token: "tok",
			expiresAt: new Date(),
			activeOrganizationId: "org-1",
		},
		user: { id: "user-1", email: "u@example.com", name: "U", emailVerified: true },
	};
}

function makeMembership(role: "owner" | "admin" | "member" = "admin") {
	return { organization: { id: "org-1", name: "Org", slug: "org" }, role };
}

function makeWorkflow(overrides: Partial<Record<string, unknown>> = {}) {
	return {
		id: "wf_1",
		organizationId: "org-1",
		title: "Onboarding",
		description: null,
		type: "procedure" as const,
		isActive: true,
		reviewIntervalDays: null,
		nextReviewAt: null,
		entitySetIds: [] as string[],
		reviewState: "draft" as const,
		installedFromListingVersionId: null,
		createdBy: "user-1",
		deletedAt: null,
		createdAt: new Date(),
		updatedAt: new Date(),
		...overrides,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(auth.api.getSession).mockResolvedValue(makeSession() as never);
	vi.mocked(getOrganizationMembership).mockResolvedValue(makeMembership() as never);
	vi.mocked(writeAuditAndActivity).mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// workflows.update -- entitySetIds path
// ---------------------------------------------------------------------------

describe("workflows.update -- entitySetIds (Phase 9.5e)", () => {
	it("persists a new entity-set scope and audits the change", async () => {
		vi.mocked(getWorkflowForOrg).mockResolvedValueOnce(makeWorkflow() as never);
		vi.mocked(updateWorkflow).mockResolvedValueOnce(undefined);

		const result = await call(
			updateWorkflowProc,
			{ workflowId: "wf_1", entitySetIds: ["es_1", "es_2"] },
			ctx,
		);

		expect(result).toEqual({ ok: true });
		expect(updateWorkflow).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: "org-1",
				workflowId: "wf_1",
				entitySetIds: ["es_1", "es_2"],
			}),
		);
		expect(writeAuditAndActivity).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "workflow.updated",
				entityId: "wf_1",
				changes: expect.objectContaining({
					entitySetIds: { from: [], to: ["es_1", "es_2"] },
				}),
			}),
		);
	});

	it("treats unchanged scope as a no-op (order-insensitive set equality)", async () => {
		vi.mocked(getWorkflowForOrg).mockResolvedValueOnce(
			makeWorkflow({ entitySetIds: ["es_1", "es_2"] }) as never,
		);

		// Same set, different order -- should not update or audit.
		await call(
			updateWorkflowProc,
			{ workflowId: "wf_1", entitySetIds: ["es_2", "es_1"] },
			ctx,
		);

		expect(updateWorkflow).not.toHaveBeenCalled();
		expect(writeAuditAndActivity).not.toHaveBeenCalled();
	});

	it("clearing scope to [] is a real change when scope was previously populated", async () => {
		vi.mocked(getWorkflowForOrg).mockResolvedValueOnce(
			makeWorkflow({ entitySetIds: ["es_1"] }) as never,
		);
		vi.mocked(updateWorkflow).mockResolvedValueOnce(undefined);

		await call(updateWorkflowProc, { workflowId: "wf_1", entitySetIds: [] }, ctx);

		expect(updateWorkflow).toHaveBeenCalledWith(
			expect.objectContaining({ entitySetIds: [] }),
		);
		expect(writeAuditAndActivity).toHaveBeenCalledWith(
			expect.objectContaining({
				changes: expect.objectContaining({
					entitySetIds: { from: ["es_1"], to: [] },
				}),
			}),
		);
	});

	it("throws FORBIDDEN for plain members (writes are admin-only)", async () => {
		vi.mocked(getOrganizationMembership).mockResolvedValueOnce(
			makeMembership("member") as never,
		);
		await expect(
			call(updateWorkflowProc, { workflowId: "wf_1", entitySetIds: ["es_1"] }, ctx),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});

	it("caps entitySetIds at 50 entries (input validation)", async () => {
		const tooMany = Array.from({ length: 51 }, (_, i) => `es_${i}`);
		await expect(
			call(updateWorkflowProc, { workflowId: "wf_1", entitySetIds: tooMany }, ctx),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});
});

// ---------------------------------------------------------------------------
// workflows.listForEntity -- entity-context picker
// ---------------------------------------------------------------------------

describe("workflows.listForEntity (Phase 9.5e)", () => {
	function makeEntityWorkflow(overrides: Partial<Record<string, unknown>> = {}) {
		return {
			id: "wf_1",
			type: "procedure" as const,
			title: "STR Turnover",
			description: null,
			isActive: true,
			entitySetIds: ["es_1"],
			latestPublishedVersionId: "ver_1",
			latestPublishedVersionNumber: 1,
			latestPublishedAt: new Date(),
			...overrides,
		};
	}

	it("delegates to listWorkflowsForEntity with org + entity context", async () => {
		const rows = [makeEntityWorkflow()];
		vi.mocked(listWorkflowsForEntity).mockResolvedValueOnce(rows as never);

		const res = await call(
			listForEntityProc,
			{ entityType: "listing", entityId: "lst_1" },
			ctx,
		);

		expect(res).toEqual(rows);
		expect(listWorkflowsForEntity).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: "org-1",
				entityType: "listing",
				entityId: "lst_1",
			}),
		);
	});

	it("works for plain members (reads are open)", async () => {
		vi.mocked(getOrganizationMembership).mockResolvedValueOnce(
			makeMembership("member") as never,
		);
		vi.mocked(listWorkflowsForEntity).mockResolvedValueOnce([]);

		await expect(
			call(listForEntityProc, { entityType: "listing", entityId: "lst_1" }, ctx),
		).resolves.toEqual([]);
	});

	it("rejects unknown entity types at the input schema", async () => {
		await expect(
			call(
				listForEntityProc,
				{ entityType: "vendor" as never, entityId: "x" },
				ctx,
			),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});
});
