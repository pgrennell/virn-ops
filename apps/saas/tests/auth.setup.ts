import { expect, test as setup } from "@playwright/test";

import { clickLatestMagicLinkForEmail, requestMagicLinkViaUI } from "./__helpers/auth";

// Authenticate the seeded admin ONCE and persist the session. Every phase-walkthrough spec
// reuses this storageState instead of logging in inline -- the inline per-spec magic-link logins
// race in parallel (they all share pgrennell@gmail.com and grab each other's "latest" token),
// which is what left them stranded on /login in the full suite. Logging in once here (the setup
// project runs alone, before the parallel specs) removes the race and the redundant logins.

const ADMIN_EMAIL = "pgrennell@gmail.com";
export const ADMIN_STORAGE_STATE = "test-results/.auth/admin.json";

setup("authenticate seeded admin", async ({ page }) => {
	await requestMagicLinkViaUI(page, ADMIN_EMAIL);
	await expect(page.getByText(/link sent/i).first()).toBeVisible({ timeout: 15_000 });

	await clickLatestMagicLinkForEmail(page, ADMIN_EMAIL);

	// Land in the app (the seeded admin is onboarded + owns the active org), not back on /login.
	await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20_000 });

	await page.context().storageState({ path: ADMIN_STORAGE_STATE });
});
