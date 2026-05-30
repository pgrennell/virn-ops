// Phase 16 (Slice D) -- reattestation sweep tests. DB mocked at the
// @virn/database boundary; verifies selection + advance race-loss handling
// + audit emission shape.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@virn/database", () => ({
	findWorkflowsDueForReattestation: vi.fn(),
	advanceWorkflowNextReviewAt: vi.fn(),
	writeAuditAndActivity: vi.fn(),
}));

import {
	advanceWorkflowNextReviewAt,
	findWorkflowsDueForReattestation,
	writeAuditAndActivity,
} from "@virn/database";

import { runReattestationSweep } from "./reattestation-sweep";

const NOW = new Date("2026-06-01T12:00:00Z");

function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
	return {
		id: "wf_1",
		organizationId: "org_1",
		title: "STR Turnover",
		reviewIntervalDays: 30,
		nextReviewAt: new Date("2026-05-30T12:00:00Z"),
		...overrides,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(advanceWorkflowNextReviewAt).mockResolvedValue(true);
	vi.mocked(writeAuditAndActivity).mockResolvedValue(undefined);
});

describe("runReattestationSweep -- selection + iteration", () => {
	it("returns scanned=0, advanced=0 when no candidates", async () => {
		vi.mocked(findWorkflowsDueForReattestation).mockResolvedValueOnce([]);
		const result = await runReattestationSweep({
			organizationId: "org_1",
			actorUserId: null,
			now: NOW,
		});

		expect(result.scanned).toBe(0);
		expect(result.advanced).toBe(0);
		expect(writeAuditAndActivity).not.toHaveBeenCalled();
	});

	it("advances each candidate once and emits one audit/activity each", async () => {
		const rows = [
			makeRow({ id: "wf_a", title: "A" }),
			makeRow({ id: "wf_b", title: "B" }),
		];
		vi.mocked(findWorkflowsDueForReattestation).mockResolvedValueOnce(rows as never);

		const result = await runReattestationSweep({
			organizationId: "org_1",
			actorUserId: null,
			now: NOW,
		});

		expect(result.scanned).toBe(2);
		expect(result.advanced).toBe(2);
		expect(advanceWorkflowNextReviewAt).toHaveBeenCalledTimes(2);
		expect(writeAuditAndActivity).toHaveBeenCalledTimes(2);
		expect(writeAuditAndActivity).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "workflow.reattestation_due",
				entityType: "workflow",
			}),
		);
	});

	it("computes newNextReviewAt = previous + intervalDays (cycle-grid alignment)", async () => {
		vi.mocked(findWorkflowsDueForReattestation).mockResolvedValueOnce([
			makeRow({
				nextReviewAt: new Date("2026-05-30T12:00:00Z"),
				reviewIntervalDays: 7,
			}) as never,
		]);

		await runReattestationSweep({
			organizationId: null,
			actorUserId: null,
			now: NOW,
		});

		// 2026-05-30 + 7d = 2026-06-06
		expect(advanceWorkflowNextReviewAt).toHaveBeenCalledWith({
			workflowId: "wf_1",
			previousNextReviewAt: new Date("2026-05-30T12:00:00Z"),
			newNextReviewAt: new Date("2026-06-06T12:00:00Z"),
		});
	});

	it("skips audit emission when concurrent sweep already advanced (WHERE-previous lost the race)", async () => {
		vi.mocked(findWorkflowsDueForReattestation).mockResolvedValueOnce([
			makeRow() as never,
		]);
		vi.mocked(advanceWorkflowNextReviewAt).mockResolvedValueOnce(false);

		const result = await runReattestationSweep({
			organizationId: "org_1",
			actorUserId: null,
			now: NOW,
		});

		expect(result.scanned).toBe(1);
		expect(result.advanced).toBe(0);
		expect(writeAuditAndActivity).not.toHaveBeenCalled();
	});

	it("per-row failures don't abort the sweep -- count diverges from scanned", async () => {
		vi.mocked(findWorkflowsDueForReattestation).mockResolvedValueOnce([
			makeRow({ id: "wf_a" }) as never,
			makeRow({ id: "wf_b" }) as never,
		]);
		vi.mocked(advanceWorkflowNextReviewAt)
			.mockResolvedValueOnce(true)
			.mockRejectedValueOnce(new Error("DB blip"));

		const result = await runReattestationSweep({
			organizationId: "org_1",
			actorUserId: null,
			now: NOW,
		});

		expect(result.scanned).toBe(2);
		expect(result.advanced).toBe(1);
	});
});

describe("runReattestationSweep -- audit metadata", () => {
	it("tags scheduled vs manual via metadata.source", async () => {
		vi.mocked(findWorkflowsDueForReattestation).mockResolvedValueOnce([
			makeRow() as never,
		]);

		await runReattestationSweep({
			organizationId: "org_1",
			actorUserId: "user_admin",
			now: NOW,
		});

		expect(writeAuditAndActivity).toHaveBeenCalledWith(
			expect.objectContaining({
				metadata: { source: "manual_admin_sweep" },
			}),
		);

		vi.mocked(writeAuditAndActivity).mockClear();
		vi.mocked(findWorkflowsDueForReattestation).mockResolvedValueOnce([
			makeRow() as never,
		]);
		vi.mocked(advanceWorkflowNextReviewAt).mockResolvedValueOnce(true);

		await runReattestationSweep({
			organizationId: null,
			actorUserId: null,
			now: NOW,
		});

		expect(writeAuditAndActivity).toHaveBeenCalledWith(
			expect.objectContaining({
				metadata: { source: "scheduled_reattestation_sweep" },
			}),
		);
	});
});
