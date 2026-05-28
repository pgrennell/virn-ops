// apps/saas/app/api/cron/cross-product-deliver/route.ts
//
// Vercel-Cron-triggered cross-product webhook delivery worker (Phase 11a
// step 3c part 2 step 3). Vercel Cron GETs this endpoint on the schedule
// defined in `vercel.json` (`* * * * *` -- every minute). Auth is a bearer
// header carrying CRON_SECRET (env var, shared with /api/cron/sla-sweep).
//
// Local dev note: Vercel Cron only fires in production deployments. For
// local dev:
//   - `pnpm cross-product-deliver:dev` (tooling/scripts) -- one-shot HTTP
//     call to this endpoint with the right CRON_SECRET header.

import { runCrossProductDeliveryWorker } from "@virn/api/modules/integrations/lib/cross-product-delivery";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Vercel Hobby plan caps cron at 60s. The worker's per-row request timeout
// (10s) + a batch size (50) means a worst-case all-timeouts run is 500s --
// over the budget. The cap below tells Vercel to abort the function if it
// approaches the limit; we tune batchSize down in the worker if we ever hit it.
export const maxDuration = 60;

export async function GET(request: Request) {
	const auth = request.headers.get("authorization");
	const expected = process.env.CRON_SECRET;

	if (!expected) {
		// Fail closed if the secret isn't configured -- never run the worker
		// without the gate in place.
		return Response.json({ error: "CRON_SECRET not configured" }, { status: 500 });
	}
	if (auth !== `Bearer ${expected}`) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}

	const result = await runCrossProductDeliveryWorker();

	return Response.json({
		ok: true,
		claimed: result.claimed,
		delivered: result.delivered,
		failed: result.failed,
		dead: result.dead,
		durationMs: result.durationMs,
		// Per-row outcomes for cron-log forensics. Volume per tick should be
		// small (batchSize=50 cap), so it's safe to inline.
		outcomes: result.outcomes,
	});
}
