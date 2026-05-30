// packages/api/modules/audit/procedures/list-for-entity.test.ts
//
// Phase 15 -- audit.listForEntity procedure tests. Database is mocked at the
// @virn/database boundary; these verify the input -> query-arg threading,
// adminOrg gating, and result-shape pass-through. The SQL LEFT JOIN to user
// is integration-test territory.

import { call } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@virn/auth", () => ({
	auth: { api: { getSession: vi.fn() } },
}));

vi.mock("@virn/database", () => ({
	getOrganizationMembership: vi.fn(),
	listAuditLogForEntity: vi.fn(),
}));

import { auth } from "@virn/auth";
import { getOrganizationMembership, listAuditLogForEntity } from "@virn/database";

import { listForEntityProc } from "./list-for-entity";

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

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(auth.api.getSession).mockResolvedValue(makeSession() as never);
	vi.mocked(getOrganizationMembership).mockResolvedValue(makeMembership() as never);
	vi.mocked(listAuditLogForEntity).mockResolvedValue({ rows: [], totalCount: 0 });
});

describe("audit.listForEntity -- org scoping + arg threading", () => {
	it("threads context.organization.id into the query", async () => {
		await call(
			listForEntityProc,
			{ entityType: "workflow", entityId: "wf_1" },
			ctx,
		);

		expect(listAuditLogForEntity).toHaveBeenCalledTimes(1);
		expect(listAuditLogForEntity).toHaveBeenCalledWith(
			expect.objectContaining({ organizationId: "org-1" }),
		);
	});

	it("forwards every documented input field 1:1 to the query", async () => {
		await call(
			listForEntityProc,
			{
				entityType: "run",
				entityId: "run_42",
				limit: 50,
				offset: 25,
			},
			ctx,
		);

		expect(listAuditLogForEntity).toHaveBeenCalledWith({
			organizationId: "org-1",
			entityType: "run",
			entityId: "run_42",
			limit: 50,
			offset: 25,
		});
	});

	it("returns the query's { rows, totalCount } shape verbatim", async () => {
		const sampleRow = {
			id: "audit_1",
			action: "workflow.published",
			actorKind: "user" as const,
			actorUserId: "user_admin",
			actorUserName: "Alice Admin",
			actorUserEmail: "alice@example.com",
			actorParticipantId: null,
			crossProductOrigin: null,
			entityType: "workflow" as const,
			entityId: "wf_1",
			changes: { versionNumber: { from: 2, to: 3 } },
			metadata: { route: "workflows.publishVersion" },
			createdAt: new Date("2026-05-29T10:00:00Z"),
		};
		vi.mocked(listAuditLogForEntity).mockResolvedValueOnce({
			rows: [sampleRow],
			totalCount: 1,
		});

		const result = await call(
			listForEntityProc,
			{ entityType: "workflow", entityId: "wf_1" },
			ctx,
		);

		expect(result).toEqual({ rows: [sampleRow], totalCount: 1 });
	});
});

describe("audit.listForEntity -- gating", () => {
	it("rejects plain members (admin or owner required)", async () => {
		vi.mocked(getOrganizationMembership).mockResolvedValueOnce(
			makeMembership("member") as never,
		);
		await expect(
			call(listForEntityProc, { entityType: "workflow", entityId: "wf_1" }, ctx),
		).rejects.toThrow();
		expect(listAuditLogForEntity).not.toHaveBeenCalled();
	});

	it("admits owners", async () => {
		vi.mocked(getOrganizationMembership).mockResolvedValueOnce(
			makeMembership("owner") as never,
		);
		await call(
			listForEntityProc,
			{ entityType: "workflow", entityId: "wf_1" },
			ctx,
		);
		expect(listAuditLogForEntity).toHaveBeenCalledTimes(1);
	});
});

describe("audit.listForEntity -- input validation", () => {
	it("rejects an unknown entityType literal", async () => {
		await expect(
			call(
				listForEntityProc,
				{ entityType: "not_an_entity_type", entityId: "x" } as never,
				ctx,
			),
		).rejects.toThrow();
		expect(listAuditLogForEntity).not.toHaveBeenCalled();
	});

	it("rejects an empty entityId", async () => {
		await expect(
			call(listForEntityProc, { entityType: "workflow", entityId: "" }, ctx),
		).rejects.toThrow();
		expect(listAuditLogForEntity).not.toHaveBeenCalled();
	});

	it("rejects limit above the cap (100)", async () => {
		await expect(
			call(
				listForEntityProc,
				{ entityType: "workflow", entityId: "wf_1", limit: 101 },
				ctx,
			),
		).rejects.toThrow();
		expect(listAuditLogForEntity).not.toHaveBeenCalled();
	});
});
