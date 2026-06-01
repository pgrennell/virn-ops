// Playwright global setup: warm the dev server's auth routes before the suite runs.
//
// In `next dev` the first request to a route compiles its whole module graph on demand. The
// /api/auth/sign-up path pulls in better-auth + drizzle + the mail/react-email stack, so the
// FIRST hit can take ~20s -- enough to blow a per-test timeout and to cause connection churn
// under parallel load. We pay that cost once, here, with throwaway requests, so the real tests
// run against warm routes. Best-effort: a warmup failure must not block the suite.

async function globalSetup() {
	const base = "http://localhost:3000";
	const warm = (path: string, init?: RequestInit) =>
		fetch(`${base}${path}`, init).catch(() => undefined);

	await warm("/login");
	await warm("/signup");
	// Compile the signup + email-verification path (the slowest cold route) with a throwaway.
	await warm("/api/auth/sign-up/email", {
		method: "POST",
		headers: { "content-type": "application/json", origin: base },
		body: JSON.stringify({
			email: `warmup-${Date.now()}@virn.test`,
			password: "Warmup123!x",
			name: "Warmup",
		}),
	});
	// Compile the oRPC router graph (pulls in the pack installer + workflow engine) so the
	// first org-create's starter-content install doesn't pay the cold-compile tax on top of
	// its own DB writes. The unauthenticated body still triggers route compilation.
	await warm("/api/rpc", {
		method: "POST",
		headers: { "content-type": "application/json", origin: base },
		body: "{}",
	});
}

export default globalSetup;
