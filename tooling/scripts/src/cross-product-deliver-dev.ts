// tooling/scripts/src/cross-product-deliver-dev.ts
//
// Local dev one-shot trigger for the cross-product webhook delivery worker.
// Mirrors sla-sweep-dev.ts -- Vercel Cron doesn't fire in dev, so this script
// hits the cron HTTP endpoint with the CRON_SECRET bearer for manual testing.
//
// Usage:
//   pnpm --filter @virn/scripts cross-product-deliver:dev
//   pnpm --filter @virn/scripts cross-product-deliver:dev:watch  # polls every 60s
//
// Env it reads:
//   - SAAS_BASE_URL  (default: http://localhost:3000)
//   - CRON_SECRET    (must match the value the running app expects)

const BASE_URL = process.env.SAAS_BASE_URL ?? "http://localhost:3000";
const CRON_SECRET = process.env.CRON_SECRET;

async function fireWorker(): Promise<void> {
	if (!CRON_SECRET) {
		console.error("CRON_SECRET not set in env. Add it to .env.local before running.");
		process.exit(1);
	}
	const url = `${BASE_URL}/api/cron/cross-product-deliver`;
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
		`[${new Date().toISOString()}] claimed=${body.claimed} delivered=${body.delivered} failed=${body.failed} dead=${body.dead} (${elapsed}ms, serverDur=${body.durationMs}ms)`,
	);
	if (body.outcomes && body.outcomes.length > 0) {
		for (const o of body.outcomes) {
			const reason = o.reason ? ` -- ${o.reason}` : "";
			console.log(`  - ${o.eventId} ${o.outcome}${reason}`);
		}
	}
}

async function main(): Promise<void> {
	const watch = process.argv.includes("--watch");
	await fireWorker();
	if (watch) {
		const intervalMs = Number(process.env.CROSS_PRODUCT_DELIVER_INTERVAL_MS ?? 60_000);
		console.log(`Watching: re-firing every ${intervalMs}ms. Ctrl-C to stop.`);
		setInterval(() => {
			fireWorker().catch((err) => console.error("Worker error:", err));
		}, intervalMs);
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});

// Mark this file as a module so its top-level `const CRON_SECRET` etc. don't
// collide with sla-sweep-dev.ts under the scripts package's single tsconfig
// project. (Files with no imports/exports are treated as scripts and share
// global scope.)
export {};
