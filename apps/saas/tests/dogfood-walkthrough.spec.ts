import { expect, test } from "@playwright/test";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { getArtifactsDir } from "./__helpers/artifacts";
import { db, listing, entitySet, workflow, organization } from "@virn/database";
import { eq, or } from "drizzle-orm";

const tempDir = path.join(os.tmpdir(), "virn-dogfood-9-5");
const artifactsDir = tempDir;

test.describe("Virn Ops Phase 9.5 Dogfood Walkthrough", () => {
	let orgSlug = "virn";
	let workflowId: string | null = null;
	let workflowTitle = "";

	test.beforeAll(async () => {
		// Ensure temp directory exists
		fs.mkdirSync(tempDir, { recursive: true });

		console.log("Cleaning up database baseline for dogfood walkthrough...");
		try {
			// Delete listings named Unit 3B
			await db.delete(listing).where(eq(listing.name, "Unit 3B"));
			console.log("Cleaned up listings named 'Unit 3B'.");

			// Delete entity sets named 'STR penthouses' or 'Beachfront'
			await db.delete(entitySet).where(
				or(
					eq(entitySet.name, "STR penthouses"),
					eq(entitySet.name, "Beachfront")
				)
			);
			console.log("Cleaned up entity sets named 'STR penthouses' or 'Beachfront'.");

			// Ensure organization concierge review is off initially
			await db.update(organization)
				.set({ requireConciergeReview: false })
				.where(eq(organization.slug, orgSlug));
			console.log("Ensured requireConciergeReview is false for organization 'virn'.");
		} catch (err) {
			console.error("Error during database cleanup:", err);
		}
	});

	test.beforeEach(async ({ page }) => {
		test.setTimeout(120000); // 2 minutes

		page.on("console", (msg) => {
			console.log(`[Browser Console - ${msg.type()}]: ${msg.text()}`);
		});
		page.on("pageerror", (err) => {
			console.error(`[Browser Uncaught Error]: ${err.message}\nStack: ${err.stack}`);
		});

		// 1. Authenticate pgrennell@gmail.com via Magic Link bypass
		console.log("Authenticating pgrennell@gmail.com...");
		await page.goto("/virn/library");

		await expect(page.getByRole("heading", { name: "Library", exact: true })).toBeVisible({ timeout: 20000 });
		console.log("Logged in successfully via magic link!");
	});

	test("Execute Dogfooding Walkthrough", async ({ page }) => {
		test.setTimeout(240000); // 4 minutes

		// ==========================================
		// Section 1 — Listings index (baseline)
		// ==========================================
		console.log("--- Section 1 — Listings index (baseline) ---");
		await page.goto(`/${orgSlug}/library/listings`);
		await page.waitForLoadState("networkidle");
		
		// Confirm the heading with "Listings" renders
		await expect(page.getByRole("heading", { name: "Listings", exact: true }).first()).toBeVisible({ timeout: 15000 });

		// Click "New listing" to create Unit 3B
		const newListingBtn = page.getByRole("button", { name: "New listing", exact: true }).first();
		await expect(newListingBtn).toBeVisible({ timeout: 10000 });
		await newListingBtn.click();

		// Fill in form details in dialog
		await page.locator("input#listing-name").fill("Unit 3B");
		
		// Select STR property type
		const typeSelect = page.locator("button#listing-property-type").first();
		await expect(typeSelect).toBeVisible();
		await typeSelect.click();
		await page.getByRole("option", { name: "STR / vacation rental" }).first().click();

		await page.locator("input#listing-external-id").fill("ext-3b");

		// Submit
		await page.getByRole("button", { name: "Add listing", exact: true }).click();

		// Wait for the row to render on listings index
		const listingRow = page.locator("li").filter({ hasText: "Unit 3B" }).first();
		await expect(listingRow).toBeVisible({ timeout: 15000 });

		// Confirm property-type pill STR renders, no chip badges yet
		await expect(listingRow.getByText("STR", { exact: true })).toBeVisible();
		
		await page.screenshot({ path: path.join(artifactsDir, "01_listings_index_baseline.png") });
		console.log("Saved: 01_listings_index_baseline.png");


		// ==========================================
		// Section 2 — Create + manage entity sets (admin)
		// ==========================================
		console.log("--- Section 2 — Create + manage entity sets (admin) ---");
		await page.goto(`/${orgSlug}/library/entity-sets`);
		await page.waitForLoadState("networkidle");
		await expect(page.getByRole("heading", { name: "Listing sets", exact: true }).first()).toBeVisible({ timeout: 15000 });

		// Create first set: STR penthouses
		await page.getByRole("button", { name: "New set", exact: true }).first().click();
		await page.locator("input[placeholder='e.g. \"STR penthouses\"']").fill("STR penthouses");
		
		// Indigo swatch
		await page.getByRole("button", { name: "Indigo", exact: true }).click();
		
		await page.locator("textarea[placeholder='Short note for the team about what this set is for.']").fill("Sleek luxury units");
		await page.getByRole("button", { name: "Create set", exact: true }).click();

		// Wait for it to appear
		await expect(page.locator("li").filter({ hasText: "STR penthouses" })).toBeVisible({ timeout: 10000 });

		// Create second set: Beachfront
		await page.getByRole("button", { name: "New set", exact: true }).first().click();
		await page.locator("input[placeholder='e.g. \"STR penthouses\"']").fill("Beachfront");
		
		// Cyan swatch
		await page.getByRole("button", { name: "Cyan", exact: true }).click();
		
		await page.locator("textarea[placeholder='Short note for the team about what this set is for.']").fill("Waterfront properties");
		await page.getByRole("button", { name: "Create set", exact: true }).click();

		// Wait for it to appear
		await expect(page.locator("li").filter({ hasText: "Beachfront" })).toBeVisible({ timeout: 10000 });

		// Manage members of STR penthouses
		const penthouseRow = page.locator("li").filter({ hasText: "STR penthouses" }).first();
		await penthouseRow.getByRole("button", { name: "Actions for STR penthouses", exact: true }).click();
		await page.getByRole("menuitem", { name: "Manage members" }).click();

		// Confirm dialog lists Unit 3B, click Add
		const memberDialog = page.getByRole("dialog");
		await expect(memberDialog).toBeVisible({ timeout: 5000 });
		
		const memberRow = memberDialog.locator("li").filter({ hasText: "Unit 3B" }).first();
		await expect(memberRow).toBeVisible();

		// Click Add to set
		const addBtn = memberRow.getByRole("button", { name: /add/i }).first();
		await addBtn.click();

		// The button/pill flips to "In set"
		await expect(memberRow.getByText("In set")).toBeVisible({ timeout: 5000 });

		// Close dialog by clicking Done
		await memberDialog.getByRole("button", { name: "Done", exact: true }).click();
		await expect(memberDialog).toBeHidden();

		// The list should now show 1 member for STR penthouses
		await expect(penthouseRow.locator("p").filter({ hasText: "1 member" })).toBeVisible({ timeout: 5000 });

		await page.screenshot({ path: path.join(artifactsDir, "02_entity_sets_admin.png") });
		console.log("Saved: 02_entity_sets_admin.png");


		// ==========================================
		// Section 3 — Listing-side chip badges + tagging round-trip
		// ==========================================
		console.log("--- Section 3 — Listing-side chip badges + tagging round-trip ---");
		await page.goto(`/${orgSlug}/library/listings`);
		await page.waitForLoadState("networkidle");
		await expect(page.getByRole("heading", { name: "Listings", exact: true }).first()).toBeVisible({ timeout: 15000 });

		// Confirm Unit 3B now shows STR penthouses chip
		const unitRow = page.locator("li").filter({ hasText: "Unit 3B" }).first();
		await expect(unitRow.getByText("STR penthouses")).toBeVisible();

		// Open row menu -> Manage tags
		await unitRow.getByRole("button", { name: "Actions for Unit 3B", exact: true }).click();
		await page.getByRole("menuitem", { name: "Manage tags" }).click();

		// Confirm STR penthouses shows as Tagged
		const tagsDialog = page.getByRole("dialog");
		await expect(tagsDialog).toBeVisible({ timeout: 5000 });
		
		const penthouseTagRow = tagsDialog.locator("li").filter({ hasText: "STR penthouses" }).first();
		const penthouseTagBtn = penthouseTagRow.getByRole("button");
		await expect(penthouseTagBtn).toContainText("Tagged");

		// Click Tag on Beachfront
		const beachfrontTagRow = tagsDialog.locator("li").filter({ hasText: "Beachfront" }).first();
		const beachfrontTagBtn = beachfrontTagRow.getByRole("button");
		await beachfrontTagBtn.click();

		// Close dialog by clicking Done
		await tagsDialog.getByRole("button", { name: "Done", exact: true }).click();
		await expect(tagsDialog).toBeHidden();

		// Confirm TWO chips render in the listings index list
		await expect(unitRow.getByText("STR penthouses")).toBeVisible();
		await expect(unitRow.getByText("Beachfront")).toBeVisible();

		await page.screenshot({ path: path.join(artifactsDir, "03_listing_chip_badges.png") });
		console.log("Saved: 03_listing_chip_badges.png");


		// ==========================================
		// Section 4 — Builder Scope panel
		// ==========================================
		console.log("--- Section 4 — Builder Scope panel ---");
		await page.goto(`/${orgSlug}/library`);
		await page.waitForLoadState("networkidle");
		await expect(page.getByRole("heading", { name: "Library", exact: true })).toBeVisible({ timeout: 15000 });

		// Create a new workflow
		await page.locator("header").filter({ hasText: "Library" }).getByRole("button", { name: "Create" }).click();
		await page.getByRole("menuitem", { name: "New workflow" }).click();

		// Wait for redirect to builder
		await page.waitForURL(/\/library\/workflows\/.*\/builder/, { timeout: 15000 });
		workflowId = page.url().match(/\/workflows\/([a-zA-Z0-9_-]+)\/builder/)![1];
		workflowTitle = `E2E Concierge Review ${Date.now()}`;

		// Rename it so we don't pollute list
		console.log("Renaming workflow in DB...");
		await db.update(workflow).set({ title: workflowTitle }).where(eq(workflow.id, workflowId));
		await page.reload();
		await page.waitForLoadState("networkidle");
		await expect(page.locator("h1", { hasText: workflowTitle }).first()).toBeVisible({ timeout: 15000 });

		// Add section and step to ensure workflow is publishable
		console.log("Adding section and step to make workflow publishable...");
		await page.locator("aside").getByRole("button", { name: "Add section" }).click();
		const addStepBtn = page.locator("aside").getByRole("button", { name: "Add step" }).first();
		await expect(addStepBtn).toBeVisible({ timeout: 10000 });
		await addStepBtn.click();

		const stepRow = page.locator("aside").locator("button").filter({ hasText: "Untitled step" }).first();
		await expect(stepRow).toBeVisible({ timeout: 15000 });

		// In top bar, click the gear icon (Workflow settings)
		const gearIcon = page.getByRole("button", { name: "Workflow settings" }).first();
		await gearIcon.click();

		// Panel opens with Scope section showing chips for STR penthouses and Beachfront
		const scopePanel = page.locator("section").filter({ hasText: "Scope" });
		await expect(scopePanel).toBeVisible({ timeout: 10000 });

		const penthousesScopeChip = scopePanel.locator("button").filter({ hasText: "STR penthouses" }).first();
		const beachfrontScopeChip = scopePanel.locator("button").filter({ hasText: "Beachfront" }).first();

		await expect(penthousesScopeChip).toBeVisible();
		await expect(beachfrontScopeChip).toBeVisible();

		// Click STR penthouses to select it
		await penthousesScopeChip.click();

		// Wait for autosave "Saved" badge
		await expect(scopePanel.getByText("Saved")).toBeVisible({ timeout: 10000 });

		// Click again to deselect
		await penthousesScopeChip.click();
		await expect(scopePanel.getByText("Saved")).toBeVisible({ timeout: 10000 });

		// Select it again to have it saved as part of scope
		await penthousesScopeChip.click();
		await expect(scopePanel.getByText("Saved")).toBeVisible({ timeout: 10000 });

		// Close the panel
		await page.getByRole("button", { name: "Close settings", exact: true }).click();
		await expect(scopePanel).toBeHidden();

		await page.screenshot({ path: path.join(artifactsDir, "04_builder_scope_panel.png") });
		console.log("Saved: 04_builder_scope_panel.png");


		// ==========================================
		// Section 5 — Settings: enable concierge review
		// ==========================================
		console.log("--- Section 5 — Settings: enable concierge review ---");
		await page.goto(`/${orgSlug}/settings/general`);
		await page.waitForLoadState("networkidle");
		await expect(page.getByRole("heading", { name: "Organization", exact: true }).first()).toBeVisible({ timeout: 15000 });

		// Find the Concierge review card toggle switch and click it
		const conciergeToggle = page.getByRole("switch", { name: "Toggle concierge review" }).first();
		await expect(conciergeToggle).toBeVisible();
		await conciergeToggle.click();

		// Confirm the toast appears
		const toast = page.locator("div").filter({ hasText: "Concierge review enabled" }).first();
		await expect(toast).toBeVisible({ timeout: 10000 });

		// Description text should now say "On — pending reviews land in /library/reviews"
		await expect(page.getByText("On — pending reviews land in /library/reviews")).toBeVisible({ timeout: 5000 });

		// Refresh page to check persistence (optional sanity check)
		await page.reload();
		await page.waitForLoadState("networkidle");
		await expect(page.getByText("On — pending reviews land in /library/reviews")).toBeVisible({ timeout: 10000 });

		await page.screenshot({ path: path.join(artifactsDir, "05_settings_concierge_review.png") });
		console.log("Saved: 05_settings_concierge_review.png");


		// ==========================================
		// Section 6 — Builder Submit-for-review flow
		// ==========================================
		console.log("--- Section 6 — Builder Submit-for-review flow ---");
		await page.goto(`/${orgSlug}/library/workflows/${workflowId}/builder`);
		await page.waitForLoadState("networkidle");
		await expect(page.locator("h1", { hasText: workflowTitle }).first()).toBeVisible({ timeout: 15000 });

		// In top bar, the primary button should now read "Submit for review"
		const submitReviewBtn = page.getByRole("button", { name: "Submit for review" });
		await expect(submitReviewBtn).toBeVisible({ timeout: 10000 });

		// Click it. The page refetches.
		await submitReviewBtn.click();

		// Top bar now shows "In review" chip (indigo)
		const inReviewChip = page.locator("span").filter({ hasText: "In review" }).first();
		await expect(inReviewChip).toBeVisible({ timeout: 15000 });

		// "Send back" (ghost button) + "Approve & publish" (primary button)
		const sendBackBtn = page.getByRole("button", { name: "Send back" });
		const approveBtn = page.getByRole("button", { name: "Approve & publish" });
		await expect(sendBackBtn).toBeVisible();
		await expect(approveBtn).toBeVisible();

		// No "Discard draft" button and no "Submit for review" button
		await expect(page.getByRole("button", { name: "Discard draft" })).toBeHidden();
		await expect(submitReviewBtn).toBeHidden();

		await page.screenshot({ path: path.join(artifactsDir, "06_submit_for_review_flow.png") });
		console.log("Saved: 06_submit_for_review_flow.png");


		// ==========================================
		// Section 7 — Admin review inbox
		// ==========================================
		console.log("--- Section 7 — Admin review inbox ---");
		await page.goto(`/${orgSlug}/library/reviews`);
		await page.waitForLoadState("networkidle");
		
		// Wait for the inbox page to load
		await expect(page.getByRole("heading", { name: "Review inbox", exact: true })).toBeVisible({ timeout: 15000 });

		// The workflow we submitted should appear in the list
		const reviewRow = page.locator("li").filter({ hasText: workflowTitle }).first();
		await expect(reviewRow).toBeVisible({ timeout: 10000 });

		// "In review" chip + "Draft v1" etc.
		await expect(reviewRow.getByText("In review")).toBeVisible();
		await expect(reviewRow.getByText("Draft v1")).toBeVisible();

		// Click Open in Builder
		await reviewRow.getByRole("button", { name: "Open in Builder" }).click();

		// Confirm it lands back on the Builder with the in-review top bar
		await page.waitForURL(/\/library\/workflows\/.*\/builder/, { timeout: 15000 });
		await expect(page.locator("span").filter({ hasText: "In review" }).first()).toBeVisible({ timeout: 10000 });

		await page.screenshot({ path: path.join(artifactsDir, "07_admin_review_inbox.png") });
		console.log("Saved: 07_admin_review_inbox.png");


		// ==========================================
		// Section 8 — Approve / Send-back
		// ==========================================
		console.log("--- Section 8 — Approve / Send-back ---");
		// Click Send back
		await page.getByRole("button", { name: "Send back" }).click();

		// Wait for the mutation and page refetches to completely settle
		await page.waitForLoadState("networkidle");
		await page.waitForTimeout(1500);

		// Page refetches. Top bar reverts to draft mode showing Submit for review again
		await expect(page.getByRole("button", { name: "Submit for review" })).toBeVisible({ timeout: 15000 });
		await expect(page.locator("span").filter({ hasText: "Draft" }).first()).toBeVisible();

		// Submit for review again
		await page.getByRole("button", { name: "Submit for review" }).click();

		// Wait for the mutation and page refetches to completely settle
		await page.waitForLoadState("networkidle");
		await page.waitForTimeout(2000);

		await expect(page.locator("span").filter({ hasText: "In review" }).first()).toBeVisible({ timeout: 15000 });

		// Click Approve & publish
		await page.getByRole("button", { name: "Approve & publish" }).click();

		// The workflow publishes: top bar should show "Published" and "Edit" button
		await expect(page.getByRole("button", { name: "Edit" })).toBeVisible({ timeout: 15000 });
		await expect(page.locator("span").filter({ hasText: "Published" }).first()).toBeVisible();

		await page.screenshot({ path: path.join(artifactsDir, "08_approve_publish.png") });
		console.log("Saved: 08_approve_publish.png");

		// Visit reviews again -> the workflow should be gone from the inbox
		await page.goto(`/${orgSlug}/library/reviews`);
		await page.waitForLoadState("networkidle");
		await expect(page.getByRole("heading", { name: "Review inbox", exact: true })).toBeVisible({ timeout: 15000 });
		await expect(page.locator("li").filter({ hasText: workflowTitle })).toBeHidden({ timeout: 10000 });

		// Revert settings: disable concierge review to return to baseline
		console.log("Restoring concierge review settings baseline...");
		await page.goto(`/${orgSlug}/settings/general`);
		await page.waitForLoadState("networkidle");
		await expect(page.getByRole("heading", { name: "Organization", exact: true }).first()).toBeVisible({ timeout: 15000 });

		const restoreToggle = page.getByRole("switch", { name: "Toggle concierge review" }).first();
		await expect(restoreToggle).toBeVisible();
		await restoreToggle.click();
		await expect(page.locator("div").filter({ hasText: "Concierge review disabled" }).first()).toBeVisible({ timeout: 10000 });
	});

	test.afterAll(async () => {
		console.log("Walkthrough finished. Copying screenshots to final repository destination...");
		try {
			const finalDir = getArtifactsDir("9-5-dogfood");
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
