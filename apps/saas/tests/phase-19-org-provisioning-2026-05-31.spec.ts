import { expect, test, type Page } from "@playwright/test";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { waitForVerificationForEmail } from "./__helpers/db";
import { getArtifactsDir } from "./__helpers/artifacts";
import { db, organization, member, workflow, vendorCategory } from "@virn/database";
import { eq } from "drizzle-orm";

const specName = "phase-19-org-provisioning-2026-05-31";
const tempDir = path.join(os.tmpdir(), `${specName}-temp`);
const nonce = Date.now();

// Track orgs created for cleanup
const createdOrgIds: string[] = [];

async function loginAsEmail(
	page: Page,
	email: string,
	callbackURLPath: string = "/new-organization",
) {
	console.log(`Helper: Authenticating ${email}...`);
	await page.goto("/login");
	await page.getByRole("tab", { name: "Magic link" }).click();
	await page.getByRole("textbox", { name: /email/i }).fill(email);
	await page.getByRole("button", { name: "Send magic link" }).click();

	const successAlert = page.locator("div").filter({ hasText: "Link sent" }).first();
	await expect(successAlert).toBeVisible({ timeout: 15000 });

	console.log(`Helper: Retrieving magic link token from DB for ${email}...`);
	const row = await waitForVerificationForEmail(email);
	const token = row.value;

	const callbackUrl = `http://localhost:3000/api/auth/magic-link/verify?token=${token}&callbackURL=http://localhost:3000${callbackURLPath}`;
	await page.goto(callbackUrl);
	await page.waitForLoadState("load");
	console.log(`Helper: Logged in as ${email} successfully!`);
}

test.describe.serial("Phase 19 Property-Ops Pack Provisioning E2E", () => {
	test.beforeAll(async () => {
		fs.mkdirSync(tempDir, { recursive: true });
		console.log("Starting Phase 19 Provisioning spec...");
	});

	test.beforeEach(async ({ page }) => {
		test.setTimeout(120000); // 2 mins
		page.on("console", (msg) => {
			console.log(`[Browser Console - ${msg.type()}]: ${msg.text()}`);
		});
		page.on("pageerror", (err) => {
			console.error(`[Browser Uncaught Error]: ${err.message}\nStack: ${err.stack}`);
		});
	});

	test("P0 — Scenario A: Create org → mode picker → populated library", async ({ page }) => {
		console.log("--- P0 — Scenario A: Create org → mode picker → populated library ---");
		
		await loginAsEmail(page, "pgrennell@gmail.com", "/new-organization");

		// 1. Fill unique organization name
		const orgName = `Antigravity Ops ${nonce}`;
		await page.locator("input[name='name']").fill(orgName);

		// Capture `01-create-form.png`
		await page.screenshot({ path: path.join(tempDir, "01-create-form.png") });
		console.log("Saved: 01-create-form.png");

		// Submit creation
		await page.getByRole("button", { name: "Create" }).click();

		// 2. Expect redirect to /new-organization/mode
		await page.waitForURL(/\/new-organization\/mode/, { timeout: 20000 });
		console.log("Redirected to Mode Picker successfully!");

		// Capture `02-mode-picker.png`
		await page.screenshot({ path: path.join(tempDir, "02-mode-picker.png") });
		console.log("Saved: 02-mode-picker.png");

		// Pick "SOPs & policies" mode
		await page.getByRole("button", { name: "SOPs & policies" }).click();

		// Continue
		await page.getByRole("button", { name: "Continue" }).click();

		// Expect to land on the dashboard (slug based)
		await page.waitForURL(/\/antigravity-ops-.*/, { timeout: 30000 });
		const currentUrl = page.url();
		const slugMatch = currentUrl.match(/\/([^/]+)$/) || currentUrl.match(/\/([^/]+)\/$/);
		if (!slugMatch) throw new Error(`Could not parse organization slug from URL: ${currentUrl}`);
		const orgSlug = slugMatch[1];
		console.log(`Successfully landed on organization dashboard with slug: ${orgSlug}`);

		// Look up organization in DB for cleanup
		const dbOrg = await db.query.organization.findFirst({
			where: eq(organization.slug, orgSlug),
		});
		if (dbOrg) {
			createdOrgIds.push(dbOrg.id);
			console.log(`Logged created Org ID for teardown: ${dbOrg.id}`);
		}

		// Navigate to Library
		await page.goto(`/${orgSlug}/library`);
		await page.waitForLoadState("load");
		await page.waitForTimeout(3000); // Hydration wait

		// Capture `03-library-populated.png`
		await page.screenshot({ path: path.join(tempDir, "03-library-populated.png") });
		console.log("Saved: 03-library-populated.png");

		// Verify "STR Turnover & Housekeeping" is present in the list
		const libraryWorkflowRow = page.locator("a, button, div").filter({ hasText: "STR Turnover & Housekeeping" }).first();
		await expect(libraryWorkflowRow).toBeVisible({ timeout: 15000 });
		console.log("VERIFIED: STR Turnover & Housekeeping workflow is successfully present in the library!");
	});

	test("P0 — Scenario B: New org Settings shows pack installed + vendor categories", async ({ page }) => {
		console.log("--- P0 — Scenario B: New org Settings shows pack installed ---");
		expect(createdOrgIds[0]).toBeDefined();

		const dbOrg = await db.query.organization.findFirst({
			where: eq(organization.id, createdOrgIds[0]),
		});
		if (!dbOrg) throw new Error("Could not find created organization in DB");

		await loginAsEmail(page, "pgrennell@gmail.com", `/${dbOrg.slug}/settings/general`);

		// Verify the "Install starter content" card is in installed/disabled state
		const installedStateBadge = page.locator("span, p, button").filter({ hasText: /Installed/i }).first();
		await expect(installedStateBadge).toBeVisible({ timeout: 15000 });

		const installButton = page.locator("button").filter({ hasText: "Install" }).first();
		if (await installButton.isVisible()) {
			await expect(installButton).toBeDisabled();
		}
		console.log("VERIFIED: General Settings displays the starter pack as already installed!");

		// Capture `04-settings-already-installed.png`
		await page.screenshot({ path: path.join(tempDir, "04-settings-already-installed.png") });
		console.log("Saved: 04-settings-already-installed.png");

		// Vendor categories are verified against the DB -- the per-category UI list isn't a
		// stable headless target, and the DB is the source of truth the pack install writes to.
		const dbCategories = await db
			.select()
			.from(vendorCategory)
			.where(eq(vendorCategory.organizationId, dbOrg.id));
		console.log("Seeded vendor categories:", dbCategories.map((c) => c.name));
		expect(dbCategories.length).toBeGreaterThanOrEqual(10);
		expect(dbCategories.map((c) => c.name)).toEqual(
			expect.arrayContaining([
				"Pest Control",
				"HVAC",
				"Plumbing",
				"Electrical",
				"Landscaping & Grounds",
				"Cleaning",
				"Pool & Spa",
				"Locksmith",
			]),
		);
		console.log("VERIFIED: DB contains the property-ops vendor categories.");

		// Capture `05-vendor-categories.png` (the settings surface).
		await page.screenshot({ path: path.join(tempDir, "05-vendor-categories.png") });
		console.log("Saved: 05-vendor-categories.png");
	});

	test("P1 — Scenario C: Second org is also populated", async ({ page }) => {
		console.log("--- P1 — Scenario C: Second org is also populated ---");
		
		await loginAsEmail(page, "pgrennell@gmail.com", "/new-organization");

		// 1. Fill unique second organization name
		const orgName = `Antigravity Ops B ${nonce}`;
		await page.locator("input[name='name']").fill(orgName);

		// Submit creation
		await page.getByRole("button", { name: "Create" }).click();

		// 2. Expect redirect to /new-organization/mode
		await page.waitForURL(/\/new-organization\/mode/, { timeout: 20000 });

		// Continue
		await page.getByRole("button", { name: "Continue" }).click();

		// Expect to land on the dashboard (slug based)
		await page.waitForURL(/\/antigravity-ops-b.*/, { timeout: 30000 });
		const currentUrl = page.url();
		const slugMatch = currentUrl.match(/\/([^/]+)$/) || currentUrl.match(/\/([^/]+)\/$/);
		if (!slugMatch) throw new Error(`Could not parse second organization slug from URL: ${currentUrl}`);
		const orgSlug = slugMatch[1];
		console.log(`Successfully landed on second organization dashboard with slug: ${orgSlug}`);

		// Look up organization in DB for cleanup
		const dbOrg = await db.query.organization.findFirst({
			where: eq(organization.slug, orgSlug),
		});
		if (dbOrg) {
			createdOrgIds.push(dbOrg.id);
			console.log(`Logged second created Org ID for teardown: ${dbOrg.id}`);
		}

		// Navigate to Library
		await page.goto(`/${orgSlug}/library`);
		await page.waitForLoadState("load");
		await page.waitForTimeout(3000); // Hydration wait

		// Capture `06-second-org-library.png`
		await page.screenshot({ path: path.join(tempDir, "06-second-org-library.png") });
		console.log("Saved: 06-second-org-library.png");

		// Verify "STR Turnover & Housekeeping" is present in the list
		const libraryWorkflowRow = page.locator("a, button, div").filter({ hasText: "STR Turnover & Housekeeping" }).first();
		await expect(libraryWorkflowRow).toBeVisible({ timeout: 15000 });
		console.log("VERIFIED: Second organization library also contains STR Turnover & Housekeeping workflow!");
	});

	test.afterAll(async () => {
		console.log("Cleaning up created E2E organizations, members, and template cascades...");
		for (const orgId of createdOrgIds) {
			try {
				// Cascade delete created workflows under the org
				const workflows = await db.select().from(workflow).where(eq(workflow.organizationId, orgId));
				for (const wf of workflows) {
					await db.delete(workflow).where(eq(workflow.id, wf.id));
				}
				
				// Delete all members
				await db.delete(member).where(eq(member.organizationId, orgId));
				
				// Delete organization
				await db.delete(organization).where(eq(organization.id, orgId));
				console.log(`Cleaned up organization: ${orgId}`);
			} catch (err) {
				console.error(`Failed to clean up organization ${orgId}:`, err);
			}
		}

		// Copy screenshots to final reviews folder
		try {
			const finalDir = getArtifactsDir(specName);
			fs.mkdirSync(finalDir, { recursive: true });

			if (fs.existsSync(tempDir)) {
				const files = fs.readdirSync(tempDir);
				for (const file of files) {
					const src = path.join(tempDir, file);
					const dest = path.join(finalDir, file);
					fs.copyFileSync(src, dest);
					console.log(`Copied screenshot: ${file} to ${dest}`);
				}
				// Clean up temp dir
				fs.rmSync(tempDir, { recursive: true, force: true });
				console.log("Cleaned up temp directory.");
			}
		} catch (err) {
			console.error("Error copying screenshots:", err);
		}
	});
});
