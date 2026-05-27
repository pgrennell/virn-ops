// apps/saas/app/api/cron/sla-sweep/route.ts
//
// Vercel-Cron-triggered SLA sweep (Phase 8 step 5). Vercel Cron POSTs to this
// endpoint on the schedule defined in `vercel.json` (`0 * * * *` -- hourly). Auth
// is a bearer header carrying CRON_SECRET (env-var). The endpoint calls the same
// `runSlaSweep` lib that the admin "Run SLA sweep now" button uses (apples-to-
// apples logic regardless of trigger).
//
// Local dev note: Vercel Cron only fires in production deployments. For local
// dev, use either:
//   1. The admin button on /settings/general (org-scoped sweep), or
//   2. `pnpm sla-sweep:dev` (tooling/scripts) -- a one-shot HTTP call to this
//      endpoint with the right CRON_SECRET header.
// See BUILD_PLAN.md Phase 8 step 5 for the dev/prod parity story.

import { runSlaSweep } from "@virn/api/modules/runs/lib/sla-sweep";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
	const auth = request.headers.get("authorization");
	const expected = process.env.CRON_SECRET;

	if (!expected) {
		// Fail closed if the secret isn't configured -- never run the sweep without
		// the gate in place. Returns 500 so Vercel's cron-logs flag the
		// misconfiguration loudly.
		return Response.json(
			{ error: "CRON_SECRET not configured" },
			{ status: 500 },
		);
	}

	if (auth !== `Bearer ${expected}`) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}

	const startedAt = Date.now();
	const result = await runSlaSweep({
		organizationId: null, // platform-wide -- sweep every org's overdue runs
		actorUserId: null, // system-emitted; not a human user
	});
	const durationMs = Date.now() - startedAt;

	return Response.json({
		ok: true,
		scope: "platform",
		scanned: result.scanned,
		escalated: result.escalated,
		durationMs,
		// Include the per-run breakdown for cron-log forensics. Volume should be
		// small (only newly-overdue runs each tick).
		runs: result.runs.map((r) => ({
			runId: r.runId,
			organizationId: r.organizationId,
			title: r.title,
			overdueByHours: Math.round(r.overdueByMs / (60 * 60 * 1000)),
		})),
	});
}
