import { expect, test as setup } from "@playwright/test";

import { clickLatestMagicLinkForEmail, requestMagicLinkViaUI } from "./__helpers/auth";

// Authenticate the seeded admin ONCE and persist the session. Every phase-walkthrough spec
// reuses this storageState instead of logging in inline -- the inline per-spec magic-link logins
// race in parallel (they all share pgrennell@gmail.com and grab each other's "latest" token),
// which is what left them stranded on /login in the full suite. Logging in once here (the setup
// project runs alone, before the parallel specs) removes the race and the redundant logins.

const ADMIN_EMAIL = "pgrennell@gmail.com";
const ORG_SLUG = "virn"; // the canonical seeded org every authenticated walkthrough operates in
export const ADMIN_STORAGE_STATE = "test-results/.auth/admin.json";

setup("authenticate seeded admin", async ({ page }) => {
	await requestMagicLinkViaUI(page, ADMIN_EMAIL);
	await expect(page.getByText(/link sent/i).first()).toBeVisible({ timeout: 15_000 });

	await clickLatestMagicLinkForEmail(page, ADMIN_EMAIL);

	// Land in the app (the seeded admin is onboarded + owns the active org), not back on /login.
	await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20_000 });

	// Pin the session's active organization to the canonical seeded org BEFORE snapshotting it.
	// The org data procedures resolve from session.activeOrganizationId, and the magic-link login
	// leaves a non-deterministic (sometimes stale / non-member) active org -- so an unpinned
	// session makes every authenticated spec intermittently fail its first data load with
	// "not a member of the active organization". This is the load-bearing step of the storageState
	// approach. Explicit set-active (same endpoint as authClient.organization.setActive) is the
	// primary mechanism; the reload loop is a safety net relying on the app's own client-side
	// reconciliation if the active org is still wrong on first paint.
	await page.request
		.post("/api/auth/organization/set-active", { data: { organizationSlug: ORG_SLUG } })
		.catch(() => undefined);

	await page.goto(`/${ORG_SLUG}/library`);
	for (let attempt = 0; attempt < 3; attempt++) {
		const ok = await page
			.getByRole("heading", { name: "Library", exact: true })
			.isVisible({ timeout: 10_000 })
			.catch(() => false);
		if (ok) break;
		await page.waitForTimeout(1_500); // let the provider's setActive reconciliation land
		await page.reload();
	}
	await expect(page.getByRole("heading", { name: "Library", exact: true })).toBeVisible({
		timeout: 15_000,
	});

	await page.context().storageState({ path: ADMIN_STORAGE_STATE });
});
