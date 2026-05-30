import { expect, test } from "@playwright/test";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { waitForVerificationForEmail } from "./__helpers/db";
import { getArtifactsDir } from "./__helpers/artifacts";
import { db, workflow } from "@virn/database";
import { eq, like } from "drizzle-orm";

const tempDir = path.join(os.tmpdir(), "virn-dogfood-12-1");
const artifactsDir = tempDir;

test.describe("Virn Ops Phase 12.1 AI Authoring Dogfood Walkthrough", () => {
	let orgSlug = "virn";
	let createdWorkflowId: string | null = null;

	test.beforeAll(async () => {
		// Ensure temp directory exists
		fs.mkdirSync(tempDir, { recursive: true });

		console.log("Cleaning up database baseline for AI authoring walkthrough...");
		try {
			// Clean up any old generated E2E workflows
			await db.delete(workflow).where(like(workflow.title, "%Mid-Stay Inspection%"));
			console.log("Cleaned up old workflows containing 'Mid-Stay Inspection'.");
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
		console.log("Logged in successfully via magic link!");
	});

	test("Execute Phase 12.1 AI Authoring Walkthrough", async ({ page }) => {
		test.setTimeout(240000); // 4 minutes

		// ==========================================
		// Section 1 — Library Page and Create Menu Open
		// ==========================================
		console.log("--- Section 1 — Library Page and Create Menu ---");
		await page.goto(`/${orgSlug}/library`);
		await page.waitForLoadState("load");

		// Open "+ Create" menu in the Library header specifically
		const createBtn = page.locator("header").filter({ hasText: "Library" }).getByRole("button", { name: "Create" }).first();
		await expect(createBtn).toBeVisible({ timeout: 10000 });
		await createBtn.click();

		// Verify "Author with AI…" is visible in menu
		const aiMenuItem = page.getByRole("menuitem", { name: "Author with AI…" }).first();
		await expect(aiMenuItem).toBeVisible({ timeout: 5000 });

		// Capture screenshot 01: menu open
		await page.screenshot({ path: path.join(artifactsDir, "01-library-create-menu-open.png") });
		console.log("Saved: 01-library-create-menu-open.png");

		// ==========================================
		// Section 2 — Dialog Open and Empty State
		// ==========================================
		console.log("--- Section 2 — Dialog Open and Empty State ---");
		await aiMenuItem.click();

		// Verify dialog appears
		const dialog = page.getByRole("dialog");
		await expect(dialog).toBeVisible({ timeout: 5000 });
		await expect(page.getByRole("heading", { name: "Author with AI", exact: true })).toBeVisible();

		// Verify empty inputs and disabled submit button
		const submitBtn = page.getByRole("button", { name: "Generate workflow", exact: true }).first();
		await expect(submitBtn).toBeDisabled();

		// Open collapsible section
		const detailsSummary = page.locator("summary").filter({ hasText: /Paste an/i }).first();
		await expect(detailsSummary).toBeVisible();
		await detailsSummary.click();

		// Verify source textarea is visible after expand
		const sourceTextarea = page.locator("textarea#ai-source");
		await expect(sourceTextarea).toBeVisible({ timeout: 3000 });

		// Capture screenshot 02: empty dialog state
		await page.screenshot({ path: path.join(artifactsDir, "02-dialog-open-empty.png") });
		console.log("Saved: 02-dialog-open-empty.png");

		// ==========================================
		// Section 3 — Validation check: short prompt
		// ==========================================
		console.log("--- Section 3 — Validation check: short prompt ---");
		const promptTextarea = page.locator("textarea#ai-prompt");
		await promptTextarea.fill("Hi");

		// Verify helper text and disabled submit
		const helperText = page.getByText("Add at least 6 more characters.");
		await expect(helperText).toBeVisible({ timeout: 3000 });
		await expect(submitBtn).toBeDisabled();

		// Capture screenshot 06: short prompt disabled state
		await page.screenshot({ path: path.join(artifactsDir, "06-dialog-short-prompt-disabled.png") });
		console.log("Saved: 06-dialog-short-prompt-disabled.png");

		// ==========================================
		// Section 4 — Realistic Prompt typed
		// ==========================================
		console.log("--- Section 4 — Realistic Prompt typed ---");
		const prompt = "Build a mid-stay inspection workflow for our short-term rental properties. It should kick off the day before each guest arrives and check three areas: kitchen, bathroom, and common areas. At each step the inspector takes photos and notes anything that needs attention. End with a manager approval before the next guest checks in.";
		await promptTextarea.fill(prompt);

		// Verify submit button is now enabled
		await expect(submitBtn).toBeEnabled();

		// Capture screenshot 03: prompt typed state
		await page.screenshot({ path: path.join(artifactsDir, "03-dialog-prompt-typed.png") });
		console.log("Saved: 03-dialog-prompt-typed.png");

		// ==========================================
		// Section 5 — Generating state (Best effort)
		// ==========================================
		console.log("--- Section 5 — Generating state ---");
		// Click generate and try to instantly capture generating state
		await submitBtn.click();
		
		try {
			// Best effort capture of the spinner / generating text
			await page.screenshot({ path: path.join(artifactsDir, "04-dialog-generating.png") });
			console.log("Saved: 04-dialog-generating.png (best effort)");
		} catch (err) {
			console.warn("Failed to capture 04-dialog-generating screenshot in time:", err);
		}

		// ==========================================
		// Section 6 — Land in Builder and Verify Structure
		// ==========================================
		console.log("--- Section 6 — Land in Builder and Verify Structure ---");
		// Wait for redirect to the Builder (up to 90 seconds for Claude + DB creation)
		await page.waitForURL(/\/library\/workflows\/.*\/builder/, { timeout: 90000 });
		console.log("Redirected to Builder successfully!");

		// Capture workflow ID from URL
		const currentUrl = page.url();
		const match = currentUrl.match(/\/workflows\/([a-zA-Z0-9_-]+)\/builder/);
		if (match) {
			createdWorkflowId = match[1];
			console.log(`Created Workflow ID: ${createdWorkflowId}`);
		}

		// Wait for canvas to load and spinner to disappear
		await page.waitForLoadState("load");
		await page.waitForTimeout(3000); // extra breathing room for React queries to complete hydration

		// Verify workflow title matches our request
		const titleEl = page.locator("h1").first();
		await expect(titleEl).toBeVisible({ timeout: 15000 });
		const titleText = await titleEl.innerText();
		console.log(`Generated Workflow Title: ${titleText}`);
		expect(titleText.toLowerCase()).toContain("inspection");

		// Verify sections and steps exist on the page
		// Let's check for step headings or step list in the sidebar canvas
		const sidebarSteps = page.locator("aside button");
		const stepCount = await sidebarSteps.count();
		console.log(`Steps in sidebar: ${stepCount}`);
		expect(stepCount).toBeGreaterThanOrEqual(2);

		// Capture screenshot 05: builder with draft workflow
		await page.screenshot({ path: path.join(artifactsDir, "05-builder-with-generated-draft.png") });
		console.log("Saved: 05-builder-with-generated-draft.png");
	});

	test.afterAll(async () => {
		console.log("AI authoring walkthrough finished. Cleaning up and copying screenshots...");
		
		// Clean up created workflow if any
		if (createdWorkflowId) {
			try {
				await db.delete(workflow).where(eq(workflow.id, createdWorkflowId));
				console.log(`Successfully cleaned up generated workflow: ${createdWorkflowId}`);
			} catch (err) {
				console.error(`Failed to clean up generated workflow: ${createdWorkflowId}`, err);
			}
		}

		try {
			const finalDir = getArtifactsDir("12-1-dogfood");
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
