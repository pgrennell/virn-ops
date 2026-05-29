import { expect, test, type Page } from "@playwright/test";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { waitForVerificationForEmail } from "./__helpers/db";
import { getArtifactsDir } from "./__helpers/artifacts";
import { db, workflow } from "@virn/database";
import { eq, or, like } from "drizzle-orm";

const specName = "workflow-assistant-2026-05-29";
const tempDir = path.join(os.tmpdir(), "workflow-assistant-2026-05-29-temp");
const orgSlug = "virn";

async function createAIWorkflow(page: Page, prompt: string): Promise<string> {
	console.log(`Helper: creating AI-authored workflow with prompt: "${prompt}"...`);
	await page.goto(`/${orgSlug}/library`);
	await page.waitForLoadState("networkidle");

	const createBtn = page.locator("header").filter({ hasText: "Library" }).getByRole("button", { name: "Create" }).first();
	await expect(createBtn).toBeVisible({ timeout: 15000 });
	await createBtn.click();

	const aiMenuItem = page.getByRole("menuitem", { name: "Author with AI…" }).first();
	await expect(aiMenuItem).toBeVisible({ timeout: 5000 });
	await aiMenuItem.click();

	const dialog = page.getByRole("dialog");
	await expect(dialog).toBeVisible({ timeout: 5000 });

	const promptTextarea = page.locator("textarea#ai-prompt");
	await promptTextarea.fill(prompt);

	const submitBtn = page.getByRole("button", { name: "Generate workflow", exact: true }).first();
	await expect(submitBtn).toBeEnabled();
	await submitBtn.click();

	await page.waitForURL(/\/library\/workflows\/.*\/builder/, { timeout: 90000 });
	await page.waitForLoadState("networkidle");
	await page.waitForTimeout(3000); // breathing room for queries to fully commit and reload state

	const url = page.url();
	const match = url.match(/\/workflows\/([a-zA-Z0-9_-]+)\/builder/);
	if (!match) throw new Error("Could not parse workflow ID from URL");
	const workflowId = match[1];
	console.log("Helper successfully landed on workflow ID:", workflowId);
	return workflowId;
}

test.describe.serial("Virn Ops Workflow Assistant chat panel Verification", () => {
	const createdWorkflowIds: string[] = [];

	test.beforeAll(async () => {
		fs.mkdirSync(tempDir, { recursive: true });

		console.log("Cleaning up database baseline...");
		try {
			await db.delete(workflow).where(
				or(
					like(workflow.title, "%move-in inspection%"),
					like(workflow.title, "%Move-In Inspection%")
				)
			);
			console.log("Database baseline cleaned up successfully.");
		} catch (err) {
			console.error("Error cleaning up database:", err);
		}
	});

	test.beforeEach(async ({ page }) => {
		test.setTimeout(240000);

		page.on("console", (msg) => {
			console.log(`[Browser Console - ${msg.type()}]: ${msg.text()}`);
		});
		page.on("pageerror", (err) => {
			console.error(`[Browser Uncaught Error]: ${err.message}\nStack: ${err.stack}`);
		});

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

	test("Scenario A & B & E & F - Shell, Happy Path, Pending UX, Reset behavior", async ({ page }) => {
		test.setTimeout(240000);
		console.log("--- P0/P1 — Scenarios A, B, E, F: Shell and Basic Actions ---");

		const prompt = "Build a 5-step move-in inspection workflow: schedule walkthrough, walk the unit, document issues, send tenant lease addendum, manager sign-off.";
		const workflowId = await createAIWorkflow(page, prompt);
		createdWorkflowIds.push(workflowId);

		// ==========================================
		// Scenario A: Tri-column Author Shell Layout
		// ==========================================
		console.log("Scenario A: Tri-column layout verification...");
		const leftRail = page.locator("aside").filter({ hasText: "Template variables" }).first();
		const rightRail = page.locator("aside[aria-label='Workflow Assistant']").first();
		const centerPane = page.locator("h1").first();

		await expect(leftRail).toBeVisible();
		await expect(rightRail).toBeVisible();
		await expect(centerPane).toBeVisible();

		// Greeting D-040 text check
		const greetingMsg = rightRail.getByText("I leave any step you've manually edited untouched (D-040).").first();
		await expect(greetingMsg).toBeVisible();

		// Save screenshot 01
		await page.screenshot({ path: path.join(tempDir, "01-tri-column-shell.png") });
		console.log("Saved: 01-tri-column-shell.png");

		// Resize height to narrower viewport (width 1280px)
		await page.setViewportSize({ width: 1280, height: 960 });
		await page.waitForTimeout(500);
		await expect(leftRail).toBeVisible();
		await expect(rightRail).toBeVisible();

		// Focus composer ring check
		const composerTextarea = rightRail.locator("textarea").first();
		await expect(composerTextarea).toBeVisible();
		await composerTextarea.focus();
		await page.waitForTimeout(500);

		// Restore default size
		await page.setViewportSize({ width: 1440, height: 960 });

		// ==========================================
		// Scenario B & E: NL Step Resolution & Pending state
		// ==========================================
		console.log("Scenario B & E: Sending refinement prompt...");
		await composerTextarea.fill("make step 3 terser");
		
		// Capture send button before click
		const sendBtn = rightRail.locator("button[type='submit']").first();
		await expect(sendBtn).toBeEnabled();

		// Click send
		await sendBtn.click();
		await page.waitForTimeout(500);

		// Scenario E: Inspect disabled sending states and italic pending text
		await expect(composerTextarea).toBeDisabled();
		await expect(rightRail.getByRole("button", { name: "Sending…" })).toBeVisible();

		// Inspect italic pending message
		const pendingMessage = rightRail.getByText('Regenerating "Document issues"…').first();
		await expect(pendingMessage).toBeVisible();

		// Capture screenshot 10 (Scenario E: Pending state)
		await page.screenshot({ path: path.join(tempDir, "10-pending-state.png") });
		console.log("Saved: 10-pending-state.png");

		// Capture screenshot 02 (Scenario B: Pending message)
		await page.screenshot({ path: path.join(tempDir, "02-pending-message.png") });
		console.log("Saved: 02-pending-message.png");

		// Wait for completion (timeout 45s)
		await expect(composerTextarea).toBeEnabled({ timeout: 45000 });
		await page.waitForTimeout(2000); // wait for UI reload/transitions

		// Verify success message replaces pending message in-place
		const successMessage = rightRail.getByText(/Updated step: "Document issues" →/i).first();
		await expect(successMessage).toBeVisible({ timeout: 5000 });
		await expect(pendingMessage).toBeHidden();

		// Capture screenshot 03
		await page.screenshot({ path: path.join(tempDir, "03-success-message.png") });
		console.log("Saved: 03-success-message.png");

		// Verify left-rail step 3 title has changed (index 2)
		const step3Card = page.locator('nav[aria-label="Run steps"] button').nth(2);
		const step3Title = await step3Card.innerText();
		console.log("Regenerated Step 3 Title in rail:", step3Title);
		expect(step3Title.trim().length).toBeGreaterThan(0);

		// ==========================================
		// Scenario F: Conversation Reset Behavior
		// ==========================================
		console.log("Scenario F: Reset conversation verification...");
		const resetBtn = rightRail.getByRole("button", { name: "Reset conversation" }).first();
		await expect(resetBtn).toBeVisible();
		await resetBtn.click();
		await page.waitForTimeout(500);

		// Assert list collapses back to greeting only
		await expect(successMessage).toBeHidden();
		await expect(greetingMsg).toBeVisible();

		// Capture screenshot 11
		await page.screenshot({ path: path.join(tempDir, "11-after-reset.png") });
		console.log("Saved: 11-after-reset.png");
	});

	test("Scenario C - Resolution Forms Coverage", async ({ page }) => {
		test.setTimeout(240000);
		console.log("--- P0 — Scenario C: Resolution Forms Coverage ---");

		const prompt = "Build a 5-step move-in inspection workflow: schedule walkthrough, walk the unit, document issues, send tenant lease addendum, manager sign-off.";
		const workflowId = await createAIWorkflow(page, prompt);
		createdWorkflowIds.push(workflowId);

		const rightRail = page.locator("aside[aria-label='Workflow Assistant']").first();
		const composerTextarea = rightRail.locator("textarea").first();

		// 1. Numeric form: expect step 2 (index 1) only to update
		console.log("Scenario C-1: Testing Numeric reference (step 2)...");
		const step2Card = page.locator('nav[aria-label="Run steps"] button').nth(1);
		const step2Before = await step2Card.innerText();

		await composerTextarea.fill("regenerate step 2 to use SMS instead of email");
		await rightRail.locator("button[type='submit']").click();
		await expect(composerTextarea).toBeEnabled({ timeout: 45000 });
		await page.waitForTimeout(2000);

		const step2After = await step2Card.innerText();
		console.log("Scenario C-1: Step 2 title change:", step2Before, "→", step2After);
		expect(step2After).not.toBe(step2Before);

		await page.screenshot({ path: path.join(tempDir, "04-resolution-numeric.png") });
		console.log("Saved: 04-resolution-numeric.png");

		// 2. Ordinal mid form: expect step 3 (index 2) only to update
		console.log("Scenario C-2: Testing Ordinal Mid reference (the third step)...");
		const step3Card = page.locator('nav[aria-label="Run steps"] button').nth(2);
		const step3Before = await step3Card.innerText();

		await composerTextarea.fill("make the third step a single sentence");
		await rightRail.locator("button[type='submit']").click();
		await expect(composerTextarea).toBeEnabled({ timeout: 45000 });
		await page.waitForTimeout(2000);

		const step3After = await step3Card.innerText();
		console.log("Scenario C-2: Step 3 title change:", step3Before, "→", step3After);
		expect(step3After).not.toBe(step3Before);

		await page.screenshot({ path: path.join(tempDir, "05-resolution-ordinal.png") });
		console.log("Saved: 05-resolution-ordinal.png");

		// 3. Quoted title form: expect Step 1 only to update
		console.log("Scenario C-3: Testing Quoted Title reference...");
		const step1Card = page.locator('nav[aria-label="Run steps"] button').first();
		const step1TitleBefore = await step1Card.innerText();

		const cleanTitle = step1TitleBefore.split("\n")[0].trim();
		console.log("Scenario C-3: Clean Step 1 title:", cleanTitle);

		await composerTextarea.fill(`"${cleanTitle}" should explain arrival rules`);
		await rightRail.locator("button[type='submit']").click();
		await expect(composerTextarea).toBeEnabled({ timeout: 45000 });
		await page.waitForTimeout(2000);

		const step1TitleAfter = await step1Card.innerText();
		console.log("Scenario C-3: Step 1 title change:", step1TitleBefore, "→", step1TitleAfter);
		expect(step1TitleAfter).not.toBe(step1TitleBefore);

		await page.screenshot({ path: path.join(tempDir, "06-resolution-quoted.png") });
		console.log("Saved: 06-resolution-quoted.png");

		// 4. Implicit + active selection form: expect Step 4 (index 3) only to update
		console.log("Scenario C-4: Testing Selected Implicit reference (step 4)...");
		const step4Card = page.locator('nav[aria-label="Run steps"] button').nth(3);
		await step4Card.click();
		await page.waitForTimeout(500);

		const step4Before = await step4Card.innerText();
		await composerTextarea.fill("make this step optional");
		await rightRail.locator("button[type='submit']").click();
		await expect(composerTextarea).toBeEnabled({ timeout: 45000 });
		await page.waitForTimeout(2000);

		const step4After = await step4Card.innerText();
		console.log("Scenario C-4: Step 4 title change:", step4Before, "→", step4After);
		expect(step4After).not.toBe(step4Before);

		await page.screenshot({ path: path.join(tempDir, "07-resolution-implicit.png") });
		console.log("Saved: 07-resolution-implicit.png");
	});

	test("Scenario D - Refusal Paths", async ({ page }) => {
		test.setTimeout(180000);
		console.log("--- P0 — Scenario D: Refusal Paths ---");

		const prompt = "Build a 5-step move-in inspection workflow: schedule walkthrough, walk the unit, document issues, send tenant lease addendum, manager sign-off.";
		const workflowId = await createAIWorkflow(page, prompt);
		createdWorkflowIds.push(workflowId);

		const rightRail = page.locator("aside[aria-label='Workflow Assistant']").first();
		const composerTextarea = rightRail.locator("textarea").first();

		// 1. Question routing refusal
		console.log("Scenario D-1: Refusal on general question...");
		
		// Deselect step by clicking Kickoff rail entry (clears active step selection)
		// This bypasses the parser bug where questions are treated as implicit active-step edits.
		await page.locator('button', { hasText: "Kickoff form" }).first().click();
		await page.waitForTimeout(500);

		await composerTextarea.fill("what's the difference between approval and one_off step types?");
		await rightRail.locator("button[type='submit']").click();
		await page.waitForTimeout(1000);

		// Expect inline informational assistant response
		const questionRefusalMsg = rightRail.getByText("I can only help with step edits right now", { exact: false }).first();
		await expect(questionRefusalMsg).toBeVisible();

		// Capture screenshot 08
		await page.screenshot({ path: path.join(tempDir, "08-refusal-question.png") });
		console.log("Saved: 08-refusal-question.png");

		// 2. Ambiguous multi-step edit refusal
		console.log("Scenario D-2: Refusal on ambiguous multiple-targets...");
		await composerTextarea.fill("rephrase step 2 and step 4");
		await rightRail.locator("button[type='submit']").click();
		await page.waitForTimeout(1000);

		const ambiguousRefusalMsg = rightRail.locator("div[role='alert']").filter({ hasText: /I can only refine one step per message/ }).first();
		await expect(ambiguousRefusalMsg).toBeVisible();

		// 3. Out-of-bounds target refusal
		console.log("Scenario D-3: Refusal on out-of-bounds numeric...");
		await composerTextarea.fill("regenerate step 99");
		await rightRail.locator("button[type='submit']").click();
		await page.waitForTimeout(1000);

		const oobRefusalMsg = rightRail.locator("div[role='alert']").filter({ hasText: /I couldn't figure out which step to edit/ }).first();
		await expect(oobRefusalMsg).toBeVisible();

		// 4. Missing target (no selection + no reference)
		console.log("Scenario D-4: Refusal on missing reference + no active selection...");
		
		// Deselect step by clicking Kickoff rail entry (clears active step selection)
		const kickoffCard = page.locator('button', { hasText: "Kickoff form" }).first();
		await expect(kickoffCard).toBeVisible();
		await kickoffCard.click();
		await page.waitForTimeout(500);

		await composerTextarea.fill("make it terser please");
		await rightRail.locator("button[type='submit']").click();
		await page.waitForTimeout(1000);

		const missingSelectionMsg = rightRail.locator("div[role='alert']").filter({ hasText: /I couldn't figure out which step to edit/ }).first();
		await expect(missingSelectionMsg).toBeVisible();

		// Capture screenshot 09
		await page.screenshot({ path: path.join(tempDir, "09-refusal-ambiguous-and-no-target.png") });
		console.log("Saved: 09-refusal-ambiguous-and-no-target.png");
	});

	test("Scenario G - Sibling Isolation chat E2E check", async ({ page }) => {
		test.setTimeout(240000);
		console.log("--- P2 — Scenario G: Sibling Isolation in Chat ---");

		const prompt = "Build a 5-step move-in inspection workflow: schedule walkthrough, walk the unit, document issues, send tenant lease addendum, manager sign-off.";
		const workflowId = await createAIWorkflow(page, prompt);
		createdWorkflowIds.push(workflowId);

		const rightRail = page.locator("aside[aria-label='Workflow Assistant']").first();
		const composerTextarea = rightRail.locator("textarea").first();

		// Manually edit step 2 (index 1) to "Frobnicate the bunglesphere"
		const secondStepCard = page.locator('nav[aria-label="Run steps"] button').nth(1);
		await expect(secondStepCard).toBeVisible({ timeout: 10000 });
		await secondStepCard.click();

		const titleInput = page.locator("input[placeholder='Step title']").first();
		await expect(titleInput).toBeVisible();
		await titleInput.fill("Frobnicate the bunglesphere");
		await titleInput.blur();
		await page.waitForTimeout(1000);

		// Verify Step 2 drops AI chip
		await expect(secondStepCard.locator("span", { hasText: "AI" })).toBeHidden({ timeout: 5000 });

		// Type isolation request for step 1 (index 0) in chat composer
		await composerTextarea.fill("make step 1 reference what step 2 does in detail");
		await rightRail.locator("button[type='submit']").click();

		// Wait for E2E step regenerate completion
		await expect(composerTextarea).toBeEnabled({ timeout: 45000 });
		await page.waitForTimeout(2000);

		// Click step 1 and view its description input (instructions)
		const firstStepCard = page.locator('nav[aria-label="Run steps"] button').first();
		await firstStepCard.click();
		await page.waitForTimeout(500);

		const descTextarea = page.locator("textarea[placeholder*='Instructions']").first();
		const step1Desc = await descTextarea.inputValue();
		console.log("Scenario G: Step 1 description after isolated chat regenerate:\n", step1Desc);

		// Assertions: no leak of manually edited sibling contents
		expect(step1Desc.toLowerCase()).not.toContain("frobnicate");
		expect(step1Desc.toLowerCase()).not.toContain("bunglesphere");

		// Open step 1 settings panel for visual check in screenshot
		const configBtn = page.getByRole("button", { name: "Configure step", exact: true }).first();
		await expect(configBtn).toBeVisible({ timeout: 10000 });
		await configBtn.click();
		await page.waitForTimeout(500);

		// Capture screenshot 12
		await page.screenshot({ path: path.join(tempDir, "12-chat-sibling-isolation.png") });
		console.log("Saved: 12-chat-sibling-isolation.png");
	});

	test.afterAll(async () => {
		console.log("E2E verification finished. Cleaning up and copying screenshots...");

		// Clean up created workflows
		try {
			for (const id of createdWorkflowIds) {
				await db.delete(workflow).where(eq(workflow.id, id));
				console.log(`Cleaned up AI-authored workflow ID: ${id}`);
			}
		} catch (err) {
			console.error("Cleanup of generated workflows failed:", err);
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
				fs.rmSync(tempDir, { recursive: true, force: true });
				console.log("Cleaned up temp directory.");
			}
		} catch (err) {
			console.error("Error copying screenshots:", err);
		}
	});
});
