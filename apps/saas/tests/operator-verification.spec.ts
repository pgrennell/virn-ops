import { expect, test } from "@playwright/test";
import * as path from "node:path";
import { waitForVerificationForEmail } from "./__helpers/db";
import { getArtifactsDir } from "./__helpers/artifacts";

const artifactsDir = getArtifactsDir("operator-verification");

test.describe("Virn Ops Operator-Screen Foundation Walkthrough E2E", () => {

	test.beforeEach(async ({ page }) => {
		test.setTimeout(90000); // Allow ample time for Windows cold starts and database transactions

		page.on("console", (msg) => {
			console.log(`[Browser Console - ${msg.type()}]: ${msg.text()}`);
		});
		page.on("pageerror", (err) => {
			console.error(`[Browser Uncaught Error]: ${err.message}\nStack: ${err.stack}`);
		});

		// Authenticate via the Magic Link UI + DB token bypass flow
		console.log("Authenticating assignee (pgrennell@gmail.com) via Magic Link UI + DB token resolution...");
		await page.goto("/login");

		// Switch to magic link mode
		await page.getByRole("tab", { name: "Magic link" }).click();

		// Fill email
		await page.getByRole("textbox", { name: /email/i }).fill("pgrennell@gmail.com");

		// Click Send magic link
		await page.getByRole("button", { name: "Send magic link" }).click();

		// Wait for success alert or Link Sent message
		const successAlert = page.locator("div").filter({ hasText: "Link sent" }).first();
		await expect(successAlert).toBeVisible({ timeout: 10000 });

		// Query database for latest token using direct database helper
		console.log("Waiting for magic link token in DB...");
		const row = await waitForVerificationForEmail("pgrennell@gmail.com");
		const token = row.value;

		// Navigate to verify-magic-link callback URL to write session cookie and land on My Work
		const callbackUrl = `http://localhost:3000/api/auth/magic-link/verify?token=${token}&callbackURL=http://localhost:3000/virn/my-work`;
		await page.goto(callbackUrl);

		// Wait for landing on My Work page
		await expect(page.getByRole("heading", { name: "My work" })).toBeVisible({ timeout: 15000 });
		console.log("Authentication successful, on My Work page!");
	});

	test("Walkthrough Operator-Screen Loop", async ({ page }) => {
		test.setTimeout(120000); // 2 minutes to run all the sequential interactive walk steps
		console.log("Starting E2E Operator-Screen Walkthrough...");

		// Wait for loading to finish
		await expect(page.getByText("Nothing on your plate. Nice.")).toBeHidden({ timeout: 10000 });

		// --- 1. My Work renders ---
		console.log("Verifying step 1: My Work renders...");
		const step1Row = page.locator("div").filter({ hasText: "Collect signed agreement" }).first();
		const step2Row = page.locator("div").filter({ hasText: "Provision accounts" }).first();
		const step3Row = page.locator("div").filter({ hasText: "Send welcome packet" }).first();

		await expect(step1Row).toBeVisible();
		await expect(step2Row).toBeVisible();
		await expect(step3Row).toBeVisible();

		// Check Lock icon on Step 2 (blocked by dependency)
		const step2Lock = step2Row.locator("button[aria-label='Blocked']").first();
		await expect(step2Lock).toBeVisible();

		// Ensure Optional pill is NOT in MyTaskRow (since optional is only visible in Run view)
		const optionalPillInMyWork = step3Row.getByText("Optional");
		await expect(optionalPillInMyWork).toBeHidden();

		// Capture My Work initial screenshot
		await page.screenshot({ path: path.join(artifactsDir, "01_my_work_initial.png") });
		console.log("Saved: 01_my_work_initial.png");

		// --- 2. Required-field refusal in My Work ---
		console.log("Verifying step 2: Required-field refusal in My Work...");
		const step1Checkbox = step1Row.locator("button[aria-label='Mark complete']").first();
		await step1Checkbox.click();

		// Expect a toast saying "Required fields missing"
		const toast = page.getByText("Required fields missing");
		await expect(toast).toBeVisible({ timeout: 10000 });
		const openTaskBtn = page.getByRole("button", { name: "Open task" });
		await expect(openTaskBtn).toBeVisible();

		// --- 3. Deep-link ---
		console.log("Verifying step 3: Deep-link...");
		await openTaskBtn.click();

		// Expect URL transitions to runs view with step query parameter
		await expect(page).toHaveURL(/\/runs\/.*step=.*/);
		console.log("URL transitioned successfully to Run step detail view:", page.url());

		// Wait for landing on Run view
		await expect(page.getByRole("heading", { name: "Collect signed agreement" })).toBeVisible({ timeout: 10000 });

		// --- 4. Run view renders ---
		console.log("Verifying step 4: Run view renders...");
		// Header title starts with "[Demo] Onboarding" and status "ACTIVE"
		await expect(page.locator("span", { hasText: "ACTIVE" })).toBeVisible();
		await expect(page.getByText("0 of 3 steps")).toBeVisible();

		// Left aside
		const aside = page.locator("aside");
		await expect(aside.getByText("Collect signed agreement")).toBeVisible();
		await expect(aside.locator("button").filter({ hasText: "Provision accounts" }).locator("svg.lucide-lock")).toBeVisible();
		await expect(aside.locator("button").filter({ hasText: "Send welcome packet" }).getByText("Optional", { exact: true })).toBeVisible();

		// Center pane
		const panel = page.locator("section");
		await expect(panel.getByRole("heading", { name: "Collect signed agreement" })).toBeVisible();
		await expect(panel.getByText("assigned to you")).toBeVisible();
		await expect(panel.getByText("Get the signed agreement on file")).toBeVisible();
		
		const refNumberLabel = panel.locator("label", { hasText: "Reference number" });
		await expect(refNumberLabel).toBeVisible();
		await expect(refNumberLabel.locator("span.text-destructive", { hasText: "*" })).toBeVisible();

		// Screenshot of initial Run view
		await page.screenshot({ path: path.join(artifactsDir, "02_run_view_initial.png") });
		console.log("Saved: 02_run_view_initial.png");

		// --- 5. Save badge ---
		console.log("Verifying step 5: Save badge...");
		const refInput = panel.locator("input");
		await expect(refInput).toBeVisible();
		await refInput.fill("REF-998877");
		
		// Blur the input
		await refInput.blur();

		// Expect the Saving -> Saved indicator to appear next to the label
		const savingIndicator = panel.getByText("Saving");
		const savedIndicator = panel.getByText("Saved");

		// Since save completes fast, await at least the "Saved" badge to be visible
		await expect(savedIndicator).toBeVisible({ timeout: 5000 });
		
		// Capture screenshot of Saved badge
		await page.screenshot({ path: path.join(artifactsDir, "03_saved_badge.png") });
		console.log("Saved: 03_saved_badge.png");

		// Wait for Saved badge to fade away (returns to idle/hidden)
		await expect(savedIndicator).toBeHidden({ timeout: 5000 });

		// --- 6. Stop-task unlock ---
		console.log("Verifying step 6: Stop-task unlock...");
		const completeStepBtn = page.getByRole("button", { name: "Complete step" });
		await completeStepBtn.click();

		// Run view refetches
		// Step 1 card in left list transitions to green check
		await expect(aside.locator("button").filter({ hasText: "Collect signed agreement" }).locator("svg.text-emerald-600")).toBeVisible({ timeout: 10000 });

		// Step 2 card Lock icon transitions to empty Circle
		await expect(aside.locator("button").filter({ hasText: "Provision accounts" }).locator("svg.lucide-circle")).toBeVisible();

		// Progress bar moves to "1 of 3 steps"
		await expect(page.getByText("1 of 3 steps")).toBeVisible();

		// Capture step 1 completed screenshot
		await page.screenshot({ path: path.join(artifactsDir, "04_step1_completed.png") });
		console.log("Saved: 04_step1_completed.png");

		// Click Step 2
		await aside.locator("button").filter({ hasText: "Provision accounts" }).click();

		// Center pane shows "Provision accounts" with multiselect
		await expect(panel.getByRole("heading", { name: "Provision accounts" })).toBeVisible();
		
		// Multiselect option: Pick "Slack"
		const slackOption = panel.getByRole("button", { name: "Slack" });
		await expect(slackOption).toBeVisible();
		await slackOption.click();

		// Multiselect immediate save: check "Saved" badge
		await expect(panel.getByText("Saved")).toBeVisible();
		await expect(panel.getByText("Saved")).toBeHidden({ timeout: 5000 });

		// --- 7 & 8. Cascade test & Progress-vs-completion coherence ---
		console.log("Verifying step 7 & 8: Cascade test & Progress coherence...");
		// Complete Step 2
		await page.getByRole("button", { name: "Complete step" }).click();

		// Expect Run completed cascade
		// Step 2 transitions to check mark
		await expect(aside.locator("button").filter({ hasText: "Provision accounts" }).locator("svg.text-emerald-600")).toBeVisible({ timeout: 10000 });

		// Run header status changes to blue "COMPLETED"
		await expect(page.locator("span", { hasText: "COMPLETED" })).toBeVisible();
		
		// Progress bar shows "2 of 3 steps"
		await expect(page.getByText("2 of 3 steps")).toBeVisible();

		// Click Step 3
		await aside.locator("button").filter({ hasText: "Send welcome packet" }).click();

		// Expect Complete step button is GONE, showingCompleted read-only footer note instead
		await expect.soft(page.getByRole("button", { name: "Complete step" })).toBeHidden();
		await expect.soft(page.getByText("Completed. Field values above are now read-only.")).toBeVisible();

		// Capture Completed run screenshot showing "2 of 3 steps · COMPLETED" and "Optional" pill
		await page.screenshot({ path: path.join(artifactsDir, "05_run_completed.png") });
		console.log("Saved: 05_run_completed.png");

		// --- 9. Return to My Work ---
		console.log("Verifying step 9: Return to My Work...");
		await page.goto("http://localhost:3000/virn/my-work");
		await expect(page.getByRole("heading", { name: "My work" })).toBeVisible({ timeout: 15000 });

		// Expect "To do" tab only shows Step 3
		const todoList = page.locator("[role='tabpanel'][data-state='active']");
		await expect(todoList).toContainText("Send welcome packet");
		await expect.soft(todoList).not.toContainText("Collect signed agreement");
		await expect.soft(todoList).not.toContainText("Provision accounts");

		// Count on To do tab trigger is "1"
		const todoTrigger = page.getByRole("tab", { name: /To do/ });
		await expect.soft(todoTrigger).toContainText("1");

		// Switch to Completed tab
		const completedTrigger = page.getByRole("tab", { name: "Completed" });
		await completedTrigger.click();

		// Expect Step 1 + Step 2 in Completed tab
		const completedList = page.locator("[role='tabpanel'][data-state='active']");
		await expect(completedList).toContainText("Collect signed agreement");
		await expect(completedList).toContainText("Provision accounts");

		// Capture My Work completed screenshot
		await page.screenshot({ path: path.join(artifactsDir, "06_my_work_completed.png") });
		console.log("Saved: 06_my_work_completed.png");

		// --- 10. Run view re-open while completed ---
		console.log("Verifying step 10: Run view re-open while completed...");
		// In Completed tab, click Step 1 row
		const step1CompletedRow = completedList.locator("button").filter({ hasText: "Collect signed agreement" }).first();
		await step1CompletedRow.click();

		// Expect Run view opens, Step 1 active as read-only
		await expect(page).toHaveURL(/\/runs\/.*/);
		await expect(page.getByRole("heading", { name: "Collect signed agreement" })).toBeVisible({ timeout: 15000 });
		await expect(page.getByRole("button", { name: "Complete step" })).toBeHidden();
		await expect(page.getByText("Completed. Field values above are now read-only.")).toBeVisible();

		// Capture final reopened completed screenshot
		await page.screenshot({ path: path.join(artifactsDir, "07_reopened_completed.png") });
		console.log("Saved: 07_reopened_completed.png");

		console.log("E2E Operator-Screen Walkthrough completed successfully!");
	});
});
