import { expect, test } from "@playwright/test";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { waitForVerificationForEmail } from "./__helpers/db";
import { getArtifactsDir } from "./__helpers/artifacts";
import { db, workflow, packInstall, solutionPack, organization, entitySet } from "@virn/database";
import { eq, or, and, like } from "drizzle-orm";

const specName = "builder-r-lifts-2026-05-29";
const tempDir = path.join(os.tmpdir(), "builder-r-lifts-2026-05-29-temp");
const orgSlug = "virn";

test.describe.serial("Virn Ops Builder R-Lifts Verification", () => {
	let createdWorkflowId: string | null = null;
	let aiWorkflowId: string | null = null;
	let orgId: string = "";

	test.beforeAll(async () => {
		// Ensure temp directory exists
		fs.mkdirSync(tempDir, { recursive: true });

		console.log("Cleaning up database baseline...");
		try {
			// 1. Clean up old E2E workflows to avoid collision
			await db.delete(workflow).where(
				or(
					like(workflow.title, "%E2E Builder R-Lifts Test%"),
					like(workflow.title, "%basic property turnover workflow%"),
					like(workflow.title, "%property turnover workflow%")
				)
			);
			console.log("Deleted matching workflows.");

			const orgRow = await db.query.organization.findFirst({
				where: (o, { eq }) => eq(o.slug, orgSlug),
			});

			if (orgRow) {
				orgId = orgRow.id;

				// 2. Clean up any existing entity sets
				await db.delete(entitySet).where(
					and(
						eq(entitySet.organizationId, orgRow.id),
						or(
							eq(entitySet.name, "STR penthouses"),
							eq(entitySet.name, "Beachfront")
						)
					)
				);
				console.log("Deleted existing test entity sets.");

				// 3. Pre-seed entity sets for Scenario D
				await db.insert(entitySet).values([
					{
						id: "set-penthouses-id",
						organizationId: orgRow.id,
						entityType: "listing",
						name: "STR penthouses",
						color: "#6366f1",
						description: "Sleek luxury units",
					},
					{
						id: "set-beachfront-id",
						organizationId: orgRow.id,
						entityType: "listing",
						name: "Beachfront",
						color: "#06b6d4",
						description: "Waterfront properties",
					}
				]);
				console.log("Pre-seeded entity sets.");

				// 4. Remove solution pack installation so we can test the install flow in Scenario F
				const packRow = await db.query.solutionPack.findFirst({
					where: (p, { eq }) => eq(p.slug, "property-ops"),
				});
				if (packRow) {
					await db.delete(packInstall).where(
						and(
							eq(packInstall.organizationId, orgRow.id),
							eq(packInstall.packId, packRow.id)
						)
					);
					console.log("Uninstalled solution pack 'property-ops' from DB.");
				}

				// Also clean up seeded workflows from solution pack so they can be fresh re-installed
				await db.delete(workflow).where(
					and(
						eq(workflow.organizationId, orgRow.id),
						or(
							eq(workflow.slug, "str-turnover-housekeeping"),
							eq(workflow.slug, "property-inspection"),
							eq(workflow.slug, "maintenance-routing")
						)
					)
				);
				console.log("Removed seeded workflows.");
			}
		} catch (err) {
			console.error("Error during beforeAll database cleanup:", err);
		}
	});

	test.beforeEach(async ({ page }) => {
		test.setTimeout(120000);

		page.on("console", (msg) => {
			console.log(`[Browser Console - ${msg.type()}]: ${msg.text()}`);
		});
		page.on("pageerror", (err) => {
			console.error(`[Browser Uncaught Error]: ${err.message}\nStack: ${err.stack}`);
		});

		// 1. Authenticate pgrennell@gmail.com via Magic Link bypass
		console.log("Authenticating pgrennell@gmail.com...");
		await page.goto("/login");
		await page.getByRole("tab", { name: "Magic link" }).click();
		await page.getByRole("textbox", { name: /email/i }).fill("pgrennell@gmail.com");
		await page.getByRole("button", { name: "Send magic link" }).click();

		const successAlert = page.locator("div").filter({ hasText: "Link sent" }).first();
		await expect(successAlert).toBeVisible({ timeout: 15000 });

		console.log("Retrieving magic link token from DB...");
		const row = await waitForVerificationForEmail("pgrennell@gmail.com");
		const token = row.value;

		const callbackUrl = `http://localhost:3000/api/auth/magic-link/verify?token=${token}&callbackURL=http://localhost:3000/virn/library`;
		await page.goto(callbackUrl);

		await expect(page.getByRole("heading", { name: "Library", exact: true })).toBeVisible({ timeout: 20000 });
		console.log("Logged in successfully!");
	});

	test("Scenario A & C & D & E - Variables Sidebar, Enabled Toggle, Scope, Modes", async ({ page, context }) => {
		test.setTimeout(180000);

		// Grant clipboard permissions to ensure click-to-copy clipboard evaluation works
		await context.grantPermissions(["clipboard-read", "clipboard-write"]);

		// ==========================================
		// P0 — Scenario A: Sidebar Layout, Tooltip, Copy, Search
		// ==========================================
		console.log("--- P0 — Scenario A: Variables Sidebar ---");
		await page.goto(`/${orgSlug}/library`);
		await page.waitForLoadState("networkidle");

		// Click Create -> New workflow
		const createBtn = page.locator("header").filter({ hasText: "Library" }).getByRole("button", { name: "Create" }).first();
		await createBtn.click();
		await page.getByRole("menuitem", { name: "New workflow" }).click();

		// Wait for builder redirect
		await page.waitForURL(/\/library\/workflows\/.*\/builder/, { timeout: 20000 });
		const url = page.url();
		const match = url.match(/\/workflows\/([a-zA-Z0-9_-]+)\/builder/);
		if (!match) throw new Error("Could not parse workflow ID from URL");
		createdWorkflowId = match[1];
		console.log("Created hand-authored workflow ID:", createdWorkflowId);

		// Rename workflow via API/Drizzle to E2E Builder R-Lifts Test
		await db.update(workflow).set({ title: "E2E Builder R-Lifts Test" }).where(eq(workflow.id, createdWorkflowId));
		await page.reload();
		await page.waitForLoadState("networkidle");
		await expect(page.locator("h1", { hasText: "E2E Builder R-Lifts Test" }).first()).toBeVisible({ timeout: 15000 });

		// Add a section and a step so the workflow is publishable later in Scenario E
		await page.locator("aside").getByRole("button", { name: "Add section" }).click();
		const addStepBtn = page.locator("aside").getByRole("button", { name: "Add step" }).first();
		await expect(addStepBtn).toBeVisible({ timeout: 10000 });
		await addStepBtn.click();
		await page.waitForTimeout(500);

		// Verify Sidebar is present
		const sidebarHeading = page.getByRole("heading", { name: "Template variables", exact: true }).first();
		await expect(sidebarHeading).toBeVisible({ timeout: 10000 });
		const searchInput = page.getByPlaceholder("Search tokens…").first();
		await expect(searchInput).toBeVisible();

		// Save screenshot 01
		await page.screenshot({ path: path.join(tempDir, "01-author-shell-with-sidebar.png") });
		console.log("Saved: 01-author-shell-with-sidebar.png");

		// Resize height to ~800px
		await page.setViewportSize({ width: 1280, height: 800 });
		await page.waitForTimeout(500);

		// Hover token chip and verify tooltip content
		const nameChip = page.locator("button", { hasText: "{{ listing.name }}" }).first();
		await expect(nameChip).toBeVisible();
		await nameChip.hover();
		await page.waitForTimeout(500);

		// Click token chip and check clipboard
		await nameChip.click();
		await page.waitForTimeout(500);

		const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
		console.log("Clipboard token copied:", clipboardText);
		expect(clipboardText).toBe("{{ listing.name }}");

		// Test token filtering (external_listing_id is the real field key)
		await searchInput.fill("external_listing_id");
		await searchInput.press("Enter");
		await page.waitForTimeout(500);
		await expect(page.locator("button", { hasText: "{{ listing.external_listing_id }}" }).first()).toBeVisible();
		await expect(page.locator("button", { hasText: "{{ listing.name }}" }).first()).toBeHidden();

		// Clear search
		await searchInput.fill("");
		await searchInput.press("Enter");
		await page.waitForTimeout(500);

		// ==========================================
		// P0 — Scenario C: Enabled/Disabled Switch
		// ==========================================
		console.log("--- P0 — Scenario C: Enabled/Disabled Switch ---");
		const toggleBtn = page.getByLabel("Enable workflow").first();
		await expect(toggleBtn).toBeVisible({ timeout: 10000 });
		
		// Assert initially Enabled text is visible
		const enabledText = page.locator("header").getByText("Enabled", { exact: true }).first();
		await expect(enabledText).toBeVisible();

		// Capture screenshot 04
		await page.screenshot({ path: path.join(tempDir, "04-top-bar-enabled.png") });
		console.log("Saved: 04-top-bar-enabled.png");

		// Toggle switch off
		await toggleBtn.click();
		
		// Verify Disabled text is visible
		const disabledText = page.locator("header").getByText("Disabled", { exact: true }).first();
		await expect(disabledText).toBeVisible({ timeout: 5000 });

		// Capture screenshot 05
		await page.screenshot({ path: path.join(tempDir, "05-top-bar-disabled.png") });
		console.log("Saved: 05-top-bar-disabled.png");

		// Reload and verify Disabled persists
		await page.reload();
		await page.waitForLoadState("networkidle");
		await expect(disabledText).toBeVisible({ timeout: 10000 });


		// Go back to Library and verify Inactive state (excl. from run launch)
		await page.goto(`/${orgSlug}/library`);
		await page.waitForLoadState("networkidle");
		
		const targetRow = page.locator("li").filter({ hasText: "E2E Builder R-Lifts Test" }).first();
		await expect(targetRow).toBeVisible();
		
		// Verify Inactive pill renders
		await expect(targetRow.getByText("Inactive")).toBeVisible({ timeout: 5000 });

		// Verify Run button is not present (draft-only has no run action)
		const runBtn = targetRow.getByRole("button", { name: "Run…" });
		await expect(runBtn).toBeHidden();

		// Verify Continue editing is visible for the draft
		const continueEditBtn = targetRow.getByRole("button", { name: "Continue editing" }).first();
		await expect(continueEditBtn).toBeVisible();

		// Capture screenshot 06
		await page.screenshot({ path: path.join(tempDir, "06-launcher-excludes-disabled.png") });
		console.log("Saved: 06-launcher-excludes-disabled.png");

		// Go back to Builder and toggle back on for remaining tests
		await page.goto(`/${orgSlug}/library/workflows/${createdWorkflowId}/builder`);
		await page.waitForLoadState("networkidle");
		const toggleBtn2 = page.getByLabel("Enable workflow").first();
		await expect(toggleBtn2).toBeVisible({ timeout: 10000 });
		await toggleBtn2.click();
		await expect(page.locator("header").getByText("Enabled", { exact: true }).first()).toBeVisible({ timeout: 5000 });

		// ==========================================
		// P1 — Scenario D: Scope Chip
		// ==========================================
		console.log("--- P1 — Scenario D: Scope Chip ---");
		const scopeChip = page.locator("button").filter({ hasText: /All listings|scoped/ }).first();
		await expect(scopeChip).toBeVisible();
		await expect(scopeChip.getByText("All listings")).toBeVisible();

		// Capture screenshot 07
		await page.screenshot({ path: path.join(tempDir, "07-scope-chip-all-listings.png") });
		console.log("Saved: 07-scope-chip-all-listings.png");

		// Click Scope Chip to open panel
		await scopeChip.click();
		await expect(page.getByRole("heading", { name: "Workflow settings" })).toBeVisible({ timeout: 5000 });

		// Check selected sets: click "STR penthouses"
		const penthouseBtn = page.getByRole("button", { name: "STR penthouses" }).first();
		await expect(penthouseBtn).toBeVisible();
		await penthouseBtn.click();
		await page.waitForTimeout(500);

		// Assert Scope chip reactively updates to "1 scoped"
		await expect(scopeChip.getByText("1 scoped")).toBeVisible();

		// Click "Beachfront"
		const beachfrontBtn = page.getByRole("button", { name: "Beachfront" }).first();
		await expect(beachfrontBtn).toBeVisible();
		await beachfrontBtn.click();
		await page.waitForTimeout(500);

		// Assert Scope chip reactively updates to "2 scoped"
		await expect(scopeChip.getByText("2 scoped")).toBeVisible();

		// Capture screenshot 08
		await page.screenshot({ path: path.join(tempDir, "08-scope-chip-narrowed.png") });
		console.log("Saved: 08-scope-chip-narrowed.png");

		// Close settings panel
		await page.getByRole("button", { name: "Close settings" }).click();

		// ==========================================
		// P1 — Scenario E: Adjacent Modes Layout (Preview & View)
		// ==========================================
		console.log("--- P1 — Scenario E: Preview and View Modes ---");
		// Toggle Preview ON
		await page.getByRole("button", { name: "Preview" }).click();
		await page.waitForTimeout(500);

		// Assert Author shell sidebar, Switch, Scope chip disappear in Preview
		await expect(sidebarHeading).toBeHidden();
		await expect(toggleBtn).toBeHidden();
		await expect(scopeChip).toBeHidden();

		// Capture screenshot 09
		await page.screenshot({ path: path.join(tempDir, "09-preview-mode.png") });
		console.log("Saved: 09-preview-mode.png");

		// Toggle Preview OFF (Click "Editing")
		await page.getByRole("button", { name: "Editing" }).click();
		await page.waitForTimeout(500);
		await expect(sidebarHeading).toBeVisible();

		// Publish workflow to inspect View mode
		await page.getByRole("button", { name: "Publish" }).click();
		await expect(page.getByRole("button", { name: "Edit" })).toBeVisible({ timeout: 15000 });

		// Assert elements are hidden in View mode
		await expect(sidebarHeading).toBeHidden();
		await expect(toggleBtn).toBeHidden();
		await expect(scopeChip).toBeHidden();

		// Capture screenshot 10
		await page.screenshot({ path: path.join(tempDir, "10-view-mode.png") });
		console.log("Saved: 10-view-mode.png");
	});

	test("Scenario B - Provenance 'AI' Badge", async ({ page }) => {
		test.setTimeout(240000);

		// ==========================================
		// P0 — Scenario B: Provenance AI badge
		// ==========================================
		console.log("--- P0 — Scenario B: Provenance AI badge ---");
		await page.goto(`/${orgSlug}/library`);
		await page.waitForLoadState("networkidle");

		// Create workflow with AI
		const createBtn = page.locator("header").filter({ hasText: "Library" }).getByRole("button", { name: "Create" }).first();
		await createBtn.click();
		await page.getByRole("menuitem", { name: "Author with AI…" }).click();

		await expect(page.getByRole("heading", { name: "Author with AI" })).toBeVisible({ timeout: 5000 });

		const prompt = "Build a basic property turnover workflow: schedule cleaning, clean, inspect, photograph, and notify owner. Each step takes a day.";
		await page.locator("textarea#ai-prompt").fill(prompt);

		// Click generate
		await page.getByRole("button", { name: "Generate workflow" }).click();

		// Wait for builder page (up to 90 seconds)
		await page.waitForURL(/\/library\/workflows\/.*\/builder/, { timeout: 90000 });
		await page.waitForLoadState("networkidle");
		await page.waitForTimeout(2000);

		const url = page.url();
		const match = url.match(/\/workflows\/([a-zA-Z0-9_-]+)\/builder/);
		if (!match) throw new Error("Could not parse workflow ID from URL");
		aiWorkflowId = match[1];
		console.log("AI-authored workflow ID:", aiWorkflowId);

		// Capture screenshot 02
		await page.screenshot({ path: path.join(tempDir, "02-ai-authored-rail-with-chips.png") });
		console.log("Saved: 02-ai-authored-rail-with-chips.png");

		// Assert AI pills exist in the rail
		const aiBadge = page.locator("span", { hasText: "AI" }).first();
		await expect(aiBadge).toBeVisible({ timeout: 10000 });
		
		// Verify tooltip reads "AI-generated step..."
		await aiBadge.hover();
		await page.waitForTimeout(500);

		// Click the first step to open and manually edit title
		const firstStepCard = page.locator('nav[aria-label="Run steps"] button').filter({ hasText: "Schedule cleaning" }).first();
		await expect(firstStepCard).toBeVisible();
		await firstStepCard.click();

		const titleInput = page.locator("input[placeholder='Step title']").first();
		await expect(titleInput).toBeVisible();
		await titleInput.fill("Schedule cleaning (Edited)");
		await titleInput.blur();
		await page.waitForTimeout(1000);

		// Reload and verify badge disappearance
		await page.reload();
		await page.waitForLoadState("networkidle");

		const editedStepCard = page.locator('nav[aria-label="Run steps"] button').filter({ hasText: "Schedule cleaning (Edited)" }).first();
		await expect(editedStepCard).toBeVisible({ timeout: 10000 });

		// Verify first step has NO AI badge
		const editedStepBadge = editedStepCard.locator("span", { hasText: "AI" });
		await expect(editedStepBadge).toBeHidden();

		// Sibling steps should still have the AI badge
		const siblingStepCard = page.locator('nav[aria-label="Run steps"] button').filter({ hasText: /^Clean/ }).first();
		const siblingStepBadge = siblingStepCard.locator("span", { hasText: "AI" });
		await expect(siblingStepBadge).toBeVisible();

		// Capture screenshot 03
		await page.screenshot({ path: path.join(tempDir, "03-ai-chip-after-manual-edit.png") });
		console.log("Saved: 03-ai-chip-after-manual-edit.png");
	});

	test("Scenario F - Pack Content Sanity", async ({ page }) => {
		test.setTimeout(180000);

		// ==========================================
		// P2 — Scenario F: Pack Content Sanity Check
		// ==========================================
		console.log("--- P2 — Scenario F: Pack Content Sanity ---");

		// 1. Go to general settings
		await page.goto(`/${orgSlug}/settings/general`);
		await page.waitForLoadState("networkidle");

		// 2. Click "Install starter content" button
		const installBtn = page.getByRole("button", { name: "Install starter content" }).first();
		await expect(installBtn).toBeEnabled({ timeout: 10000 });
		await installBtn.click();

		// Wait for transition to "Installed"
		const installedBtn = page.getByRole("button", { name: "Installed" }).first();
		await expect(installedBtn).toBeDisabled({ timeout: 30000 });
		console.log("Solution pack installed successfully via UI!");

		// 3. Go to Library and verify the 3 workflows exist
		await page.goto(`/${orgSlug}/library`);
		await page.waitForLoadState("networkidle");

		const strRow = page.locator("li").filter({ hasText: "STR Turnover & Housekeeping" }).first();
		const piRow = page.locator("li").filter({ hasText: "Property Inspection" }).first();
		const mrRow = page.locator("li").filter({ hasText: "Maintenance Routing" }).first();

		await expect(strRow).toBeVisible({ timeout: 10000 });
		await expect(piRow).toBeVisible();
		await expect(mrRow).toBeVisible();

		// Capture screenshot 11
		await page.screenshot({ path: path.join(tempDir, "11-pack-library-three-workflows.png") });
		console.log("Saved: 11-pack-library-three-workflows.png");

		// 4. Open Maintenance Routing by resolving its ID from DB and navigating directly (run actions only show "Run...")
		const mrWorkflow = await db.query.workflow.findFirst({
			where: (w, { eq, and }) => and(eq(w.slug, "maintenance-routing"), eq(w.organizationId, orgId))
		});
		if (!mrWorkflow) throw new Error("Maintenance Routing workflow not found in DB");

		await page.goto(`/${orgSlug}/library/workflows/${mrWorkflow.id}/builder`);
		await page.waitForURL(/\/library\/workflows\/.*\/builder/, { timeout: 20000 });
		await page.waitForLoadState("networkidle");

		// Verify optional step pills render (e.g. Notify tenant of scheduling)
		const notifyTenantStep = page.locator('nav[aria-label="Run steps"] button').filter({ hasText: "Notify tenant of scheduling" }).first();
		await expect(notifyTenantStep).toBeVisible({ timeout: 10000 });
		
		const optionalBadge = notifyTenantStep.locator("span", { hasText: "Optional" }).first();
		await expect(optionalBadge).toBeVisible();

		// Verify no AI badge is present
		const aiBadgeOnOptional = notifyTenantStep.locator("span", { hasText: "AI" });
		await expect(aiBadgeOnOptional).toBeHidden();

		// Capture screenshot 12
		await page.screenshot({ path: path.join(tempDir, "12-maintenance-routing-rail.png") });
		console.log("Saved: 12-maintenance-routing-rail.png");
	});

	test.afterAll(async () => {
		console.log("E2E verification finished. Cleaning up and copying screenshots...");

		// Hermetic DB cleanup of minted E2E workflows
		try {
			if (createdWorkflowId) {
				await db.delete(workflow).where(eq(workflow.id, createdWorkflowId));
				console.log(`Cleaned up hand-authored workflow: ${createdWorkflowId}`);
			}
			if (aiWorkflowId) {
				await db.delete(workflow).where(eq(workflow.id, aiWorkflowId));
				console.log(`Cleaned up AI-authored workflow: ${aiWorkflowId}`);
			}
		} catch (err) {
			console.error("Cleanup of E2E workflows failed:", err);
		}

		// Copy screenshots from temp directory to the docs destination
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
