// Phase 18 hardening (A3) -- lib-level tests for launchPlaybookManual /
// cancelPlaybookRunOp. The procedure-level authz test (playbook-runs-authz.test.ts)
// pins the gate + the typed-refusal -> ORPCError mapping; this file pins the
// internals the procedure test doesn't see: entity-context stamping, the
// intentional is_active override, the trigger-payload + audit shape, and the
// "no side effect on a refusal" invariants. Mocks @virn/database + the inngest client.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../inngest/client", () => ({ inngest: { send: vi.fn() } }));

vi.mock("@virn/database", () => ({
	getPlaybookForOrg: vi.fn(),
	getLatestPublishedPlaybookVersion: vi.fn(),
	insertPlaybookRun: vi.fn(),
	getPlaybookRunForOrg: vi.fn(),
	cancelPlaybookRun: vi.fn(),
	writeAuditAndActivity: vi.fn(),
}));

import {
	cancelPlaybookRun,
	getLatestPublishedPlaybookVersion,
	getPlaybookForOrg,
	getPlaybookRunForOrg,
	insertPlaybookRun,
	writeAuditAndActivity,
} from "@virn/database";

import { inngest } from "../../../inngest/client";
import { cancelPlaybookRunOp, launchPlaybookManual } from "./run-control";

const ctx = { organizationId: "org-1", userId: "user-1" };

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(insertPlaybookRun).mockResolvedValue({ run: { id: "pbrun-1" }, created: true } as never);
	vi.mocked(writeAuditAndActivity).mockResolvedValue(undefined as never);
	vi.mocked(inngest.send).mockResolvedValue(undefined as never);
});

describe("launchPlaybookManual", () => {
	it("stamps the entity context onto the run + trigger payload and kicks the orchestrator", async () => {
		vi.mocked(getPlaybookForOrg).mockResolvedValueOnce({ id: "pb-1" } as never);
		vi.mocked(getLatestPublishedPlaybookVersion).mockResolvedValueOnce({ id: "ver-1" } as never);

		const res = await launchPlaybookManual(ctx, {
			playbookId: "pb-1",
			entityContext: { entityType: "listing", entityId: "lst-9" },
		});

		expect(res).toEqual({ playbookRunId: "pbrun-1" });
		expect(insertPlaybookRun).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: "org-1",
				playbookVersionId: "ver-1",
				triggerEntityType: "listing",
				triggerEntityId: "lst-9",
				triggerPayload: expect.objectContaining({
					source: "manual",
					launchedByUserId: "user-1",
					entity: { entityType: "listing", entityId: "lst-9" },
				}),
				crossProductOrigin: null,
			}),
		);
		expect(inngest.send).toHaveBeenCalledWith(
			expect.objectContaining({
				name: "playbook/run.start",
				data: { playbookRunId: "pbrun-1", organizationId: "org-1" },
			}),
		);
		expect(writeAuditAndActivity).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "playbook_run.launched",
				entityType: "playbook_run",
				entityId: "pbrun-1",
				metadata: expect.objectContaining({ source: "manual" }),
			}),
		);
	});

	it("stamps null entity context when none is supplied", async () => {
		vi.mocked(getPlaybookForOrg).mockResolvedValueOnce({ id: "pb-1" } as never);
		vi.mocked(getLatestPublishedPlaybookVersion).mockResolvedValueOnce({ id: "ver-1" } as never);

		await launchPlaybookManual(ctx, { playbookId: "pb-1" });

		expect(insertPlaybookRun).toHaveBeenCalledWith(
			expect.objectContaining({
				triggerEntityType: null,
				triggerEntityId: null,
				triggerPayload: expect.objectContaining({ entity: null }),
			}),
		);
	});

	it("ignores is_active -- an inactive playbook still launches (intentional operator override)", async () => {
		// A manual launch never reads is_active; an inactive playbook must still run.
		vi.mocked(getPlaybookForOrg).mockResolvedValueOnce({ id: "pb-1", isActive: false } as never);
		vi.mocked(getLatestPublishedPlaybookVersion).mockResolvedValueOnce({ id: "ver-1" } as never);

		const res = await launchPlaybookManual(ctx, { playbookId: "pb-1" });

		expect(res).toEqual({ playbookRunId: "pbrun-1" });
		expect(insertPlaybookRun).toHaveBeenCalledTimes(1);
		expect(inngest.send).toHaveBeenCalledTimes(1);
	});

	it("refuses PLAYBOOK_NOT_FOUND and performs no writes", async () => {
		vi.mocked(getPlaybookForOrg).mockResolvedValueOnce(null as never);
		await expect(
			launchPlaybookManual(ctx, { playbookId: "pb-x" }),
		).rejects.toMatchObject({ code: "PLAYBOOK_NOT_FOUND" });
		expect(getLatestPublishedPlaybookVersion).not.toHaveBeenCalled();
		expect(insertPlaybookRun).not.toHaveBeenCalled();
		expect(inngest.send).not.toHaveBeenCalled();
	});

	it("refuses PLAYBOOK_NOT_PUBLISHED and performs no writes", async () => {
		vi.mocked(getPlaybookForOrg).mockResolvedValueOnce({ id: "pb-1" } as never);
		vi.mocked(getLatestPublishedPlaybookVersion).mockResolvedValueOnce(null as never);
		await expect(
			launchPlaybookManual(ctx, { playbookId: "pb-1" }),
		).rejects.toMatchObject({ code: "PLAYBOOK_NOT_PUBLISHED" });
		expect(insertPlaybookRun).not.toHaveBeenCalled();
		expect(inngest.send).not.toHaveBeenCalled();
	});
});

describe("cancelPlaybookRunOp", () => {
	it("cancels a live run with attribution and writes an audit row", async () => {
		vi.mocked(getPlaybookRunForOrg).mockResolvedValueOnce({ id: "pbrun-1", status: "active" } as never);
		vi.mocked(cancelPlaybookRun).mockResolvedValueOnce(true);

		const res = await cancelPlaybookRunOp(ctx, { runId: "pbrun-1" });

		expect(res).toEqual({ cancelled: true });
		expect(cancelPlaybookRun).toHaveBeenCalledWith({
			runId: "pbrun-1",
			organizationId: "org-1",
			cancelledByUserId: "user-1",
		});
		expect(writeAuditAndActivity).toHaveBeenCalledWith(
			expect.objectContaining({ action: "playbook_run.cancelled", entityId: "pbrun-1" }),
		);
	});

	it("refuses PLAYBOOK_RUN_NOT_FOUND before attempting a cancel", async () => {
		vi.mocked(getPlaybookRunForOrg).mockResolvedValueOnce(null as never);
		await expect(
			cancelPlaybookRunOp(ctx, { runId: "nope" }),
		).rejects.toMatchObject({ code: "PLAYBOOK_RUN_NOT_FOUND" });
		expect(cancelPlaybookRun).not.toHaveBeenCalled();
		expect(writeAuditAndActivity).not.toHaveBeenCalled();
	});

	it("refuses PLAYBOOK_RUN_NOT_CANCELLABLE on a terminal run and writes no audit", async () => {
		vi.mocked(getPlaybookRunForOrg).mockResolvedValueOnce({ id: "pbrun-1", status: "completed" } as never);
		vi.mocked(cancelPlaybookRun).mockResolvedValueOnce(false);
		await expect(
			cancelPlaybookRunOp(ctx, { runId: "pbrun-1" }),
		).rejects.toMatchObject({ code: "PLAYBOOK_RUN_NOT_CANCELLABLE" });
		expect(writeAuditAndActivity).not.toHaveBeenCalled();
	});
});
