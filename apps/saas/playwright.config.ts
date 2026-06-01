import path from "node:path";

import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "../../.env.local") });

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
	testDir: "./tests",
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
		{ name: "setup", testMatch: /.*\.setup\.ts/ },
		{
			name: "chromium",
			use: {
				...devices["Desktop Chrome"],
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
		reuseExistingServer: !process.env.CI,
		stdout: "pipe",
		stderr: "pipe",
		timeout: 180 * 1000,
	},
});
