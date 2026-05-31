// Governance hardening -- procedure-level auth gate for the approvals surface.
// request / decide / listPending are adminOrgProcedure (a plain member is
// FORBIDDEN); getLatest is protectedOrgProcedure (any member may read). An
// unauthenticated caller is UNAUTHORIZED everywhere. Mirrors
// playbook-runs-authz.test.ts: mock @virn/auth + @virn/database, drive via call().

import { call } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@virn/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));

vi.mock("@virn/database", () => ({
	getOrganizationMembership: vi.fn(),
	// approval lib pulls these at module load; unreached on the gate-fail paths.
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

import { auth } from "@virn/auth";
import { getOrganizationMembership, getVersionWithWorkflow } from "@virn/database";

import { decideApprovalProc } from "./decide-approval";
import { getLatestProc } from "./get-latest";
import { listPendingProc } from "./list-pending";
import { requestApprovalProc } from "./request-approval";

const reqCtx = { context: { headers: new Headers() } };

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
});

describe("approvals procedures -- admin-only writes/queue", () => {
	const adminProcs = [
		{ name: "request", run: () => call(requestApprovalProc, { workflowVersionId: "wv_1" }, reqCtx) },
		{ name: "decide", run: () => call(decideApprovalProc, { approvalId: "a1", decision: "approved" as const }, reqCtx) },
		{ name: "listPending", run: () => call(listPendingProc, {}, reqCtx) },
	];

	for (const p of adminProcs) {
		it(`${p.name} throws FORBIDDEN for a plain member`, async () => {
			vi.mocked(getOrganizationMembership).mockResolvedValueOnce(makeMembership("member") as never);
			await expect(p.run()).rejects.toMatchObject({ code: "FORBIDDEN" });
		});

		it(`${p.name} throws UNAUTHORIZED with no session`, async () => {
			vi.mocked(auth.api.getSession).mockResolvedValueOnce(null);
			await expect(p.run()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
		});
	}
});

describe("approvals.getLatest -- member-readable", () => {
	it("is allowed for a plain member (returns null for a missing version)", async () => {
		vi.mocked(getOrganizationMembership).mockResolvedValueOnce(makeMembership("member") as never);
		vi.mocked(getVersionWithWorkflow).mockResolvedValueOnce(null);
		const res = await call(getLatestProc, { workflowVersionId: "wv_1" }, reqCtx);
		expect(res).toBeNull();
	});

	it("throws UNAUTHORIZED with no session", async () => {
		vi.mocked(auth.api.getSession).mockResolvedValueOnce(null);
		await expect(
			call(getLatestProc, { workflowVersionId: "wv_1" }, reqCtx),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });
	});
});
