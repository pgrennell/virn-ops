import { expect, test } from "@playwright/test";
import * as path from "node:path";
import { waitForVerificationForEmail } from "./__helpers/db";
import { getArtifactsDir } from "./__helpers/artifacts";

const artifactsDir = getArtifactsDir("library-launcher-verification");

test.describe("Virn Ops Library + Launcher End-to-End Walk", () => {
	let workflowTitle: string;
	let workflowId: string | null = null;
	let startTimestamp: number;

	test.beforeEach(async ({ page }) => {
		test.setTimeout(120000); // Allow ample time for Windows cold starts and database transactions

		page.on("console", (msg) => {
			console.log(`[Browser Console - ${msg.type()}]: ${msg.text()}`);
		});
		page.on("pageerror", (err) => {
			console.error(`[Browser Uncaught Error]: ${err.message}\nStack: ${err.stack}`);
		});

		// Authenticate via Magic Link UI + DB token bypass flow
		console.log("Authenticating admin (pgrennell@gmail.com) via Magic Link UI...");
		await page.goto("/login");

		await page.getByRole("tab", { name: "Magic link" }).click();
		await page.getByRole("textbox", { name: /email/i }).fill("pgrennell@gmail.com");
		await page.getByRole("button", { name: "Send magic link" }).click();

		const successAlert = page.locator("div").filter({ hasText: "Link sent" }).first();
		await expect(successAlert).toBeVisible({ timeout: 15000 });

		console.log("Waiting for magic link token in DB...");
		const row = await waitForVerificationForEmail("pgrennell@gmail.com");
		const token = row.value;

		const callbackUrl = `http://localhost:3000/api/auth/magic-link/verify?token=${token}&callbackURL=http://localhost:3000/virn/library`;
		await page.goto(callbackUrl);

		// Wait for landing on Library page
		await expect(page.getByRole("heading", { name: "Library", exact: true })).toBeVisible({ timeout: 20000 });
		console.log("Authentication successful, on Library page!");
	});

	test("Execute E2E Loop", async ({ page }) => {
		test.setTimeout(180000); // 3 minutes for the full walk
		console.log("Starting E2E Library + Launcher loop...");
		startTimestamp = Date.now();

		// 1. Navigate to http://localhost:3000/virn/library (Already done in beforeEach, but let's assert)
		console.log("Step 1: Asserting Library renders and [Demo] Onboarding is visible");
		const onboardingRow = page.locator("li").filter({ hasText: "[Demo] Onboarding" }).first();
		await expect(onboardingRow).toBeVisible({ timeout: 10000 });
		
		// Assert "Published v1" pill is visible
		const publishedPill = onboardingRow.locator("span", { hasText: "Published v1" }).first();
		await expect(publishedPill).toBeVisible();

		// Assert no "Inactive" pill is visible
		const inactivePill = onboardingRow.locator("span", { hasText: "Inactive" }).first();
		await expect(inactivePill).toBeHidden();

		// Assert "Run…" button is visible
		const runBtn = onboardingRow.getByRole("button", { name: "Run…" });
		await expect(runBtn).toBeVisible();

		await page.screenshot({ path: path.join(artifactsDir, "01_library_loaded.png") });
		console.log("Saved: 01_library_loaded.png");

		// 2. Click "+ Create" -> "New workflow"
		console.log("Step 2: Clicking + Create -> New workflow");
		await page.locator("header").filter({ hasText: "Library" }).getByRole("button", { name: "Create" }).click();
		await page.getByRole("menuitem", { name: "New workflow" }).click();

		// Expect redirect to builder page
		await page.waitForURL(/\/library\/workflows\/.*\/builder/, { timeout: 15000 });
		const currentUrl = page.url();
		console.log("Navigated to builder URL:", currentUrl);
		const match = currentUrl.match(/\/workflows\/([a-zA-Z0-9_-]+)\/builder/);
		if (match) {
			workflowId = match[1];
			console.log("Captured Workflow ID:", workflowId);
		} else {
			throw new Error(`Failed to extract workflow ID from URL: ${currentUrl}`);
		}
		
		// The newly created workflow is named "New workflow" by default. Let's rename it so we can easily find it later.
		workflowTitle = `E2E Walk ${Date.now()}`;
		console.log("Renaming new workflow to:", workflowTitle);
		
		// Let's screenshot after landing
		await page.screenshot({ path: path.join(artifactsDir, "02_builder_blank_draft.png") });
		console.log("Saved: 02_builder_blank_draft.png");

		// 3. Add a section, add a step, and click "Configure step" in the footer
		console.log("Step 3: Adding section and step");
		await page.locator("aside").getByRole("button", { name: "Add section" }).click();
		// Wait for section to be created and "Add step" button to appear
		const addStepBtn = page.locator("aside").getByRole("button", { name: "Add step" }).first();
		await expect(addStepBtn).toBeVisible({ timeout: 10000 });
		await addStepBtn.click();

		// Wait for the new "Untitled step" row in left rail and click it
		const stepRow = page.locator("aside").locator("button").filter({ hasText: "Untitled step" }).first();
		await expect(stepRow).toBeVisible({ timeout: 10000 });
		await stepRow.click();

		// Click "Configure step" button in center panel footer
		const configStepBtn = page.locator("section").getByRole("button", { name: "Configure step" });
		await expect(configStepBtn).toBeVisible({ timeout: 10000 });
		await configStepBtn.click();

		// Expect config panel to slide in
		await expect(page.getByRole("heading", { name: "Step settings" })).toBeVisible({ timeout: 10000 });
		await page.screenshot({ path: path.join(artifactsDir, "03_step_settings_open.png") });
		console.log("Saved: 03_step_settings_open.png");

		// 4. In assignee role picker: create "Operator" role inline and select it
		console.log("Step 4: Creating assignee role 'Operator' inline...");
		// Check if we click "Create your first role" or "New role" depending on seed state
		const inlineRoleBtn = page.locator("aside").locator("button").filter({ hasText: /New role|Create your first role/ }).first();
		await inlineRoleBtn.click();

		const roleInput = page.locator("input[placeholder='Role name…']");
		await expect(roleInput).toBeVisible();
		await roleInput.fill("Operator");
		await roleInput.press("Enter");

		// Role should auto-select and input should collapse
		await expect(roleInput).toBeHidden({ timeout: 10000 });
		// Role select trigger should now show "Operator"
		const roleSelectTrigger = page.locator("button").filter({ hasText: "Operator" }).first();
		await expect(roleSelectTrigger).toBeVisible();
		await page.screenshot({ path: path.join(artifactsDir, "04_role_assigned.png") });
		console.log("Saved: 04_role_assigned.png");

		// 5. Close config panel, select "Kickoff form" in left rail, and add kickoff field
		console.log("Step 5: Closing config, selecting 'Kickoff form' rail entry, and adding kickoff field via UI...");
		await page.getByRole("button", { name: "Close settings" }).click();
		await expect(page.getByRole("heading", { name: "Step settings" })).toBeHidden();

		// Click the "Kickoff form" entry in the left rail
		await page.getByRole("button", { name: "Kickoff form" }).click();

		// Verify the center editor swaps to the KickoffPanel (heading "Kickoff form" visible)
		await expect(page.getByRole("heading", { name: "Kickoff form", exact: true })).toBeVisible({ timeout: 10000 });

		// Click "Add your first kickoff field" (zero-state copy)
		await page.getByRole("button", { name: "Add your first kickoff field" }).click();

		// In the newly-rendered row, fill the label input with Customer name, blur
		const labelInput = page.locator("input[placeholder='Field label']").first();
		await labelInput.fill("Customer name");
		await labelInput.blur();

		// Click the row's Configure button
		const configureBtn = page.getByRole("button", { name: "Configure kickoff field Customer name" });
		await configureBtn.click();

		// In the Field settings slide-in, set key to customer_name, check Required, close settings
		await expect(page.getByRole("heading", { name: "Field settings" })).toBeVisible({ timeout: 10000 });

		const keyInput = page.locator("aside").locator("input").nth(1);
		await keyInput.fill("customer_name");
		await keyInput.blur();

		const requiredCheckbox = page.locator("aside").locator("input[type='checkbox']").first();
		await requiredCheckbox.click();

		await page.getByRole("button", { name: "Close settings" }).click();
		await expect(page.getByRole("heading", { name: "Field settings" })).toBeHidden();

		// Verify the row shows the customer_name key chip + Required checkbox is checked
		const keyBadge = page.locator("span", { hasText: "customer_name" }).first();
		await expect(keyBadge).toBeVisible({ timeout: 5000 });

		const rowDiv = page.locator("div").filter({ has: page.locator("input[value='Customer name']") }).first();
		const rowCheckbox = rowDiv.locator("input[type='checkbox']").first();
		await expect(rowCheckbox).toBeChecked();

		// Save screenshot as 05_kickoff_field_via_ui.png (No DB call. No reload.)
		await page.screenshot({ path: path.join(artifactsDir, "05_kickoff_field_via_ui.png") });
		console.log("Saved: 05_kickoff_field_via_ui.png");

		// Since we want the workflow title to be unique and searchable, let's rename the workflow in the draft via real Hono API PATCH call
		if (workflowId) {
			console.log("Updating workflow title to:", workflowTitle, "via real Hono API PATCH call...");
			await page.evaluate(async ({ workflowId, title }) => {
				const res = await fetch(`/api/workflows/${workflowId}`, {
					method: "PATCH",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({ workflowId, title }),
				});
				if (!res.ok) {
					throw new Error(`Failed to update workflow title: ${res.statusText}`);
				}
			}, { workflowId: workflowId!, title: workflowTitle });

			// Reload page to reflect title change
			await page.reload();
			await expect(page.locator("h1", { hasText: workflowTitle }).first()).toBeVisible({ timeout: 10000 });
		}

		// 6. Click "Publish" in the top bar
		console.log("Step 6: Publishing draft version...");
		const publishBtn = page.getByRole("button", { name: "Publish" });
		await publishBtn.click();

		// Wait for Publish to finish (button hides, version flips to Published v1)
		const editBtn = page.getByRole("button", { name: "Edit" });
		await expect(editBtn).toBeVisible({ timeout: 15000 });
		await expect(page.getByText("Published", { exact: true }).first()).toBeVisible();
		await expect(page.getByText("v1", { exact: true }).first()).toBeVisible();
		
		await page.screenshot({ path: path.join(artifactsDir, "06_version_published.png") });
		console.log("Saved: 06_version_published.png");

		// 7. Navigate back to /virn/library
		console.log("Step 7: Navigating back to Library...");
		await page.goto("/virn/library");
		await expect(page.getByRole("heading", { name: "Library", exact: true })).toBeVisible({ timeout: 15000 });

		// Verify the new workflow row appears with "Published v1" and "Run…" button
		const newWfRow = page.locator("li").filter({ hasText: workflowTitle }).first();
		await expect(newWfRow).toBeVisible();
		await expect(newWfRow.locator("span", { hasText: "Published" }).first()).toBeVisible();
		
		const newWfRunBtn = newWfRow.getByRole("button", { name: "Run…" });
		await expect(newWfRunBtn).toBeVisible();
		
		await page.screenshot({ path: path.join(artifactsDir, "07_library_with_new_workflow.png") });
		console.log("Saved: 07_library_with_new_workflow.png");

		// 8. Click "Run…"
		console.log("Step 8: Clicking Run… to open launcher drawer");
		await newWfRunBtn.click();

		// Drawer (~420px) should slide in from the right
		const launcherHeader = page.getByRole("heading", { name: `Launch ${workflowTitle}` });
		await expect(launcherHeader).toBeVisible({ timeout: 10000 });

		// Kickoff form (customer_name field) should be visible
		const customerNameLabel = page.locator("label", { hasText: "Customer name" }).first();
		await expect(customerNameLabel).toBeVisible();

		// Roles section showing "Operator" with the launching user pre-selected
		const roleLabel = page.locator("label", { hasText: "Operator" }).first();
		await expect(roleLabel).toBeVisible();
		
		const initiatorSelected = page.locator("button").filter({ hasText: "pgrennell@gmail.com" }).first();
		await expect(initiatorSelected).toBeVisible();

		await page.screenshot({ path: path.join(artifactsDir, "08_launcher_drawer_opened.png") });
		console.log("Saved: 08_launcher_drawer_opened.png");

		// 9. NEGATIVE PATH 1: leave customer_name empty. Click Launch. Expect: button is DISABLED
		console.log("Step 9: Testing Negative Path 1 (Empty kickoff submission blocked)");
		const launchBtn = page.getByRole("button", { name: "Launch", exact: true });
		await expect(launchBtn).toBeDisabled();
		await page.screenshot({ path: path.join(artifactsDir, "09_launch_button_disabled.png") });
		console.log("Saved: 09_launch_button_disabled.png");

		// 10. Fill customer_name = "Acme Corp" -> click Launch
		console.log("Step 10: Filling Customer name and launching the run");
		const kickoffInput = page.locator("div").filter({ has: page.locator("label", { hasText: "Customer name" }) }).locator("input");
		await kickoffInput.fill("Acme Corp");
		await kickoffInput.blur(); // Blur is crucial to save state in react-hook-form/onBlur

		// Expect Launch button is now enabled
		await expect(launchBtn).toBeEnabled();
		await launchBtn.click();

		// Expect redirect to /virn/runs/<runId>
		await page.waitForURL(/\/runs\/[a-zA-Z0-9_-]+/, { timeout: 25000 });
		const runUrl = page.url();
		console.log("Successfully launched run, redirected to:", runUrl);

		// Verify Run view shows:
		// - Workflow title (matches our E2E walk title)
		// - Step pending (active)
		await expect(page.locator("h1", { hasText: workflowTitle }).first()).toBeVisible({ timeout: 15000 });
		await expect(page.getByRole("heading", { name: "Untitled step" })).toBeVisible({ timeout: 10000 });
		
		const totalWallTime = Date.now() - startTimestamp;
		console.log("Total loop wall-time (steps 2-10 inclusive):", totalWallTime, "ms");

		await page.screenshot({ path: path.join(artifactsDir, "10_run_view_active.png") });
		console.log("Saved: 10_run_view_active.png");

		// 11. NEGATIVE PATH 2 (the integrity #1 probe)
		console.log("Step 11: Testing Negative Path 2 (Pinned versionId integrity check)");
		// Navigate back to library
		await page.goto("/virn/library");
		await expect(page.getByRole("heading", { name: "Library", exact: true })).toBeVisible({ timeout: 15000 });

		console.log("Navigating to builder to edit the published workflow and create a draft...");
		await page.goto(`/virn/library/workflows/${workflowId}/builder`);
		await expect(page.getByRole("button", { name: "Edit" })).toBeVisible({ timeout: 15000 });
		await page.getByRole("button", { name: "Edit" }).click();
		
		// Expect top bar status to flip to Draft
		await expect(page.locator("span", { hasText: "Draft" }).first()).toBeVisible({ timeout: 15000 });
		console.log("Draft successfully forked!");

		// Click the "Kickoff form" rail entry (not "Add field" on a step)
		console.log("Selecting 'Kickoff form' rail entry in draft...");
		await page.getByRole("button", { name: "Kickoff form" }).click();
		await expect(page.getByRole("heading", { name: "Kickoff form", exact: true })).toBeVisible({ timeout: 10000 });

		// Click "Add kickoff field" (since customer_name already exists, copy is "Add kickoff field")
		console.log("Adding another kickoff field via UI...");
		await page.getByRole("button", { name: "Add kickoff field" }).click();

		// Leave the new field with its default label Untitled kickoff field
		const secondFieldLabelInput = page.locator("input[placeholder='Field label']").last();
		await expect(secondFieldLabelInput).toHaveValue("Untitled kickoff field");

		// Do NOT publish.
		// Navigate back to library
		console.log("Navigating back to Library...");
		await page.goto("/virn/library");
		await expect(page.getByRole("heading", { name: "Library", exact: true })).toBeVisible({ timeout: 15000 });

		// Click "Run…" on the same workflow
		console.log("Clicking Run… on our workflow containing draft changes...");
		const finalWfRow = page.locator("li").filter({ hasText: workflowTitle }).first();
		await finalWfRow.getByRole("button", { name: "Run…" }).click();

		// Expect the launcher kickoff form shows ONLY "Customer name" (published), NOT the draft's "Untitled kickoff field"
		const finalLauncherHeader = page.getByRole("heading", { name: `Launch ${workflowTitle}` });
		await expect(finalLauncherHeader).toBeVisible({ timeout: 10000 });

		await expect(page.locator("label", { hasText: "Customer name" }).first()).toBeVisible();
		await expect(page.locator("label", { hasText: "Untitled kickoff field" }).first()).toBeHidden();
		console.log("Confirmed: Pinned versionId integrity check PASSES! Only published fields are shown in Launcher.");

		await page.screenshot({ path: path.join(artifactsDir, "11_launcher_integrity_verified.png") });
		console.log("Saved: 11_launcher_integrity_verified.png");
	});
});
