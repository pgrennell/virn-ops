import fs from "node:fs";
import path from "node:path";

import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "../../.env.local") });

// E2E mail capture: route the app's emails to the file-based capture provider so the auth
// helpers can read the verify / magic-link / reset URL from the email itself (better-auth's
// email-verification token is signed into the URL, not stored in a `verification` row). One
// shared path between the playwright process (helpers read it) and the app server
// (webServer.env), started from a clean file each run.
const mailCaptureFile = path.resolve(__dirname, "test-results", "mail-capture.jsonl");
fs.mkdirSync(path.dirname(mailCaptureFile), { recursive: true });
fs.writeFileSync(mailCaptureFile, "");
process.env.MAIL_CAPTURE_FILE = mailCaptureFile;

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
	testDir: "./tests",
	// Warm the auth routes once before the suite (next-dev compiles routes on first hit; the
	// /api/auth graph is heavy). Keeps the first real test from eating the ~20s cold-compile.
	globalSetup: "./tests/global-setup.ts",
	// 60s (up from the 30s default): a cold dev compile + Neon round-trips can push a first-of-kind
	// flow past 30s even after warming.
	timeout: 60_000,
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	workers: process.env.CI ? 1 : undefined,
	reporter: [["html"]],
	use: {
		baseURL: "http://localhost:3000",
		trace: "off",
		video: "off",
	},
	projects: [
		{ name: "setup", testMatch: /.*\.setup\.ts/, use: { ...devices["Desktop Chrome"] } },
		{
			// The auth-contract specs (auth/ login flows, org/ create-switch + cross-org IDOR) test
			// auth & isolation themselves: they create their own throwaway users and assert
			// logged-out / non-member behaviour, so they must NOT inherit the seeded-admin session.
			name: "logged-out",
			testMatch: /tests[\\/](auth|org)[\\/].*\.spec\.ts/,
			use: {
				...devices["Desktop Chrome"],
			},
		},
		{
			// Every other spec (the phase walkthroughs) reuses the seeded-admin session captured by
			// the setup project, instead of logging in inline. The inline per-spec magic-link logins
			// raced in parallel (all sharing pgrennell@gmail.com) and stranded specs on /login.
			name: "authenticated",
			testIgnore: /tests[\\/](auth|org)[\\/].*\.spec\.ts/,
			dependencies: ["setup"],
			use: {
				...devices["Desktop Chrome"],
				storageState: "test-results/.auth/admin.json",
			},
		},
	],
	webServer: {
		// The app server MUST read the monorepo-root .env.local (where DATABASE_URL lives --
		// apps/saas has no .env.local of its own) so it shares ONE database with the test helpers
		// (tests/__helpers/db.ts reads root .env.local via @virn/database). We load it EXPLICITLY
		// here via dotenv-cli instead of relying on env inheritance, so a cold run (CI or a clean
		// local :3000) always boots a correctly-wired server. Without this a freshly-started server
		// has no DATABASE_URL and every login-gated spec fails from cold. `next dev` keeps the cold
		// start fast and matches the mode the specs were validated against (a prod-build e2e can be
		// a separate job later). reuseExistingServer still lets a running dev server be reused.
		command:
			"pnpm --filter saas exec dotenv -e ../../.env.local -e ../../.env -- next dev --port 3000",
		url: "http://localhost:3000",
		// Route the app server's email sends to the file-based capture provider (read by the auth
		// helpers). dotenv-cli doesn't override already-set env vars, so these win.
		env: { MAIL_PROVIDER: "capture", MAIL_CAPTURE_FILE: mailCaptureFile },
		reuseExistingServer: !process.env.CI,
		stdout: "pipe",
		stderr: "pipe",
		timeout: 180 * 1000,
	},
});
