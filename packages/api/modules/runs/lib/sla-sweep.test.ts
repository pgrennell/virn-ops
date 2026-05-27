// packages/api/modules/runs/lib/sla-sweep.test.ts
//
// Lib-level unit tests for runSlaSweep. Database is mocked at the @virn/database
// boundary; these verify selection + iteration + audit-emission semantics, not the
// SQL antijoin (which is integration-test territory).

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@virn/database", () => ({
	findOverdueRunsToEscalate: vi.fn(),
	writeAuditAndActivity: vi.fn(),
}));

import { findOverdueRunsToEscalate, writeAuditAndActivity } from "@virn/database";

import { runSlaSweep } from "./sla-sweep";

const NOW = new Date("2026-06-01T12:00:00Z");

function makeRun(overrides: Partial<Record<string, unknown>> = {}) {
	return {
		id: "run_1",
		organizationId: "org_1",
		title: "Pest Control Work Order",
		workflowId: "wf_1",
		dueAt: new Date("2026-05-30T12:00:00Z"), // 2 days overdue
		startedAt: new Date("2026-05-28T12:00:00Z"),
		createdBy: "user_1",
		...overrides,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(writeAuditAndActivity).mockResolvedValue(undefined);
});

describe("runSlaSweep -- selection + iteration", () => {
	it("returns scanned=0, escalated=0 when no candidates", async () => {
		vi.mocked(findOverdueRunsToEscalate).mockResolvedValueOnce([]);

		const result = await runSlaSweep({
			organizationId: "org_1",
			actorUserId: "user_1",
			now: NOW,
		});

		expect(result.scanned).toBe(0);
		expect(result.escalated).toBe(0);
		expect(result.runs).toEqual([]);
		expect(writeAuditAndActivity).not.toHaveBeenCalled();
	});

	it("escalates every candidate exactly once and emits one audit/activity row each", async () => {
		const rows = [
			makeRun({ id: "run_a", title: "A" }),
			makeRun({ id: "run_b", title: "B" }),
			makeRun({ id: "run_c", title: "C" }),
		];
		vi.mocked(findOverdueRunsToEscalate).mockResolvedValueOnce(rows as never);

		const result = await runSlaSweep({
			organizationId: "org_1",
			actorUserId: "user_1",
			now: NOW,
		});

		expect(result.scanned).toBe(3);
		expect(result.escalated).toBe(3);
		expect(writeAuditAndActivity).toHaveBeenCalledTimes(3);
		// Each call writes action='run.escalated' + the right entityId.
		const calls = vi.mocked(writeAuditAndActivity).mock.calls;
		expect(calls.map((c) => c[0].action)).toEqual([
			"run.escalated",
			"run.escalated",
			"run.escalated",
		]);
		expect(calls.map((c) => c[0].entityId).sort()).toEqual(["run_a", "run_b", "run_c"]);
	});

	it("passes organizationId=null through to the platform-wide query (Vercel Cron path)", async () => {
		vi.mocked(findOverdueRunsToEscalate).mockResolvedValueOnce([]);

		await runSlaSweep({
			organizationId: null,
			actorUserId: null,
			now: NOW,
		});

		expect(findOverdueRunsToEscalate).toHaveBeenCalledWith(null, NOW);
	});

	it("passes a specific organizationId for the admin-button (org-scoped) path", async () => {
		vi.mocked(findOverdueRunsToEscalate).mockResolvedValueOnce([]);

		await runSlaSweep({
			organizationId: "org_1",
			actorUserId: "user_1",
			now: NOW,
		});

		expect(findOverdueRunsToEscalate).toHaveBeenCalledWith("org_1", NOW);
	});
});

describe("runSlaSweep -- audit row shape", () => {
	it("records previousDueAt + overdueByMs + workflowId in changes", async () => {
		const row = makeRun({
			dueAt: new Date("2026-05-30T12:00:00Z"), // exactly 2 days before NOW
		});
		vi.mocked(findOverdueRunsToEscalate).mockResolvedValueOnce([row] as never);

		await runSlaSweep({
			organizationId: "org_1",
			actorUserId: "user_1",
			now: NOW,
		});

		const [auditCall] = vi.mocked(writeAuditAndActivity).mock.calls;
		expect(auditCall[0]).toMatchObject({
			action: "run.escalated",
			verb: "escalated",
			entityType: "run",
			entityId: "run_1",
			changes: expect.objectContaining({
				previousDueAt: "2026-05-30T12:00:00.000Z",
				workflowId: "wf_1",
				// 2 days in ms.
				overdueByMs: 2 * 24 * 60 * 60 * 1000,
			}),
		});
	});

	it("metadata.source identifies which trigger fired the sweep", async () => {
		const row = makeRun();
		vi.mocked(findOverdueRunsToEscalate).mockResolvedValueOnce([row] as never);

		await runSlaSweep({
			organizationId: "org_1",
			actorUserId: "user_admin", // admin button path
			now: NOW,
		});

		const [adminCall] = vi.mocked(writeAuditAndActivity).mock.calls;
		expect(adminCall[0].metadata).toMatchObject({ source: "manual_admin_sweep" });

		vi.clearAllMocks();
		vi.mocked(findOverdueRunsToEscalate).mockResolvedValueOnce([row] as never);

		await runSlaSweep({
			organizationId: null,
			actorUserId: null, // Vercel Cron path
			now: NOW,
		});

		const [cronCall] = vi.mocked(writeAuditAndActivity).mock.calls;
		expect(cronCall[0].metadata).toMatchObject({ source: "scheduled_sla_sweep" });
	});

	it("activityData carries the run title + overdueByHours for the timeline", async () => {
		const row = makeRun({
			title: "Pest Control Work Order",
			dueAt: new Date("2026-05-30T12:00:00Z"), // 48h before NOW
		});
		vi.mocked(findOverdueRunsToEscalate).mockResolvedValueOnce([row] as never);

		await runSlaSweep({
			organizationId: "org_1",
			actorUserId: "user_1",
			now: NOW,
		});

		const [call] = vi.mocked(writeAuditAndActivity).mock.calls;
		expect(call[0].activityData).toMatchObject({
			runTitle: "Pest Control Work Order",
			overdueByHours: 48,
		});
	});
});

describe("runSlaSweep -- failure isolation", () => {
	it("a single audit-write failure does NOT abort the sweep; other runs still escalate", async () => {
		const rows = [
			makeRun({ id: "run_ok_1" }),
			makeRun({ id: "run_failing" }),
			makeRun({ id: "run_ok_2" }),
		];
		vi.mocked(findOverdueRunsToEscalate).mockResolvedValueOnce(rows as never);
		vi.mocked(writeAuditAndActivity)
			.mockResolvedValueOnce(undefined)
			.mockRejectedValueOnce(new Error("transient db error"))
			.mockResolvedValueOnce(undefined);

		const result = await runSlaSweep({
			organizationId: "org_1",
			actorUserId: "user_1",
			now: NOW,
		});

		expect(result.scanned).toBe(3);
		expect(result.escalated).toBe(2); // diverged from scanned by exactly the failure
		expect(result.runs.map((r) => r.runId).sort()).toEqual(["run_ok_1", "run_ok_2"]);
	});
});
