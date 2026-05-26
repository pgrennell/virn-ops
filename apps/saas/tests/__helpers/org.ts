// Organization flow helpers — drive the org creation, switching, and member
// flows via the UI. These assume the caller already has a session.

import type { Page } from "@playwright/test";

/**
 * Create an organization from the in-app `/new-organization` route. Returns
 * the slug the org ended up with — Better Auth normalizes the slug and may
 * deduplicate; the in-app form generates one server-side and the user is
 * routed to `/{slug}` on success.
 */
export async function createOrganizationViaUI(
	page: Page,
	params: { name: string },
): Promise<{ slug: string }> {
	await page.goto("/new-organization");
	await page.getByRole("textbox", { name: /organization name|name/i }).fill(params.name);
	await page.getByRole("button", { name: /create|continue/i }).click();
	// After creation, the user is routed into `/{orgSlug}/...`. Wait for the
	// URL to settle on a non-`/new-organization` path.
	await page.waitForURL((url) => !url.pathname.startsWith("/new-organization"), {
		timeout: 15_000,
	});
	const slug = page.url().match(/^https?:\/\/[^/]+\/([^/?#]+)/)?.[1];
	if (!slug) {
		throw new Error(`Could not parse org slug from URL after create: ${page.url()}`);
	}
	return { slug };
}

/**
 * Switch the active organization via the in-shell org switcher dropdown.
 * Navigates to the new org's home segment.
 */
export async function switchOrganizationViaUI(page: Page, params: { name: string }): Promise<void> {
	// The OrganizationSelect trigger renders the org name; click it to open.
	await page.getByRole("button", { name: new RegExp(params.name, "i") }).first().click();
	await page.getByRole("menuitem", { name: new RegExp(params.name, "i") }).click();
	await page.waitForLoadState("networkidle");
}

/**
 * Invite a member to the active org via the Members settings page. Returns
 * once the invitation has been submitted; the in-app invitation list is the
 * source of truth for whether it was accepted.
 */
export async function inviteMemberViaUI(
	page: Page,
	params: { orgSlug: string; email: string; role?: "member" | "admin" | "owner" },
): Promise<void> {
	await page.goto(`/${params.orgSlug}/settings/members`);
	await page.getByRole("textbox", { name: /email/i }).fill(params.email);
	if (params.role && params.role !== "member") {
		// The OrganizationRoleSelect is a select trigger; open and choose.
		await page.getByRole("combobox", { name: /role/i }).click();
		await page.getByRole("option", { name: new RegExp(params.role, "i") }).click();
	}
	await page.getByRole("button", { name: /invite|send/i }).click();
}
