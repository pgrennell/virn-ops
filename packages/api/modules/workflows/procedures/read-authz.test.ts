// Workflows procedure hardening (W5, final group) -- the read surface + read-receipts.
// get-workflow, get-version-bundle, list-workflows, get-my-read-status, mark-as-read
// are protectedOrgProcedure (member-readable / user-self); list-read-receipts is
// adminOrgProcedure (the reviewer "who has read this" roster). (list-for-entity is
// covered by workflow-scope.test.ts and list-for-review by review-state.test.ts --
// both skipped here.) Pins: the gates, the read-receipt OWNERSHIP scoping (the lib
// receives the caller's SESSION user.id, never one from input), and the cross-org
// NOT_FOUND refusals on the two single-row reads.

import { call } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@virn/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));

vi.mock("@virn/database", () => ({
	getOrganizationMembership: vi.fn(),
	getWorkflowWithVersions: vi.fn(),
	getVersionWithWorkflow: vi.fn(),
	getVersionEditBundle: vi.fn(),
	listWorkflowsForOrg: vi.fn(),
}));

vi.mock("../lib/read-receipts", () => ({
	getMyReadStatus: vi.fn(),
	markVersionAsRead: vi.fn(),
	listVersionReadReceipts: vi.fn(),
}));

import { auth } from "@virn/auth";
import {
	getOrganizationMembership,
	getVersionEditBundle,
	getVersionWithWorkflow,
	getWorkflowWithVersions,
	listWorkflowsForOrg,
} from "@virn/database";

import { getMyReadStatus, listVersionReadReceipts, markVersionAsRead } from "../lib/read-receipts";
import { getMyReadStatusProc } from "./get-my-read-status";
import { getVersionBundleProc } from "./get-version-bundle";
import { getWorkflowProc } from "./get-workflow";
import { listReadReceiptsProc } from "./list-read-receipts";
import { listWorkflowsProc } from "./list-workflows";
import { markAsReadProc } from "./mark-as-read";

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
});

describe("workflows reads -- member-readable", () => {
	beforeEach(() => {
		vi.mocked(getOrganizationMembership).mockResolvedValue(makeMembership("member") as never);
	});

	it("get-workflow is allowed for a member; returns the row", async () => {
		vi.mocked(getWorkflowWithVersions).mockResolvedValueOnce({ id: "wf_1" } as never);
		await expect(call(getWorkflowProc, { workflowId: "wf_1" }, ctx)).resolves.toMatchObject({ id: "wf_1" });
	});

	it("get-version-bundle is allowed for a member; merges the in-org bundle", async () => {
		vi.mocked(getVersionWithWorkflow).mockResolvedValueOnce({ workflow: { organizationId: "org-1" } } as never);
		vi.mocked(getVersionEditBundle).mockResolvedValueOnce({ sections: [] } as never);
		await expect(call(getVersionBundleProc, { versionId: "ver_1" }, ctx)).resolves.toMatchObject({ sections: [] });
	});

	it("list-workflows is allowed for a member", async () => {
		vi.mocked(listWorkflowsForOrg).mockResolvedValueOnce([] as never);
		await expect(call(listWorkflowsProc, {}, ctx)).resolves.toBeDefined();
	});
});

describe("workflows reads -- cross-org NOT_FOUND (anti-enumeration)", () => {
	it("get-workflow throws NOT_FOUND for a missing / cross-org workflow", async () => {
		vi.mocked(getWorkflowWithVersions).mockResolvedValueOnce(null as never);
		await expect(call(getWorkflowProc, { workflowId: "missing" }, ctx)).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("get-version-bundle throws NOT_FOUND when the version is in another org", async () => {
		vi.mocked(getVersionWithWorkflow).mockResolvedValueOnce({ workflow: { organizationId: "other-org" } } as never);
		await expect(call(getVersionBundleProc, { versionId: "ver_x" }, ctx)).rejects.toMatchObject({ code: "NOT_FOUND" });
		expect(getVersionEditBundle).not.toHaveBeenCalled();
	});
});

describe("workflows read-receipts -- ownership scoping + tier", () => {
	it("get-my-read-status forwards the caller's SESSION user id (not from input)", async () => {
		vi.mocked(getMyReadStatus).mockResolvedValueOnce({ hasRead: false } as never);
		await call(getMyReadStatusProc, { workflowVersionId: "ver_1" }, ctx);
		expect(getMyReadStatus).toHaveBeenCalledWith(
			expect.objectContaining({ organizationId: "org-1", userId: "user-1" }),
			expect.anything(),
		);
	});

	it("mark-as-read forwards the caller's SESSION user id", async () => {
		vi.mocked(markVersionAsRead).mockResolvedValueOnce({ marked: true } as never);
		await call(markAsReadProc, { workflowVersionId: "ver_1" }, ctx);
		expect(markVersionAsRead).toHaveBeenCalledWith(
			expect.objectContaining({ organizationId: "org-1", userId: "user-1" }),
			expect.anything(),
		);
	});

	it("get-my-read-status + mark-as-read are allowed for a plain member", async () => {
		vi.mocked(getOrganizationMembership).mockResolvedValue(makeMembership("member") as never);
		vi.mocked(getMyReadStatus).mockResolvedValueOnce({ hasRead: true } as never);
		vi.mocked(markVersionAsRead).mockResolvedValueOnce({ marked: true } as never);
		await expect(call(getMyReadStatusProc, { workflowVersionId: "ver_1" }, ctx)).resolves.toBeDefined();
		await expect(call(markAsReadProc, { workflowVersionId: "ver_1" }, ctx)).resolves.toBeDefined();
	});

	it("list-read-receipts (admin roster) throws FORBIDDEN for a plain member", async () => {
		vi.mocked(getOrganizationMembership).mockResolvedValueOnce(makeMembership("member") as never);
		await expect(
			call(listReadReceiptsProc, { workflowVersionId: "ver_1" }, ctx),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});

	it("list-read-receipts is allowed for an admin", async () => {
		vi.mocked(listVersionReadReceipts).mockResolvedValueOnce([] as never);
		await expect(call(listReadReceiptsProc, { workflowVersionId: "ver_1" }, ctx)).resolves.toBeDefined();
	});
});

describe("workflows reads -- unauthenticated", () => {
	const procs: Array<{ name: string; run: () => Promise<unknown> }> = [
		{ name: "get-workflow", run: () => call(getWorkflowProc, { workflowId: "wf_1" }, ctx) },
		{ name: "get-version-bundle", run: () => call(getVersionBundleProc, { versionId: "ver_1" }, ctx) },
		{ name: "list-workflows", run: () => call(listWorkflowsProc, {}, ctx) },
		{ name: "get-my-read-status", run: () => call(getMyReadStatusProc, { workflowVersionId: "ver_1" }, ctx) },
		{ name: "mark-as-read", run: () => call(markAsReadProc, { workflowVersionId: "ver_1" }, ctx) },
		{ name: "list-read-receipts", run: () => call(listReadReceiptsProc, { workflowVersionId: "ver_1" }, ctx) },
	];

	for (const p of procs) {
		it(`${p.name} throws UNAUTHORIZED with no session`, async () => {
			vi.mocked(auth.api.getSession).mockResolvedValueOnce(null);
			await expect(p.run()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
		});
	}
});
