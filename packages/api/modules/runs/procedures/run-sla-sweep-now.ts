// packages/api/modules/runs/procedures/run-sla-sweep-now.ts
//
// Admin-triggered SLA sweep for the active org (Phase 8 step 5). adminOrgProcedure --
// the sweep fires escalation audit/activity rows for any overdue runs in the org and
// every admin should be able to do that consciously. Vercel Cron handles the
// scheduled platform-wide sweep; this procedure exists for:
//   - Dev parity (Vercel Cron doesn't fire locally; admins can dogfood by triggering)
//   - Production manual triggers (admins who want to fire the sweep without waiting
//     for the next hour's tick)
//
// Calls the same `runSlaSweep` lib that the cron endpoint uses, scoped to the active org.

import { runSlaSweep } from "../lib/sla-sweep";

import { adminOrgProcedure } from "../../../orpc/procedures";

export const runSlaSweepNow = adminOrgProcedure
	.route({
		method: "POST",
		path: "/runs/sla-sweep",
		tags: ["Runs"],
		summary: "Run the SLA sweep now for this org (admin/owner only)",
		description:
			"Manually fires the SLA escalation sweep for the active organization. Idempotent -- runs already escalated this hour are skipped (the audit_log antijoin in the sweep filters them out). Returns the number of runs scanned + escalated + per-run details for the success toast.",
	})
	.handler(async ({ context }) => {
		const result = await runSlaSweep({
			organizationId: context.organization.id,
			actorUserId: context.user.id,
		});
		return {
			scanned: result.scanned,
			escalated: result.escalated,
			runs: result.runs.map((r) => ({
				runId: r.runId,
				title: r.title,
				overdueByHours: Math.round(r.overdueByMs / (60 * 60 * 1000)),
			})),
		};
	});
