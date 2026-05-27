// packages/api/modules/runs/lib/sla-sweep.ts
//
// SLA escalation sweep (Phase 8 step 5, BUILD_PLAN.md v2). Find active runs whose
// `dueAt` has passed and that haven't already been escalated; for each, write a
// `run.escalated` audit row + a `escalated` activity event. Subsequent sweeps skip the
// same runs via the audit-log antijoin (idempotency without new schema).
//
// What "escalation" means in v1 (deliberately thin):
//   - One audit_log row per overdue run: action='run.escalated', changes carry the
//     overdue-by-ms delta + previous dueAt for forensics.
//   - One activity_event row mirroring the audit row -- shows up in the run timeline
//     as a system-emitted "Escalated" event.
//   - **No notifications yet** (would require adding a RUN_OVERDUE notification type,
//     which is its own enum migration). Notifications + automation-action execution
//     are Phase 18 follow-ups. The audit + activity rows are enough for the dev /
//     manager dashboard to surface "X runs escalated" via the existing audit feed.
//
// Triggers (both call this same lib function):
//   - Vercel Cron HTTP endpoint at `/api/cron/sla-sweep` (prod) -- platform-wide sweep.
//   - Admin oRPC procedure `runs.runSlaSweepNow` (admin/owner only) -- org-scoped
//     sweep for manual testing / dev parity since Vercel Cron doesn't fire locally.
//
// Successor (Phase 18 -- BUILD_PLAN v2): once the full automation_action executor +
// Inngest land, this sweep becomes an Inngest scheduled function that emits an
// SLA-breach event; automation rules with triggerType='sla_breach' then handle the
// escalation actions through the catalog (notify, reassign, run_workflow). Same
// business logic, richer reactions.

import {
	findOverdueRunsToEscalate,
	type OverdueRunRow,
	writeAuditAndActivity,
} from "@virn/database";

export interface SlaSweepResult {
	/** Total candidate runs the sweep found (active + dueAt < now + not already escalated). */
	scanned: number;
	/** Runs actually escalated this sweep (== `scanned` unless individual writes errored). */
	escalated: number;
	/** Detail rows for observability + the admin UI's success toast / log. */
	runs: Array<{
		runId: string;
		organizationId: string;
		title: string;
		dueAt: Date;
		overdueByMs: number;
	}>;
}

/** Internal: emit the audit + activity rows that constitute an escalation. The audit
 * row's existence is the idempotency marker -- once written, findOverdueRunsToEscalate
 * filters this run out of future sweeps. */
async function escalateRun(
	row: OverdueRunRow,
	actorUserId: string | null,
	now: Date,
): Promise<void> {
	const overdueByMs = now.getTime() - row.dueAt.getTime();
	await writeAuditAndActivity({
		organizationId: row.organizationId,
		// System-emitted: actorUserId is the admin who manually triggered the sweep,
		// or null for the Vercel-Cron path. Either way, actorKind defaults to 'user'
		// (the cron writer is treated as a system user for audit purposes; not
		// currently a separate principal kind -- a follow-up could mint a dedicated
		// 'system' actor kind if needed).
		actorUserId,
		action: "run.escalated",
		verb: "escalated",
		entityType: "run",
		entityId: row.id,
		changes: {
			previousDueAt: row.dueAt.toISOString(),
			overdueByMs,
			workflowId: row.workflowId,
		},
		metadata: {
			source: actorUserId ? "manual_admin_sweep" : "scheduled_sla_sweep",
		},
		activityData: {
			runTitle: row.title,
			overdueByHours: Math.round(overdueByMs / (60 * 60 * 1000)),
		},
	});
}

/** Run the sweep. Pure lib -- the caller (cron endpoint or oRPC procedure) handles
 * auth scoping by passing `organizationId === null` (platform-wide) vs. a specific
 * id (single-org). Per-row failures don't abort the sweep -- they're logged and the
 * count diverges from `scanned`.
 *
 * `actorUserId` is the admin who manually triggered the sweep (admin-button path);
 * `null` for the Vercel-Cron path. Recorded on the audit row for forensics.
 *
 * `now` is injectable so tests don't depend on wall-clock. */
export async function runSlaSweep(input: {
	organizationId: string | null;
	actorUserId: string | null;
	now?: Date;
}): Promise<SlaSweepResult> {
	const now = input.now ?? new Date();
	const candidates = await findOverdueRunsToEscalate(input.organizationId, now);

	const runs: SlaSweepResult["runs"] = [];
	let escalated = 0;
	for (const row of candidates) {
		try {
			await escalateRun(row, input.actorUserId, now);
			escalated += 1;
			runs.push({
				runId: row.id,
				organizationId: row.organizationId,
				title: row.title,
				dueAt: row.dueAt,
				overdueByMs: now.getTime() - row.dueAt.getTime(),
			});
		} catch {
			// Per-row failure: skip and continue. The next sweep will retry since the
			// audit row was never written (idempotency-by-audit-row works in our
			// favor here -- failed escalation = stay overdue = pick up next sweep).
		}
	}

	return {
		scanned: candidates.length,
		escalated,
		runs,
	};
}
