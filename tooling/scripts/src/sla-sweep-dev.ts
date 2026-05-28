// tooling/scripts/src/sla-sweep-dev.ts
//
// Local dev one-shot trigger for the SLA sweep endpoint. Vercel Cron doesn't fire in
// dev, so this script hits the cron HTTP endpoint with the CRON_SECRET bearer for
// manual testing. Use the admin UI button on /settings/general for org-scoped sweeps;
// this script does a platform-wide sweep via the cron endpoint (same path Vercel uses
// in prod).
//
// Usage:
//   pnpm --filter @virn/scripts sla-sweep:dev
//   pnpm --filter @virn/scripts sla-sweep:dev:watch  # polls every 60s
//
// Env it reads (loaded by the package script via dotenv-cli):
//   - SAAS_BASE_URL  (default: http://localhost:3000)
//   - CRON_SECRET    (must match the value the running app expects)

const BASE_URL = process.env.SAAS_BASE_URL ?? "http://localhost:3000";
const CRON_SECRET = process.env.CRON_SECRET;

async function fireSweep(): Promise<void> {
	if (!CRON_SECRET) {
		console.error("CRON_SECRET not set in env. Add it to .env.local before running.");
		process.exit(1);
	}
	const url = `${BASE_URL}/api/cron/sla-sweep`;
	const startedAt = Date.now();
	let res: Response;
	try {
		res = await fetch(url, {
			method: "GET",
			headers: { Authorization: `Bearer ${CRON_SECRET}` },
		});
	} catch (err) {
		console.error(`Fetch failed -- is the dev server running at ${BASE_URL}?`, err);
		return;
	}
	const elapsed = Date.now() - startedAt;
	if (!res.ok) {
		const body = await res.text();
		console.error(`[${new Date().toISOString()}] ${res.status} ${res.statusText} (${elapsed}ms)`);
		console.error(body);
		return;
	}
	const body = await res.json();
	console.log(
		`[${new Date().toISOString()}] scanned=${body.scanned} escalated=${body.escalated} (${elapsed}ms)`,
	);
	if (body.runs && body.runs.length > 0) {
		for (const r of body.runs) {
			console.log(
				`  - ${r.runId} (${r.title}) org=${r.organizationId} overdueByHours=${r.overdueByHours}`,
			);
		}
	}
}

async function main(): Promise<void> {
	const watch = process.argv.includes("--watch");
	await fireSweep();
	if (watch) {
		// Roughly mimics Vercel Cron's hourly cadence but tighter for dev. Set
		// SLA_SWEEP_INTERVAL_MS in env to override (default: 60_000 = every 60s).
		const intervalMs = Number(process.env.SLA_SWEEP_INTERVAL_MS ?? 60_000);
		console.log(`Watching: re-firing every ${intervalMs}ms. Ctrl-C to stop.`);
		setInterval(() => {
			fireSweep().catch((err) => console.error("Sweep error:", err));
		}, intervalMs);
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});

// Mark this file as a module so its top-level `const CRON_SECRET` etc. don't
// share scope with sibling dev scripts (e.g. cross-product-deliver-dev.ts that
// also reads CRON_SECRET).
export {};
