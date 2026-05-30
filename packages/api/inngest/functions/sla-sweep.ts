// packages/api/inngest/functions/sla-sweep.ts
//
// Phase 18 core -- SLA sweep migration from Vercel Cron to Inngest. Same
// runSlaSweep lib that the Vercel Cron endpoint + the admin manual-trigger
// procedure already call. Identical business logic; different trigger.
//
// Schedule: hourly (matches the prior `0 * * * *` Vercel Cron cadence). When
// Inngest is verified firing in prod for a few weeks, the Vercel Cron entry
// in apps/saas/vercel.json can be removed -- but until then, both triggers
// running is harmless because `findOverdueRunsToEscalate` antijoins against
// the audit log (already-escalated runs are skipped automatically).
//
// The function uses Inngest's step.run wrapper so the sweep is retryable +
// observable in the Inngest dashboard. A per-row failure inside the sweep
// continues to the next row (existing runSlaSweep behavior); a top-level
// throw bubbles to Inngest's retry policy.

import { runSlaSweep } from "../../modules/runs/lib/sla-sweep";
import { inngest } from "../client";

export const slaSweepScheduled = inngest.createFunction(
	{
		id: "sla-sweep-scheduled",
		name: "SLA escalation sweep (hourly)",
	},
	// Hourly at minute 0, matching the prior Vercel Cron schedule.
	{ cron: "0 * * * *" },
	async ({ step }) => {
		const result = await step.run("scan-and-escalate", async () => {
			return await runSlaSweep({
				organizationId: null,
				actorUserId: null,
			});
		});
		return result;
	},
);
