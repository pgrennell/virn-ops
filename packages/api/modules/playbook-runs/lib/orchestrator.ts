// packages/api/modules/playbook-runs/lib/orchestrator.ts
//
// Phase 18b -- the PURE per-step executor for Playbook runs. Given a single
// playbook_step + run context, it performs the step's side effect (or computes a
// wait directive) and returns a typed StepOutcome. The DURABLE control flow
// (looping, step.sleep / step.waitForEvent, persistence) lives in the Inngest
// function (inngest/functions/playbook-orchestrator.ts) -- keeping the decision
// logic here means it unit-tests without an Inngest harness (mock @virn/database
// + launchRun and assert the outcome per step type).
//
// v1 step-type fidelity (config shapes are jsonb; the authoring UI sends them):
//   wait_for_duration  { amount:int, unit:'minutes'|'hours'|'days'|'weeks' }
//   wait_for_event     { eventName, timeoutDays?=30, onTimeout?='continue'|'abort' }
//   launch_workflow    { workflowId|workflowSlug, kickoffValues?, mode? } -> launchRun
//   send_notification  { userId, type, link?, data? } -> insertNotification
//                      (audience resolution beyond an explicit userId is a follow-up)
//   branch_on_data_set { dataSetKey, recordLabel, field?, branches:string[] }  (or
//                      { source:<dot-path into triggerPayload>, branches }) -> takenLabel
//   write_to_data_set  { dataSetKey, label, value? } -> createDataSetRecord

import {
	createDataSetRecord,
	getDataSetByKey,
	insertNotification,
	type NotificationType,
	type PlaybookRunCore,
	type PlaybookStepRow,
} from "@virn/database";

import { launchRun, type LaunchMode } from "../../runs/lib/launch-run";
import { buildWaitKey } from "../../../inngest/events";

export interface PlaybookStepExecCtx {
	organizationId: string;
	crossProductOrigin: string | null;
	run: Pick<
		PlaybookRunCore,
		"id" | "triggerEntityType" | "triggerEntityId" | "triggerPayload"
	>;
}

/** The step fields the executor actually reads. A Date-free subset of
 * PlaybookStepRow so it accepts both a DB row and an Inngest step.run result
 * (which JSON-serializes Dates to strings). */
export type PlaybookStepExecInput = Pick<
	PlaybookStepRow,
	"id" | "type" | "config" | "position" | "branchLabel" | "parentStepId"
>;

/** What a single step "decided". Wait directives carry no side effect (the
 * durable wrapper applies them); action/branch outcomes have already run. */
export type StepOutcome =
	| { kind: "sleep"; durationMs: number }
	| {
			kind: "waitForEvent";
			waitKey: string;
			timeoutDays: number;
			onTimeout: "continue" | "abort";
	  }
	| { kind: "branch"; takenLabel: string | null }
	| {
			kind: "action";
			status: "completed" | "failed";
			resultPayload: Record<string, unknown>;
			launchedRunId?: string | null;
	  };

export async function executePlaybookStep(
	step: PlaybookStepExecInput,
	ctx: PlaybookStepExecCtx,
): Promise<StepOutcome> {
	const cfg =
		step.config && typeof step.config === "object" && !Array.isArray(step.config)
			? (step.config as Record<string, unknown>)
			: {};

	switch (step.type) {
		case "wait_for_duration":
			return {
				kind: "sleep",
				durationMs: durationToMs(num(cfg.amount, 1), str(cfg.unit, "days")),
			};

		case "wait_for_event":
			return {
				kind: "waitForEvent",
				waitKey: buildWaitKey({
					organizationId: ctx.organizationId,
					entityType: ctx.run.triggerEntityType,
					entityId: ctx.run.triggerEntityId,
					eventName: str(cfg.eventName, ""),
				}),
				timeoutDays: num(cfg.timeoutDays, 30),
				onTimeout: str(cfg.onTimeout, "continue") === "abort" ? "abort" : "continue",
			};

		case "branch_on_data_set":
			return { kind: "branch", takenLabel: await evaluateBranch(cfg, ctx) };

		case "launch_workflow": {
			const { runId } = await runLaunchWorkflow(cfg, ctx);
			return {
				kind: "action",
				status: "completed",
				resultPayload: { launchedRunId: runId },
				launchedRunId: runId,
			};
		}

		case "send_notification":
			return {
				kind: "action",
				status: "completed",
				resultPayload: await runSendNotification(cfg),
			};

		case "write_to_data_set": {
			const result = await runWriteToDataSet(cfg, ctx);
			return {
				kind: "action",
				status: result.recordId ? "completed" : "failed",
				resultPayload: result,
			};
		}

		default: {
			const exhaustive: never = step.type;
			return {
				kind: "action",
				status: "failed",
				resultPayload: { error: `Unknown step type: ${String(exhaustive)}` },
			};
		}
	}
}

// ---------------------------------------------------------------------------
// Per-type effect runners
// ---------------------------------------------------------------------------

async function runLaunchWorkflow(
	cfg: Record<string, unknown>,
	ctx: PlaybookStepExecCtx,
): Promise<{ runId: string }> {
	const workflowId = optStr(cfg.workflowId);
	const workflowSlug = optStr(cfg.workflowSlug);
	if (!workflowId && !workflowSlug) {
		throw new Error("launch_workflow step config missing workflowId / workflowSlug");
	}
	const mode = str(cfg.mode, "human");
	return launchRun(
		{
			organizationId: ctx.organizationId,
			crossProductOrigin: ctx.crossProductOrigin,
		},
		{
			workflowId,
			workflowSlug,
			kickoffValues: asObject(cfg.kickoffValues),
			roleAssignments: [],
			mode: (["human", "ai_assisted", "automated"].includes(mode)
				? mode
				: "human") as LaunchMode,
		},
	);
}

async function runSendNotification(
	cfg: Record<string, unknown>,
): Promise<Record<string, unknown>> {
	const userId = optStr(cfg.userId);
	if (!userId) {
		return { skipped: true, reason: "no recipient (config.userId) resolved" };
	}
	const row = await insertNotification({
		userId,
		type: str(cfg.type, "APP_UPDATE") as NotificationType,
		data: asObject(cfg.data),
		link: optStr(cfg.link) ?? null,
		read: false,
	});
	return { notificationId: row?.id ?? null };
}

async function runWriteToDataSet(
	cfg: Record<string, unknown>,
	ctx: PlaybookStepExecCtx,
): Promise<{ recordId: string | null; reason?: string }> {
	const dataSetKey = str(cfg.dataSetKey, "");
	if (!dataSetKey) return { recordId: null, reason: "missing dataSetKey" };
	const ds = await getDataSetByKey(ctx.organizationId, dataSetKey);
	if (!ds) return { recordId: null, reason: `data set '${dataSetKey}' not found` };
	const rec = await createDataSetRecord({
		organizationId: ctx.organizationId,
		dataSetId: ds.id,
		label: str(cfg.label, "playbook-record"),
		value: cfg.value,
	});
	return { recordId: rec?.id ?? null };
}

/** Resolve the branch label taken. Either reads a data-set record field
 * (dataSetKey/recordLabel/field) or a dot-path into the trigger payload (source);
 * the resulting value, stringified, selects the matching branch label. Returns
 * null when nothing matches -> the orchestrator skips ALL branch children. */
async function evaluateBranch(
	cfg: Record<string, unknown>,
	ctx: PlaybookStepExecCtx,
): Promise<string | null> {
	const branches = Array.isArray(cfg.branches) ? cfg.branches.map(String) : [];
	let value: unknown;
	const dataSetKey = optStr(cfg.dataSetKey);
	if (dataSetKey) {
		const ds = await getDataSetByKey(ctx.organizationId, dataSetKey);
		const rec = ds?.records.find((r) => r.label === str(cfg.recordLabel, ""));
		const field = optStr(cfg.field);
		value = rec
			? field
				? (rec.value as Record<string, unknown> | null)?.[field]
				: rec.value
			: undefined;
	} else {
		value = readPath(ctx.run.triggerPayload, str(cfg.source, ""));
	}
	const label = value === undefined || value === null ? "" : String(value);
	return branches.includes(label) ? label : null;
}

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

const DURATION_MS: Record<string, number> = {
	minutes: 60_000,
	hours: 3_600_000,
	days: 86_400_000,
	weeks: 604_800_000,
};

export function durationToMs(amount: number, unit: string): number {
	return Math.max(0, amount) * (DURATION_MS[unit] ?? DURATION_MS.days);
}

function num(v: unknown, fallback: number): number {
	return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
function str(v: unknown, fallback: string): string {
	return typeof v === "string" ? v : fallback;
}
function optStr(v: unknown): string | undefined {
	return typeof v === "string" && v.length > 0 ? v : undefined;
}
function asObject(v: unknown): Record<string, unknown> {
	return v && typeof v === "object" && !Array.isArray(v)
		? (v as Record<string, unknown>)
		: {};
}

/** Read a dot-path (e.g. "run.status") out of an unknown jsonb value. */
function readPath(root: unknown, path: string): unknown {
	if (!path) return undefined;
	let cur: unknown = root;
	for (const seg of path.split(".")) {
		if (cur && typeof cur === "object" && !Array.isArray(cur)) {
			cur = (cur as Record<string, unknown>)[seg];
		} else {
			return undefined;
		}
	}
	return cur;
}
