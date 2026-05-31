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

	it("fails when createDataSetRecord returns no row (recordId null)", async () => {
		vi.mocked(getDataSetByKey).mockResolvedValueOnce({ id: "ds-9", records: [] } as never);
		vi.mocked(createDataSetRecord).mockResolvedValueOnce(null as never);
		const out = await executePlaybookStep(
			step("write_to_data_set", { dataSetKey: "log", label: "entry" }),
			ctx,
		);
		expect(out).toMatchObject({ kind: "action", status: "failed", resultPayload: { recordId: null } });
	});

	it("defaults the record label to 'playbook-record' when none is configured", async () => {
		vi.mocked(getDataSetByKey).mockResolvedValueOnce({ id: "ds-9", records: [] } as never);
		vi.mocked(createDataSetRecord).mockResolvedValueOnce({ id: "rec-1" } as never);
		await executePlaybookStep(step("write_to_data_set", { dataSetKey: "log" }), ctx);
		expect(createDataSetRecord).toHaveBeenCalledWith(
			expect.objectContaining({ label: "playbook-record" }),
		);
	});

	it("fails (missing dataSetKey) when the key is absent", async () => {
		const out = await executePlaybookStep(step("write_to_data_set", { label: "x" }), ctx);
		expect(getDataSetByKey).not.toHaveBeenCalled();
		expect(out).toMatchObject({ kind: "action", status: "failed", resultPayload: { reason: "missing dataSetKey" } });
	});
});

// ---------------------------------------------------------------------------
// Phase 18 hardening (A1) -- config-guard fallbacks, alternate config shapes,
// null-return paths, and the unknown-type default branch.
// ---------------------------------------------------------------------------

describe("config guard (non-object configs fall back to {})", () => {
	it("treats a null config as empty -> wait_for_duration defaults to 1 day", async () => {
		const out = await executePlaybookStep(step("wait_for_duration", null), ctx);
		expect(out).toEqual({ kind: "sleep", durationMs: 86_400_000 });
	});

	it("treats an array config as empty -> wait_for_duration defaults to 1 day", async () => {
		const out = await executePlaybookStep(step("wait_for_duration", [1, 2, 3]), ctx);
		expect(out).toEqual({ kind: "sleep", durationMs: 86_400_000 });
	});

	it("defaults amount=1 / unit=days when wait_for_duration config is empty", async () => {
		const out = await executePlaybookStep(step("wait_for_duration", {}), ctx);
		expect(out).toEqual({ kind: "sleep", durationMs: 86_400_000 });
	});
});

describe("wait_for_event -- empty eventName", () => {
	it("still builds a waitKey (trailing empty segment) when eventName is absent", async () => {
		const out = await executePlaybookStep(step("wait_for_event", {}), ctx);
		expect(out).toMatchObject({
			kind: "waitForEvent",
			waitKey: "org-1:run:ent-1:",
			timeoutDays: 30,
			onTimeout: "continue",
		});
	});

	it("coerces an unrecognised onTimeout value to continue", async () => {
		const out = await executePlaybookStep(
			step("wait_for_event", { eventName: "x", onTimeout: "explode" }),
			ctx,
		);
		expect(out).toMatchObject({ onTimeout: "continue" });
	});
});

describe("launch_workflow -- slug + mode coercion", () => {
	it("launches via workflowSlug when no workflowId is given", async () => {
		vi.mocked(launchRun).mockResolvedValueOnce({ runId: "wfrun-slug" });
		const out = await executePlaybookStep(
			step("launch_workflow", { workflowSlug: "post-stay-review" }),
			ctx,
		);
		expect(launchRun).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ workflowSlug: "post-stay-review", mode: "human" }),
		);
		expect(out).toMatchObject({ launchedRunId: "wfrun-slug" });
	});

	it("coerces an invalid mode to 'human'", async () => {
		vi.mocked(launchRun).mockResolvedValueOnce({ runId: "wfrun-x" });
		await executePlaybookStep(
			step("launch_workflow", { workflowId: "wf-1", mode: "banana" }),
			ctx,
		);
		expect(launchRun).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ mode: "human" }),
		);
	});
});

describe("send_notification -- null insert row", () => {
	it("returns notificationId null when insertNotification yields no row", async () => {
		vi.mocked(insertNotification).mockResolvedValueOnce(null as never);
		const out = await executePlaybookStep(
			step("send_notification", { userId: "u-1" }),
			ctx,
		);
		expect(out).toMatchObject({
			kind: "action",
			status: "completed",
			resultPayload: { notificationId: null },
		});
	});
});

describe("branch_on_data_set -- additional resolution paths", () => {
	it("returns null when branches is empty even though a value resolves", async () => {
		const out = await executePlaybookStep(
			step("branch_on_data_set", { source: "run.status", branches: [] }),
			ctx,
		);
		expect(out).toEqual({ kind: "branch", takenLabel: null });
	});

	it("reads the whole record value when no field is given", async () => {
		vi.mocked(getDataSetByKey).mockResolvedValueOnce({
			id: "ds-1",
			records: [{ id: "r1", label: "tier", value: "gold" }],
		} as never);
		const out = await executePlaybookStep(
			step("branch_on_data_set", {
				dataSetKey: "tiers",
				recordLabel: "tier",
				branches: ["gold", "silver"],
			}),
			ctx,
		);
		expect(out).toEqual({ kind: "branch", takenLabel: "gold" });
	});

	it("returns null when the record label is not found in the data set", async () => {
		vi.mocked(getDataSetByKey).mockResolvedValueOnce({
			id: "ds-1",
			records: [{ id: "r1", label: "other", value: { level: "gold" } }],
		} as never);
		const out = await executePlaybookStep(
			step("branch_on_data_set", {
				dataSetKey: "tiers",
				recordLabel: "missing",
				field: "level",
				branches: ["gold"],
			}),
			ctx,
		);
		expect(out).toEqual({ kind: "branch", takenLabel: null });
	});

	it("stringifies a non-string field value before matching the branch", async () => {
		vi.mocked(getDataSetByKey).mockResolvedValueOnce({
			id: "ds-1",
			records: [{ id: "r1", label: "tier", value: { level: 5 } }],
		} as never);
		const out = await executePlaybookStep(
			step("branch_on_data_set", {
				dataSetKey: "tiers",
				recordLabel: "tier",
				field: "level",
				branches: ["5", "6"],
			}),
			ctx,
		);
		expect(out).toEqual({ kind: "branch", takenLabel: "5" });
	});
});

describe("unknown step type -- default branch", () => {
	it("returns a failed action describing the unknown type", async () => {
		const out = await executePlaybookStep(
			step("totally_bogus" as PlaybookStepExecInput["type"], {}),
			ctx,
		);
		expect(out).toMatchObject({ kind: "action", status: "failed" });
		const payload = (out as { resultPayload: Record<string, unknown> }).resultPayload;
		expect(String(payload.error)).toContain("Unknown step type");
	});
});
