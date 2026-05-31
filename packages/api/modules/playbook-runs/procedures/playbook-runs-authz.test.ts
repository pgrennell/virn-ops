// Phase 18b -- procedure-level tests for the playbook-run control surface
// (launchManual + cancel). Unlike the authoring procedures (admin-only), these
// are operator-initiated: any authenticated org member may run/cancel, but an
// unauthenticated caller is rejected and the typed refusals map correctly.
// Mirrors datasets.test.ts: mock @virn/auth + @virn/database + the inngest client.

import { call } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@virn/auth", () => ({
	auth: { api: { getSession: vi.fn() } },
}));

vi.mock("../../../inngest/client", () => ({
	inngest: { send: vi.fn() },
}));

vi.mock("@virn/database", () => ({
	getOrganizationMembership: vi.fn(),
	getPlaybookForOrg: vi.fn(),
	getLatestPublishedPlaybookVersion: vi.fn(),
	insertPlaybookRun: vi.fn(),
	getPlaybookRunForOrg: vi.fn(),
	cancelPlaybookRun: vi.fn(),
	writeAuditAndActivity: vi.fn(),
}));

import { auth } from "@virn/auth";
import {
	cancelPlaybookRun,
	getLatestPublishedPlaybookVersion,
	getOrganizationMembership,
	getPlaybookForOrg,
	getPlaybookRunForOrg,
	insertPlaybookRun,
} from "@virn/database";

import { inngest } from "../../../inngest/client";
import { cancelPlaybookRunProc } from "./cancel";
import { launchPlaybookManualProc } from "./launch-manual";

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

function makeMembership(role: "owner" | "admin" | "member" = "member") {
	return { organization: { id: "org-1", name: "Org", slug: "org" }, role };
}

describe("playbook-runs control -- auth + refusals", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(auth.api.getSession).mockResolvedValue(makeSession() as never);
		vi.mocked(getOrganizationMembership).mockResolvedValue(makeMembership() as never);
	});

	it("launchManual throws UNAUTHORIZED with no session", async () => {
		vi.mocked(auth.api.getSession).mockResolvedValueOnce(null);
		await expect(
			call(launchPlaybookManualProc, { playbookId: "pb-1" }, reqCtx),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });
	});

	it("launchManual is allowed for a plain member and kicks the orchestrator", async () => {
		vi.mocked(getPlaybookForOrg).mockResolvedValueOnce({ id: "pb-1" } as never);
		vi.mocked(getLatestPublishedPlaybookVersion).mockResolvedValueOnce({ id: "ver-1" } as never);
		vi.mocked(insertPlaybookRun).mockResolvedValueOnce({
			run: { id: "pbrun-1" },
			created: true,
		} as never);

		const res = await call(launchPlaybookManualProc, { playbookId: "pb-1" }, reqCtx);
		expect(res).toEqual({ playbookRunId: "pbrun-1" });
		expect(inngest.send).toHaveBeenCalledWith(
			expect.objectContaining({
				name: "playbook/run.start",
				data: expect.objectContaining({ playbookRunId: "pbrun-1" }),
			}),
		);
	});

	it("launchManual refuses PLAYBOOK_NOT_PUBLISHED (no orchestrator kick)", async () => {
		vi.mocked(getPlaybookForOrg).mockResolvedValueOnce({ id: "pb-1" } as never);
		vi.mocked(getLatestPublishedPlaybookVersion).mockResolvedValueOnce(null as never);
		await expect(
			call(launchPlaybookManualProc, { playbookId: "pb-1" }, reqCtx),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
			data: expect.objectContaining({ code: "PLAYBOOK_NOT_PUBLISHED" }),
		});
		expect(inngest.send).not.toHaveBeenCalled();
	});

	it("launchManual refuses PLAYBOOK_NOT_FOUND for a cross-org playbook", async () => {
		vi.mocked(getPlaybookForOrg).mockResolvedValueOnce(null as never);
		await expect(
			call(launchPlaybookManualProc, { playbookId: "pb-x" }, reqCtx),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("cancel is allowed for a member and cancels a live run", async () => {
		vi.mocked(getPlaybookRunForOrg).mockResolvedValueOnce({
			id: "pbrun-1",
			status: "active",
		} as never);
		vi.mocked(cancelPlaybookRun).mockResolvedValueOnce(true);
		const res = await call(cancelPlaybookRunProc, { runId: "pbrun-1" }, reqCtx);
		expect(res).toEqual({ cancelled: true });
	});

	it("cancel refuses PLAYBOOK_RUN_NOT_CANCELLABLE on a terminal run", async () => {
		vi.mocked(getPlaybookRunForOrg).mockResolvedValueOnce({
			id: "pbrun-1",
			status: "completed",
		} as never);
		vi.mocked(cancelPlaybookRun).mockResolvedValueOnce(false);
		await expect(
			call(cancelPlaybookRunProc, { runId: "pbrun-1" }, reqCtx),
		).rejects.toMatchObject({
			code: "CONFLICT",
			data: expect.objectContaining({ code: "PLAYBOOK_RUN_NOT_CANCELLABLE" }),
		});
	});

	it("cancel refuses PLAYBOOK_RUN_NOT_FOUND for an unknown run", async () => {
		vi.mocked(getPlaybookRunForOrg).mockResolvedValueOnce(null as never);
		await expect(
			call(cancelPlaybookRunProc, { runId: "nope" }, reqCtx),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});
