// Governance hardening -- procedure-level auth gate for the acknowledgments
// surface. acknowledge + getMyStatus are protectedOrgProcedure (any member may
// acknowledge / check their own status); get + list are adminOrgProcedure (the
// reviewer-facing receipt + roster are admin-only). Unauthenticated -> UNAUTHORIZED
// everywhere. Mirrors approvals-authz.test.ts.

import { call } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@virn/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));

vi.mock("@virn/database", () => ({
	getOrganizationMembership: vi.fn(),
	// acknowledge lib + the read procedures pull these at module load.
	acknowledgeWorkflowVersion: vi.fn(),
	getVersionWithWorkflow: vi.fn(),
	hasUserAcknowledgedVersion: vi.fn(),
	isCapabilityEnabledForOrg: vi.fn(),
	writeAuditAndActivity: vi.fn(),
	getAcknowledgmentForOrg: vi.fn(),
	listAcknowledgmentsForOrg: vi.fn(),
}));

import { auth } from "@virn/auth";
import {
	acknowledgeWorkflowVersion,
	getOrganizationMembership,
	getVersionWithWorkflow,
	isCapabilityEnabledForOrg,
	writeAuditAndActivity,
} from "@virn/database";

import { acknowledgeProc } from "./acknowledge";
import { getAcknowledgmentProc } from "./get-acknowledgment";
import { getMyStatusProc } from "./get-my-status";
import { listAcknowledgmentsProc } from "./list-acknowledgments";

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

describe("acknowledgments procedures -- admin-only reviewer surfaces", () => {
	const adminProcs = [
		{ name: "get", run: () => call(getAcknowledgmentProc, { acknowledgmentId: "ack_1" }, reqCtx) },
		{ name: "list", run: () => call(listAcknowledgmentsProc, {}, reqCtx) },
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

describe("acknowledgments procedures -- member-allowed self surfaces", () => {
	it("acknowledge is allowed for a plain member", async () => {
		vi.mocked(getOrganizationMembership).mockResolvedValueOnce(makeMembership("member") as never);
		vi.mocked(getVersionWithWorkflow).mockResolvedValueOnce({
			workflow: { id: "wf_1", organizationId: "org-1" },
			version: { id: "wv_1", versionNumber: 2, status: "published" },
		} as never);
		vi.mocked(isCapabilityEnabledForOrg).mockResolvedValueOnce(true);
		vi.mocked(acknowledgeWorkflowVersion).mockResolvedValueOnce({
			id: "ack_1",
			acknowledgedAt: new Date(),
			alreadyExisted: false,
		} as never);
		vi.mocked(writeAuditAndActivity).mockResolvedValue(undefined as never);

		const res = await call(acknowledgeProc, { workflowVersionId: "wv_1" }, reqCtx);
		expect(res).toMatchObject({ id: "ack_1", alreadyExisted: false });
	});

	it("getMyStatus is allowed for a plain member (false for a missing version)", async () => {
		vi.mocked(getOrganizationMembership).mockResolvedValueOnce(makeMembership("member") as never);
		vi.mocked(getVersionWithWorkflow).mockResolvedValueOnce(null);
		const res = await call(getMyStatusProc, { workflowVersionId: "wv_1" }, reqCtx);
		expect(res).toEqual({ hasAcknowledged: false, acknowledgedAt: null });
	});

	it("acknowledge throws UNAUTHORIZED with no session", async () => {
		vi.mocked(auth.api.getSession).mockResolvedValueOnce(null);
		await expect(
			call(acknowledgeProc, { workflowVersionId: "wv_1" }, reqCtx),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });
	});

	it("getMyStatus throws UNAUTHORIZED with no session", async () => {
		vi.mocked(auth.api.getSession).mockResolvedValueOnce(null);
		await expect(
			call(getMyStatusProc, { workflowVersionId: "wv_1" }, reqCtx),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });
	});
});
