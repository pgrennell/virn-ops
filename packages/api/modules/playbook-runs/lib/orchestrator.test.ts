// Phase 18b -- unit tests for the PURE step executor. The durable Inngest wrapper
// (functions/playbook-orchestrator.ts) is Dev-Server-verified; this file pins the
// per-step decision logic for all six step types (mock @virn/database + launchRun).

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@virn/database", () => ({
	getDataSetByKey: vi.fn(),
	createDataSetRecord: vi.fn(),
	insertNotification: vi.fn(),
}));

vi.mock("../../runs/lib/launch-run", () => ({
	launchRun: vi.fn(),
}));

import {
	createDataSetRecord,
	getDataSetByKey,
	insertNotification,
} from "@virn/database";
import { launchRun } from "../../runs/lib/launch-run";

import {
	durationToMs,
	executePlaybookStep,
	type PlaybookStepExecCtx,
	type PlaybookStepExecInput,
} from "./orchestrator";

const ctx: PlaybookStepExecCtx = {
	organizationId: "org-1",
	crossProductOrigin: null,
	run: {
		id: "pbrun-1",
		triggerEntityType: "run",
		triggerEntityId: "ent-1",
		triggerPayload: { run: { status: "completed" } },
	},
};

function step(
	type: PlaybookStepExecInput["type"],
	config: unknown,
	overrides: Partial<PlaybookStepExecInput> = {},
): PlaybookStepExecInput {
	return {
		id: "step-1",
		type,
		config,
		position: 0,
		branchLabel: null,
		parentStepId: null,
		...overrides,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("durationToMs", () => {
	it("converts units, defaults unknown to days, clamps negatives", () => {
		expect(durationToMs(2, "hours")).toBe(2 * 3_600_000);
		expect(durationToMs(1, "weeks")).toBe(604_800_000);
		expect(durationToMs(3, "fortnights")).toBe(3 * 86_400_000);
		expect(durationToMs(-5, "days")).toBe(0);
	});
});

describe("wait_for_duration", () => {
	it("returns a sleep directive from amount + unit", async () => {
		const out = await executePlaybookStep(
			step("wait_for_duration", { amount: 3, unit: "hours" }),
			ctx,
		);
		expect(out).toEqual({ kind: "sleep", durationMs: 3 * 3_600_000 });
	});
});

describe("wait_for_event", () => {
	it("builds a waitKey scoped by org+entity and carries timeout/onTimeout", async () => {
		const out = await executePlaybookStep(
			step("wait_for_event", {
				eventName: "approved",
				timeoutDays: 5,
				onTimeout: "abort",
			}),
			ctx,
		);
		expect(out).toEqual({
			kind: "waitForEvent",
			waitKey: "org-1:run:ent-1:approved",
			timeoutDays: 5,
			onTimeout: "abort",
		});
	});

	it("defaults onTimeout to continue + timeout to 30 days", async () => {
		const out = await executePlaybookStep(
			step("wait_for_event", { eventName: "x" }),
			ctx,
		);
		expect(out).toMatchObject({ timeoutDays: 30, onTimeout: "continue" });
	});
});

describe("launch_workflow", () => {
	it("calls launchRun and returns the launched run id", async () => {
		vi.mocked(launchRun).mockResolvedValueOnce({ runId: "wfrun-9" });
		const out = await executePlaybookStep(
			step("launch_workflow", { workflowId: "wf-1", mode: "automated" }),
			ctx,
		);
		expect(launchRun).toHaveBeenCalledWith(
			{ organizationId: "org-1", crossProductOrigin: null },
			expect.objectContaining({ workflowId: "wf-1", mode: "automated", roleAssignments: [] }),
		);
		expect(out).toEqual({
			kind: "action",
			status: "completed",
			resultPayload: { launchedRunId: "wfrun-9" },
			launchedRunId: "wfrun-9",
		});
	});

	it("throws when neither workflowId nor workflowSlug is configured", async () => {
		await expect(
			executePlaybookStep(step("launch_workflow", {}), ctx),
		).rejects.toThrow(/missing workflowId/);
	});
});

describe("send_notification", () => {
	it("inserts a notification for an explicit recipient", async () => {
		vi.mocked(insertNotification).mockResolvedValueOnce({ id: "notif-1" } as never);
		const out = await executePlaybookStep(
			step("send_notification", { userId: "u-1", type: "ACKNOWLEDGMENT_DUE" }),
			ctx,
		);
		expect(insertNotification).toHaveBeenCalledWith(
			expect.objectContaining({ userId: "u-1", type: "ACKNOWLEDGMENT_DUE", read: false }),
		);
		expect(out).toEqual({
			kind: "action",
			status: "completed",
			resultPayload: { notificationId: "notif-1" },
		});
	});

	it("skips (no DB write) when no recipient is resolved", async () => {
		const out = await executePlaybookStep(step("send_notification", {}), ctx);
		expect(insertNotification).not.toHaveBeenCalled();
		expect(out).toMatchObject({
			kind: "action",
			status: "completed",
			resultPayload: { skipped: true },
		});
	});
});

describe("branch_on_data_set", () => {
	it("selects the branch matching a trigger-payload dot-path value", async () => {
		const out = await executePlaybookStep(
			step("branch_on_data_set", {
				source: "run.status",
				branches: ["completed", "failed"],
			}),
			ctx,
		);
		expect(out).toEqual({ kind: "branch", takenLabel: "completed" });
	});

	it("returns null when nothing matches", async () => {
		const out = await executePlaybookStep(
			step("branch_on_data_set", { source: "run.status", branches: ["failed"] }),
			ctx,
		);
		expect(out).toEqual({ kind: "branch", takenLabel: null });
	});

	it("reads a data-set record field when dataSetKey is given", async () => {
		vi.mocked(getDataSetByKey).mockResolvedValueOnce({
			id: "ds-1",
			records: [{ id: "r1", label: "tier", value: { level: "gold" } }],
		} as never);
		const out = await executePlaybookStep(
			step("branch_on_data_set", {
				dataSetKey: "tiers",
				recordLabel: "tier",
				field: "level",
				branches: ["gold", "silver"],
			}),
			ctx,
		);
		expect(getDataSetByKey).toHaveBeenCalledWith("org-1", "tiers");
		expect(out).toEqual({ kind: "branch", takenLabel: "gold" });
	});
});

describe("write_to_data_set", () => {
	it("creates a record in the resolved data set", async () => {
		vi.mocked(getDataSetByKey).mockResolvedValueOnce({ id: "ds-9", records: [] } as never);
		vi.mocked(createDataSetRecord).mockResolvedValueOnce({ id: "rec-9" } as never);
		const out = await executePlaybookStep(
			step("write_to_data_set", { dataSetKey: "log", label: "entry", value: { ok: true } }),
			ctx,
		);
		expect(createDataSetRecord).toHaveBeenCalledWith({
			organizationId: "org-1",
			dataSetId: "ds-9",
			label: "entry",
			value: { ok: true },
		});
		expect(out).toEqual({
			kind: "action",
			status: "completed",
			resultPayload: { recordId: "rec-9" },
		});
	});

	it("fails when the data set key resolves to nothing", async () => {
		vi.mocked(getDataSetByKey).mockResolvedValueOnce(null as never);
		const out = await executePlaybookStep(
			step("write_to_data_set", { dataSetKey: "missing", label: "x" }),
			ctx,
		);
		expect(createDataSetRecord).not.toHaveBeenCalled();
		expect(out).toMatchObject({ kind: "action", status: "failed" });
	});
});
