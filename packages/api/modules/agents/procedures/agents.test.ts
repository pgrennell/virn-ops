// agents.test.ts
//
// Procedure-level tests for the agent CRUD surface (Phase 8 step 2, ADR-006 + D-022).
// Verifies the auth gate (UNAUTHORIZED, FORBIDDEN-without-org, FORBIDDEN-non-admin) plus
// the happy path for each procedure. Database is mocked at the @virn/database boundary --
// these are unit tests for the procedure layer, not end-to-end. Real DB walks happen via
// the Antigravity browser tests in apps/saas/tests/.

import { call } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@virn/auth", () => ({
	auth: {
		api: { getSession: vi.fn() },
	},
}));

vi.mock("@virn/database", () => ({
	getOrganizationMembership: vi.fn(),
	listAgentsForOrg: vi.fn(),
	getAgentForOrg: vi.fn(),
	createAgent: vi.fn(),
	updateAgent: vi.fn(),
	rotateAgentCredential: vi.fn(),
	softDeleteAgent: vi.fn(),
	writeAuditAndActivity: vi.fn(),
}));

import { auth } from "@virn/auth";
import {
	createAgent,
	getAgentForOrg,
	getOrganizationMembership,
	listAgentsForOrg,
	rotateAgentCredential,
	softDeleteAgent,
	updateAgent,
	writeAuditAndActivity,
} from "@virn/database";

import { create } from "./create";
import { get } from "./get";
import { list } from "./list";
import { rotateCredential } from "./rotate-credential";
import { softDelete } from "./soft-delete";
import { update } from "./update";

const ctx = { context: { headers: new Headers() } };

function makeSession(opts: { activeOrganizationId?: string | null } = {}) {
	// Use `in opts` to distinguish "not provided" (default to org-1) from
	// "explicitly null" (use null) -- ?? would coerce null back to the default.
	const activeOrganizationId =
		"activeOrganizationId" in opts ? opts.activeOrganizationId : "org-1";
	return {
		session: {
			id: "session-1",
			userId: "user-1",
			token: "tok",
			expiresAt: new Date(),
			activeOrganizationId,
		},
		user: { id: "user-1", email: "u@example.com", name: "U", emailVerified: true },
	};
}

function makeMembership(role: "owner" | "admin" | "member" = "admin") {
	return {
		organization: { id: "org-1", name: "Org", slug: "org" },
		role,
	};
}

describe("agents procedures -- auth gate", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(auth.api.getSession).mockResolvedValue(makeSession() as never);
		vi.mocked(getOrganizationMembership).mockResolvedValue(makeMembership() as never);
	});

	it("list throws UNAUTHORIZED when there is no session", async () => {
		vi.mocked(auth.api.getSession).mockResolvedValueOnce(null);
		await expect(call(list, {}, ctx)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
	});

	it("list throws FORBIDDEN when there is no active organization", async () => {
		vi.mocked(auth.api.getSession).mockResolvedValueOnce(
			makeSession({ activeOrganizationId: null }) as never,
		);
		await expect(call(list, {}, ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
	});

	it("create throws FORBIDDEN when caller is a plain member (not admin/owner)", async () => {
		vi.mocked(getOrganizationMembership).mockResolvedValueOnce(makeMembership("member") as never);
		await expect(
			call(create, { name: "Turnover AI" }, ctx),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});

	it("update throws FORBIDDEN when caller is a plain member", async () => {
		vi.mocked(getOrganizationMembership).mockResolvedValueOnce(makeMembership("member") as never);
		await expect(
			call(update, { id: "a-1", name: "x" }, ctx),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});

	it("rotateCredential throws FORBIDDEN when caller is a plain member", async () => {
		vi.mocked(getOrganizationMembership).mockResolvedValueOnce(makeMembership("member") as never);
		await expect(
			call(rotateCredential, { id: "a-1" }, ctx),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});

	it("softDelete throws FORBIDDEN when caller is a plain member", async () => {
		vi.mocked(getOrganizationMembership).mockResolvedValueOnce(makeMembership("member") as never);
		await expect(
			call(softDelete, { id: "a-1" }, ctx),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});

	it("list works for plain members (read access)", async () => {
		vi.mocked(getOrganizationMembership).mockResolvedValueOnce(makeMembership("member") as never);
		vi.mocked(listAgentsForOrg).mockResolvedValueOnce([]);
		await expect(call(list, {}, ctx)).resolves.toEqual([]);
	});

	it("get works for plain members (read access)", async () => {
		vi.mocked(getOrganizationMembership).mockResolvedValueOnce(makeMembership("member") as never);
		const row = {
			id: "a-1",
			name: "Turnover AI",
			description: null,
			isActive: true,
			credentialLastFour: "a3f9",
			credentialRotatedAt: new Date(),
			createdByUserId: "user-1",
			createdByUserName: "U",
			createdAt: new Date(),
			updatedAt: new Date(),
		};
		vi.mocked(getAgentForOrg).mockResolvedValueOnce(row as never);
		await expect(call(get, { id: "a-1" }, ctx)).resolves.toEqual(row);
	});
});

describe("agents procedures -- happy paths", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(auth.api.getSession).mockResolvedValue(makeSession() as never);
		vi.mocked(getOrganizationMembership).mockResolvedValue(makeMembership() as never);
	});

	it("create returns the plaintext credential ONCE and audit-logs agent.created", async () => {
		const createResult = {
			id: "a-1",
			name: "Turnover AI",
			description: null,
			isActive: true,
			credentialLastFour: "a3f9",
			credentialRotatedAt: new Date(),
			createdAt: new Date(),
			plaintextCredential: "agent_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa3f9",
		};
		vi.mocked(createAgent).mockResolvedValueOnce(createResult as never);

		const res = await call(create, { name: "Turnover AI" }, ctx);

		expect(res.plaintextCredential).toBe(createResult.plaintextCredential);
		expect(res.credentialLastFour).toBe("a3f9");
		expect(writeAuditAndActivity).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "agent.created",
				entityType: "agent",
				entityId: "a-1",
			}),
		);
	});

	it("create maps UNIQUE constraint violation to CONFLICT", async () => {
		vi.mocked(createAgent).mockRejectedValueOnce(
			new Error('duplicate key value violates unique constraint "uq_agent_org_name"'),
		);
		await expect(
			call(create, { name: "Turnover AI" }, ctx),
		).rejects.toMatchObject({ code: "CONFLICT" });
	});

	it("update returns the updated row + audit-logs agent.updated", async () => {
		const updated = {
			id: "a-1",
			name: "Turnover Bot",
			description: "Renamed",
			isActive: true,
			credentialLastFour: "a3f9",
			credentialRotatedAt: new Date(),
			createdByUserId: "user-1",
			createdByUserName: "U",
			createdAt: new Date(),
			updatedAt: new Date(),
		};
		vi.mocked(updateAgent).mockResolvedValueOnce(updated as never);

		const res = await call(update, { id: "a-1", name: "Turnover Bot" }, ctx);

		expect(res.name).toBe("Turnover Bot");
		expect(writeAuditAndActivity).toHaveBeenCalledWith(
			expect.objectContaining({ action: "agent.updated", entityId: "a-1" }),
		);
	});

	it("update throws NOT_FOUND when the agent doesn't exist", async () => {
		vi.mocked(updateAgent).mockResolvedValueOnce(null);
		await expect(
			call(update, { id: "missing", name: "x" }, ctx),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("rotateCredential returns plaintext ONCE + audit-logs agent.credential_rotated", async () => {
		const rotateResult = {
			plaintextCredential: "agent_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb9z2",
			credentialLastFour: "b9z2",
			credentialRotatedAt: new Date(),
		};
		vi.mocked(rotateAgentCredential).mockResolvedValueOnce(rotateResult as never);

		const res = await call(rotateCredential, { id: "a-1" }, ctx);

		expect(res.plaintextCredential).toBe(rotateResult.plaintextCredential);
		expect(res.credentialLastFour).toBe("b9z2");
		expect(writeAuditAndActivity).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "agent.credential_rotated",
				entityId: "a-1",
			}),
		);
	});

	it("rotateCredential throws NOT_FOUND when the agent doesn't exist", async () => {
		vi.mocked(rotateAgentCredential).mockResolvedValueOnce(null);
		await expect(
			call(rotateCredential, { id: "missing" }, ctx),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("softDelete returns deleted:true + audit-logs agent.deleted", async () => {
		vi.mocked(softDeleteAgent).mockResolvedValueOnce({ deleted: true });

		const res = await call(softDelete, { id: "a-1" }, ctx);

		expect(res).toEqual({ deleted: true });
		expect(writeAuditAndActivity).toHaveBeenCalledWith(
			expect.objectContaining({ action: "agent.deleted", entityId: "a-1" }),
		);
	});

	it("softDelete throws NOT_FOUND when the agent doesn't exist (or already deleted)", async () => {
		vi.mocked(softDeleteAgent).mockResolvedValueOnce({ deleted: false });
		await expect(
			call(softDelete, { id: "missing" }, ctx),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

// Credential-helper tests live in agents-credentials.test.ts -- that file doesn't mock
// @virn/database, since these helpers are pure functions tested against the real impl.
