// packages/api/modules/runs/procedures/list-runs.test.ts
//
// Phase 14 -- runs.list procedure tests. Database is mocked at the @virn/database
// boundary; these verify the input -> query-arg threading + org-scoping contract,
// not the SQL GROUP BY / EXISTS subquery (integration-test territory).

import { call } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@virn/auth", () => ({
	auth: { api: { getSession: vi.fn() } },
}));

vi.mock("@virn/database", () => ({
	getOrganizationMembership: vi.fn(),
	listRunsWithProgress: vi.fn(),
}));

import { auth } from "@virn/auth";
import { getOrganizationMembership, listRunsWithProgress } from "@virn/database";

import { listRunsProc } from "./list-runs";

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

function makeMembership(role: "owner" | "admin" | "member" = "member") {
	return { organization: { id: "org-1", name: "Org", slug: "org" }, role };
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(auth.api.getSession).mockResolvedValue(makeSession() as never);
	vi.mocked(getOrganizationMembership).mockResolvedValue(makeMembership() as never);
	vi.mocked(listRunsWithProgress).mockResolvedValue({ rows: [], totalCount: 0 });
});

describe("runs.list -- org scoping + arg threading", () => {
	it("threads context.organization.id into the query (no caller-supplied org)", async () => {
		await call(listRunsProc, {}, ctx);

		expect(listRunsWithProgress).toHaveBeenCalledTimes(1);
		expect(listRunsWithProgress).toHaveBeenCalledWith(
			expect.objectContaining({ organizationId: "org-1" }),
		);
	});

	it("forwards every documented input field 1:1 to the query", async () => {
		await call(
			listRunsProc,
			{
				workflowId: "wf_1",
				statuses: ["active", "completed"],
				needsAttention: true,
				entityType: "listing",
				entityId: "list_1",
				sort: "due_asc",
				limit: 25,
				offset: 50,
			},
			ctx,
		);

		expect(listRunsWithProgress).toHaveBeenCalledWith({
			organizationId: "org-1",
			workflowId: "wf_1",
			statuses: ["active", "completed"],
			needsAttention: true,
			entityType: "listing",
			entityId: "list_1",
			sort: "due_asc",
			limit: 25,
			offset: 50,
		});
	});

	it("returns the query's { rows, totalCount } shape verbatim", async () => {
		const sampleRow = {
			id: "run_1",
			title: "STR Turnover #42",
			status: "active" as const,
			startedAt: new Date("2026-05-29T10:00:00Z"),
			dueAt: new Date("2026-05-30T10:00:00Z"),
			completedAt: null,
			workflowId: "wf_1",
			workflowTitle: "STR Turnover",
			workflowType: "procedure" as const,
			totalSteps: 17,
			completedSteps: 4,
			isOverdue: false,
			hasBlockedStep: false,
			entityType: "listing" as const,
			entityId: "list_1",
		};
		vi.mocked(listRunsWithProgress).mockResolvedValueOnce({
			rows: [sampleRow],
			totalCount: 1,
		});

		const result = await call(listRunsProc, {}, ctx);

		expect(result).toEqual({ rows: [sampleRow], totalCount: 1 });
	});
});

describe("runs.list -- input validation", () => {
	it("rejects entityType without entityId", async () => {
		await expect(
			call(listRunsProc, { entityType: "listing" } as never, ctx),
		).rejects.toThrow();
		expect(listRunsWithProgress).not.toHaveBeenCalled();
	});

	it("rejects entityId without entityType", async () => {
		await expect(
			call(listRunsProc, { entityId: "list_1" } as never, ctx),
		).rejects.toThrow();
		expect(listRunsWithProgress).not.toHaveBeenCalled();
	});

	it("rejects empty statuses array", async () => {
		await expect(
			call(listRunsProc, { statuses: [] }, ctx),
		).rejects.toThrow();
		expect(listRunsWithProgress).not.toHaveBeenCalled();
	});

	it("rejects limit above the cap (100)", async () => {
		await expect(
			call(listRunsProc, { limit: 101 }, ctx),
		).rejects.toThrow();
		expect(listRunsWithProgress).not.toHaveBeenCalled();
	});
});
