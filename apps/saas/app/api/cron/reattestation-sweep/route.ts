// apps/saas/app/api/cron/reattestation-sweep/route.ts
//
// Phase 16 (Slice D) -- Vercel-Cron-triggered re-attestation sweep. Same
// shape as /api/cron/sla-sweep: bearer-auth via CRON_SECRET, calls the
// runReattestationSweep lib platform-wide, returns a count summary for
// Vercel's cron logs.
//
// Schedule (vercel.json): daily at 06:00 UTC (`0 6 * * *`). Daily is fine
// because review intervals are measured in days, not minutes -- a six-hour
// window of slack on either side is invisible to the use case.
//
// Local dev: Vercel Cron doesn't fire locally. For dev parity, run
// `pnpm --filter @virn/scripts reattestation-sweep:dev` (TODO -- not yet
// scripted; one-shot curl against the endpoint with CRON_SECRET works too).

import { runReattestationSweep } from "@virn/api/modules/workflows/lib/reattestation-sweep";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
	const auth = request.headers.get("authorization");
	const expected = process.env.CRON_SECRET;

	if (!expected) {
		return Response.json(
			{ error: "CRON_SECRET not configured" },
			{ status: 500 },
		);
	}

	if (auth !== `Bearer ${expected}`) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}

	const startedAt = Date.now();
	const result = await runReattestationSweep({
		organizationId: null,
		actorUserId: null,
	});

	return Response.json({
		ok: true,
		scanned: result.scanned,
		advanced: result.advanced,
		elapsedMs: Date.now() - startedAt,
	});
}
