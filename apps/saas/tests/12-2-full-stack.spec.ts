import { expect, test } from "@playwright/test";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { waitForVerificationForEmail } from "./__helpers/db";
import { getArtifactsDir } from "./__helpers/artifacts";
import { db, workflow, workflowVersion, step, field, run, runStep, fieldValue } from "@virn/database";
import { eq, like, or, and } from "drizzle-orm";

const tempDir = path.join(os.tmpdir(), "virn-dogfood-12-2");
const artifactsDir = tempDir;

test.describe("Virn Ops Phase 12.2 Full-Stack E2E Dogfood Walkthrough", () => {
	let orgSlug = "virn";
	let aiWorkflowId: string | null = null;
	let handWorkflowId: string | null = null;

	test.beforeAll(async () => {
		// Ensure temp directory exists
		fs.mkdirSync(tempDir, { recursive: true });

		console.log("Cleaning up database baseline for Phase 12.2 E2E walkthrough...");
		try {
			// Clean up any old E2E workflows containing "Move-In Inspection" or "E2E Hand-Auth dueType"
			await db.delete(workflow).where(
				or(
					like(workflow.title, "%Move-In Inspection%"),
					like(workflow.title, "%E2E Hand-Auth dueType%")
				)
			);
			console.log("Database baseline cleaned up successfully.");
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

	test("Execute Phase 12.2 Walkthrough", async ({ page }) => {
		test.setTimeout(240000); // 4 minutes

		// ==========================================
		// P0 — A: AI Authoring with new dueType palette
		// ==========================================
		console.log("--- P0 — A: AI Authoring ---");
		await page.goto(`/${orgSlug}/library`);
		await page.waitForLoadState("networkidle");

		// Open "+ Create" menu in the page header specifically
		const createBtn = page.locator("header").filter({ hasText: "Library" }).getByRole("button", { name: "Create" }).first();
		await expect(createBtn).toBeVisible({ timeout: 10000 });
		await createBtn.click();

		// Click "Author with AI…"
		const aiMenuItem = page.getByRole("menuitem", { name: "Author with AI…" }).first();
		await expect(aiMenuItem).toBeVisible({ timeout: 5000 });
		await aiMenuItem.click();

		// Verify dialog appears
		const dialog = page.getByRole("dialog");
		await expect(dialog).toBeVisible({ timeout: 5000 });
		await expect(page.getByRole("heading", { name: "Author with AI", exact: true })).toBeVisible();

		// Fill prompt
		const promptTextarea = page.locator("textarea#ai-prompt");
		const prompt = "Build a move-in inspection workflow for property managers. The kickoff should capture the move-in date. Then: schedule walkthrough (due 3 days before move-in), inspect the unit (due the day before move-in), tenant signs lease addendum (after walkthrough completes), and finally a manager sign-off (due 1 day after the lease addendum step completes).";
		await promptTextarea.fill(prompt);

		// Click generate
		const submitBtn = page.getByRole("button", { name: "Generate workflow", exact: true }).first();
		await expect(submitBtn).toBeEnabled();
		await submitBtn.click();

		// Wait for redirect to Builder (up to 90s)
		console.log("Waiting for AI workflow generation to redirect to Builder...");
		await page.waitForURL(/\/library\/workflows\/.*\/builder/, { timeout: 90000 });
		console.log("Redirected to Builder successfully!");

		// Capture workflow ID from URL
		const currentUrl = page.url();
		const match = currentUrl.match(/\/workflows\/([a-zA-Z0-9_-]+)\/builder/);
		if (match) {
			aiWorkflowId = match[1];
			console.log(`Created AI Workflow ID: ${aiWorkflowId}`);
		}

		await page.waitForLoadState("networkidle");
		await page.waitForTimeout(3000); // Wait for hydration

		// Capture screenshot 01-ai-walkthrough-builder-landed.png
		await page.screenshot({ path: path.join(artifactsDir, "01-ai-walkthrough-builder-landed.png") });
		console.log("Saved: 01-ai-walkthrough-builder-landed.png");

		// Fetch workflow and versions from DB to verify constraints
		expect(aiWorkflowId).not.toBeNull();
		const versions = await db.select().from(workflowVersion).where(eq(workflowVersion.workflowId, aiWorkflowId!));
		const activeVerId = versions[0].id;

		const steps = await db.select().from(step).where(eq(step.workflowVersionId, activeVerId));
		const fields = await db.select().from(field).where(eq(field.workflowVersionId, activeVerId));

		console.log("Steps from DB:", steps.map(s => ({ title: s.title, dueType: s.dueType, dueOffsetDays: s.dueOffsetDays })));
		console.log("Fields from DB:", fields.map(f => ({ label: f.label, key: f.key, type: f.fieldType })));

		// Verify kickoff date field exists
		const kickoffDateField = fields.find(f => f.stepId === null && f.fieldType === "date");
		expect(kickoffDateField).toBeDefined();

		// Verify step dueTypes: at least one from_date_field and at least one offset_from_step
		const fromDateFieldStep = steps.find(s => s.dueType === "from_date_field");
		const offsetFromStepStep = steps.find(s => s.dueType === "offset_from_step");

		expect(fromDateFieldStep).toBeDefined();
		expect(offsetFromStepStep).toBeDefined();

		// Verify negative offset for kickoff date reference step
		expect(fromDateFieldStep?.dueOffsetDays).toBeLessThan(0);

		// ==========================================
		// P0 — B: Builder due-rule configuration (hand-authored)
		// ==========================================
		console.log("--- P0 — B: Builder due-rule configuration ---");
		await page.goto(`/${orgSlug}/library`);
		await page.waitForLoadState("networkidle");

		// Click Create -> Workflow
		const headerCreateBtn = page.locator("header").filter({ hasText: "Library" }).getByRole("button", { name: "Create" }).first();
		await expect(headerCreateBtn).toBeVisible({ timeout: 10000 });
		await headerCreateBtn.click();

		await page.getByRole("menuitem", { name: "New workflow" }).click();
		await page.waitForURL(/\/library\/workflows\/.*\/builder/, { timeout: 15000 });
		
		const handUrl = page.url();
		handWorkflowId = handUrl.match(/\/workflows\/([a-zA-Z0-9_-]+)\/builder/)![1];
		console.log("Created hand-authored workflow:", handWorkflowId);

		// Rename workflow via Drizzle so it doesn't pollute title search
		const handWfTitle = `E2E Hand-Auth dueType ${Date.now()}`;
		await db.update(workflow).set({ title: handWfTitle }).where(eq(workflow.id, handWorkflowId));
		await page.reload();
		await page.waitForLoadState("networkidle");
		await expect(page.locator("h1", { hasText: handWfTitle }).first()).toBeVisible({ timeout: 15000 });

		// Add section and steps
		await page.locator("aside").getByRole("button", { name: "Add section" }).click();
		await expect(page.locator("aside").getByRole("button", { name: "Add step" }).first()).toBeVisible({ timeout: 10000 });

		await page.locator("aside").getByRole("button", { name: "Add step" }).first().click();
		await page.waitForTimeout(1000);
		await page.locator("aside").getByRole("button", { name: "Add step" }).first().click();
		await page.waitForTimeout(1000);
		await page.locator("aside").getByRole("button", { name: "Add step" }).first().click();
		await page.waitForTimeout(1000);

		// Rename step 1 to "Step A"
		await page.locator("aside button").filter({ hasText: "Untitled step" }).first().click();
		await page.locator("input[placeholder='Step title']").fill("Step A");
		await page.locator("input[placeholder='Step title']").blur();
		await page.waitForTimeout(1000);

		// Rename step 2 to "Step B"
		await page.locator("aside button").filter({ hasText: "Untitled step" }).first().click();
		await page.locator("input[placeholder='Step title']").fill("Step B");
		await page.locator("input[placeholder='Step title']").blur();
		await page.waitForTimeout(1000);

		// Rename step 3 to "Step C"
		await page.locator("aside button").filter({ hasText: "Untitled step" }).first().click();
		await page.locator("input[placeholder='Step title']").fill("Step C");
		await page.locator("input[placeholder='Step title']").blur();
		await page.waitForTimeout(1000);

		// Add kickoff field "arrival_date" of type date
		await page.getByRole("button", { name: "Kickoff form" }).click();
		await page.getByRole("button", { name: "Add your first kickoff field" }).click();
		const kickoffLabelInput = page.locator("input[placeholder='Field label']").first();
		await kickoffLabelInput.fill("arrival_date");
		await kickoffLabelInput.blur();
		await page.waitForTimeout(1500); // Wait for auto-slugging of key

		// Open kickoff field config and set type to Date
		await page.getByRole("button", { name: "Configure kickoff field arrival_date" }).click();
		await page.locator("section:has-text('Type') button").click();
		await page.getByRole("option", { name: "Date" }).first().click();
		await page.getByRole("button", { name: "Close settings" }).click();

		// Configure Step B: offset_from_step, anchor=Step A, offset=2
		await page.locator("aside button").filter({ hasText: "Step B" }).first().click();
		await page.locator("section").getByRole("button", { name: "Configure step" }).click();

		await page.locator("section:has-text('Due rule') button").first().click();
		await page.getByRole("option", { name: "Days after another step completes" }).first().click();

		// Capture screenshot 02-step-b-anchor-picker.png
		await page.screenshot({ path: path.join(artifactsDir, "02-step-b-anchor-picker.png") });
		console.log("Saved: 02-step-b-anchor-picker.png");

		await page.getByRole("button", { name: "Pick an anchor step…" }).first().click();
		await page.getByRole("option", { name: "Step A" }).first().click();

		await page.locator("input[type='number']").first().fill("2");
		await page.locator("input[type='number']").first().blur();
		await page.getByRole("button", { name: "Close settings" }).click();

		// Configure Step C: from_date_field, source=arrival_date, offset=-1
		await page.locator("aside button").filter({ hasText: "Step C" }).first().click();
		await page.locator("section").getByRole("button", { name: "Configure step" }).click();

		await page.locator("section:has-text('Due rule') button").first().click();
		await page.getByRole("option", { name: "From a date field's value" }).first().click();

		// Capture screenshot 03-step-c-source-picker.png
		await page.screenshot({ path: path.join(artifactsDir, "03-step-c-source-picker.png") });
		console.log("Saved: 03-step-c-source-picker.png");

		await page.getByRole("button", { name: "Pick a date field…" }).first().click();
		await page.getByRole("option", { name: /arrival_date/ }).first().click();

		await page.locator("input[type='number']").first().fill("-1");
		await page.locator("input[type='number']").first().blur();
		await page.getByRole("button", { name: "Close settings" }).click();

		// Capture screenshot 04-sidebar-chips.png
		await page.screenshot({ path: path.join(artifactsDir, "04-sidebar-chips.png") });
		console.log("Saved: 04-sidebar-chips.png");

		// Verify sidebar due chip text
		const stepBChip = page.locator("nav[aria-label='Run steps'] button").filter({ hasText: "Step B" }).locator("span.text-foreground\\/55");
		const stepCChip = page.locator("nav[aria-label='Run steps'] button").filter({ hasText: "Step C" }).locator("span.text-foreground\\/55");

		await expect(stepBChip).toHaveText("due 2d after Step A");
		await expect(stepCChip).toHaveText("due 1d before {{arrival_date}}");

		// Edge Cases on Step B
		await page.locator("aside button").filter({ hasText: "Step B" }).first().click();
		await page.locator("section").getByRole("button", { name: "Configure step" }).click();

		// 8. On Step B, switch dueType to "Days after the run starts"
		await page.locator("section:has-text('Due rule') button").first().click();
		await page.getByRole("option", { name: "Days after the run starts" }).first().click();
		await expect(stepBChip).toHaveText("due 2d after launch");

		// 9. Switch back to offset_from_step. Verify anchor selection is CLEARED (normalize-duePatch)
		await page.locator("section:has-text('Due rule') button").first().click();
		await page.getByRole("option", { name: "Days after another step completes" }).first().click();
		await expect(stepBChip).toHaveText("due rule incomplete");

		// Re-pick Step A anchor
		await page.getByRole("button", { name: "Pick an anchor step…" }).first().click();
		await page.getByRole("option", { name: "Step A" }).first().click();

		// 10. Try to clear offset input. Verify it lands on 0 (empty-string-to-zero)
		const offsetInput = page.locator("input[type='number']").first();
		await offsetInput.focus();
		await page.keyboard.press("Control+A");
		await page.keyboard.press("Backspace");
		await offsetInput.blur();
		await page.waitForTimeout(1000);

		await expect(offsetInput).toHaveValue("0");
		await expect(stepBChip).toHaveText("due on Step A");

		// Set Step B back to offset=2 for Scenario E
		await offsetInput.fill("2");
		await offsetInput.blur();
		await page.waitForTimeout(1000);
		await expect(stepBChip).toHaveText("due 2d after Step A");

		await page.getByRole("button", { name: "Close settings" }).click();

		// ==========================================
		// P0 — C: Position-ordering refusal paths
		// ==========================================
		console.log("--- P0 — C: Position-ordering refusal paths ---");
		// Add steps Foo and Bar
		await page.locator("aside").getByRole("button", { name: "Add step" }).first().click();
		await page.waitForTimeout(1000);
		await page.locator("aside").getByRole("button", { name: "Add step" }).first().click();
		await page.waitForTimeout(1000);

		await page.locator("aside button").filter({ hasText: "Untitled step" }).first().click();
		await page.locator("input[placeholder='Step title']").fill("Foo");
		await page.locator("input[placeholder='Step title']").blur();
		await page.waitForTimeout(1000);

		await page.locator("aside button").filter({ hasText: "Untitled step" }).first().click();
		await page.locator("input[placeholder='Step title']").fill("Bar");
		await page.locator("input[placeholder='Step title']").blur();
		await page.waitForTimeout(1000);

		// Add date field lease_start to Foo
		await page.locator("aside button").filter({ hasText: "Foo" }).first().click();
		await page.getByRole("button", { name: "Add field" }).click();
		const fieldLabelInput = page.locator("input[placeholder='Field label']").first();
		await fieldLabelInput.fill("lease_start");
		await fieldLabelInput.blur();
		await page.waitForTimeout(1500);

		await page.getByRole("button", { name: "Configure field lease_start" }).first().click();
		await page.locator("section:has-text('Type') button").click();
		await page.getByRole("option", { name: "Date" }).first().click();
		await page.getByRole("button", { name: "Close settings" }).click();

		// Configure Bar's due rule: dueType=from_date_field, source=lease_start
		await page.locator("aside button").filter({ hasText: "Bar" }).first().click();
		await page.locator("section").getByRole("button", { name: "Configure step" }).click();

		await page.locator("section:has-text('Due rule') button").first().click();
		await page.getByRole("option", { name: "From a date field's value" }).first().click();

		await page.getByRole("button", { name: "Pick a date field…" }).first().click();
		await page.getByRole("option", { name: /lease_start/ }).first().click();
		await page.getByRole("button", { name: "Close settings" }).click();

		// Reorder: Bar before Foo
		const barBtn = page.locator("nav[aria-label='Run steps'] button").filter({ hasText: "Bar" }).first();
		const fooBtn = page.locator("nav[aria-label='Run steps'] button").filter({ hasText: "Foo" }).first();
		await barBtn.dragTo(fooBtn);
		await page.waitForTimeout(2000); // Wait for sync

		// Open Bar's config and capture stale/unavailable picker
		await page.locator("aside button").filter({ hasText: "Bar" }).first().click();
		await page.locator("section").getByRole("button", { name: "Configure step" }).click();

		// Capture screenshot 05-position-reorder-stale-state.png
		await page.screenshot({ path: path.join(artifactsDir, "05-position-reorder-stale-state.png") });
		console.log("Saved: 05-position-reorder-stale-state.png");
		await page.getByRole("button", { name: "Close settings" }).click();

		// Direct oRPC trigger of position-refusal error DUE_SOURCE_STEP_NOT_EARLIER
		const handVersions = await db.select().from(workflowVersion).where(eq(workflowVersion.workflowId, handWorkflowId!));
		const handVerId = handVersions[0].id;

		const dbSteps = await db.select().from(step).where(eq(step.workflowVersionId, handVerId));
		const dbFields = await db.select().from(field).where(eq(field.workflowVersionId, handVerId));

		const fooStep = dbSteps.find(s => s.title === "Foo")!;
		const barStep = dbSteps.find(s => s.title === "Bar")!;
		const leaseStartField = dbFields.find(f => f.key === "lease_start")!;

		const patchRes = await page.evaluate(async ({ stepId, dueSourceFieldId }) => {
			const res = await fetch(`/api/rpc/workflows/steps/${stepId}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					stepId,
					dueType: "from_date_field",
					dueSourceFieldId
				})
			});
			return { status: res.status, json: await res.json().catch(() => null) };
		}, { stepId: barStep.id, dueSourceFieldId: leaseStartField.id });

		console.log("Direct update result:", patchRes);
		expect(patchRes.status).toBeGreaterThanOrEqual(400);
		expect(patchRes.json?.data?.code).toBe("DUE_SOURCE_STEP_NOT_EARLIER");

		// Clean up Foo and Bar from database so the published workflow remains Step A -> Step B -> Step C
		console.log("Cleaning up Foo/Bar steps from DB to keep published version clean...");
		await db.delete(step).where(or(eq(step.id, fooStep.id), eq(step.id, barStep.id)));
		await page.reload();
		await page.waitForLoadState("networkidle");

		// ==========================================
		// P0 — D: Field-type change guard (FIELD_TYPE_CHANGE_LOCKED)
		// ==========================================
		console.log("--- P0 — D: Field-type change guard ---");
		// Open arrival_date's config
		await page.getByRole("button", { name: "Kickoff form" }).click();
		await page.getByRole("button", { name: "Configure kickoff field arrival_date" }).click();

		// Try to change type to text
		await page.locator("section:has-text('Type') button").click();
		await page.getByRole("option", { name: "Text" }).first().click();

		// Verify Alert: "Type change refused -- clear these references first: step due-rule"
		const alert = page.locator("div[role='alert']");
		await expect(alert).toContainText("Type change refused -- clear these references first: step due-rule");

		// Capture screenshot 06-field-type-locked.png
		await page.screenshot({ path: path.join(artifactsDir, "06-field-type-locked.png") });
		console.log("Saved: 06-field-type-locked.png");
		await page.getByRole("button", { name: "Close settings" }).click();

		// Open Step C settings and set dueType to none
		await page.locator("aside button").filter({ hasText: "Step C" }).first().click();
		await page.locator("section").getByRole("button", { name: "Configure step" }).click();
		await page.locator("section:has-text('Due rule') button").first().click();
		await page.getByRole("option", { name: "No due rule" }).first().click();
		await page.getByRole("button", { name: "Close settings" }).click();

		// Re-open arrival_date config and successfully change to text
		await page.getByRole("button", { name: "Kickoff form" }).click();
		await page.getByRole("button", { name: "Configure kickoff field arrival_date" }).click();
		await page.locator("section:has-text('Type') button").click();
		await page.getByRole("option", { name: "Text" }).first().click();
		await expect(alert).toBeHidden();
		console.log("Field type successfully changed to Text after clearing reference!");

		// Restore baseline: change type back to Date, re-configure Step C due rule to -1 arrival_date
		await page.locator("section:has-text('Type') button").click();
		await page.getByRole("option", { name: "Date" }).first().click();
		await page.getByRole("button", { name: "Close settings" }).click();

		await page.locator("aside button").filter({ hasText: "Step C" }).first().click();
		await page.locator("section").getByRole("button", { name: "Configure step" }).click();
		await page.locator("section:has-text('Due rule') button").first().click();
		await page.getByRole("option", { name: "From a date field's value" }).first().click();
		await page.getByRole("button", { name: "Pick a date field…" }).first().click();
		await page.getByRole("option", { name: /arrival_date/ }).first().click();
		await page.locator("input[type='number']").first().fill("-1");
		await page.locator("input[type='number']").first().blur();
		await page.getByRole("button", { name: "Close settings" }).click();
		await page.waitForTimeout(1000);

		// ==========================================
		// P1 — E: Runtime recompute (run engine)
		// ==========================================
		console.log("--- P1 — E: Runtime recompute ---");
		// Publish the workflow
		await page.getByRole("button", { name: "Publish" }).click();
		await expect(page.getByRole("button", { name: "Edit" })).toBeVisible({ timeout: 15000 });

		// Go to Library
		await page.goto(`/${orgSlug}/library`);
		await page.waitForLoadState("networkidle");

		// Find our workflow row and click Run...
		const wfRow = page.locator("li").filter({ hasText: handWfTitle }).first();
		await wfRow.getByRole("button", { name: "Run…" }).click();

		// Launcher drawer opens. Fill arrival_date kickoff field with 2 weeks from today: 2026-06-11
		const kickoffInput = page.locator("input[type='date']").first();
		await expect(kickoffInput).toBeVisible({ timeout: 10000 });
		await kickoffInput.fill("2026-06-11");
		await kickoffInput.blur();

		const launchBtn = page.getByRole("button", { name: "Launch", exact: true });
		await expect(launchBtn).toBeEnabled();
		await launchBtn.click();

		// Wait for redirect to /runs/<runId>
		await page.waitForURL(/\/runs\/[a-zA-Z0-9_-]+/, { timeout: 25000 });
		const runUrl = page.url();
		const runId = runUrl.match(/\/runs\/([a-zA-Z0-9_-]+)/)![1];
		console.log("Launched run successfully! ID:", runId);

		// Verify due dates
		// Step A: no due date
		await page.locator("nav[aria-label='Run steps'] button").filter({ hasText: "Step A" }).first().click();
		await expect(page.locator("section").locator("span", { hasText: /due/ })).toBeHidden();

		// Step B: no due date
		await page.locator("nav[aria-label='Run steps'] button").filter({ hasText: "Step B" }).first().click();
		await expect(page.locator("section").locator("span", { hasText: /due/ })).toBeHidden();

		// Step C: due Jun 10 (1 day before June 11)
		await page.locator("nav[aria-label='Run steps'] button").filter({ hasText: "Step C" }).first().click();
		const stepCMetaSpan = page.locator("section").locator("span", { hasText: /due/ }).first();
		await expect(stepCMetaSpan).toBeVisible();
		await expect(stepCMetaSpan).toContainText("due Jun 10");

		// Complete Step A
		await page.locator("nav[aria-label='Run steps'] button").filter({ hasText: "Step A" }).first().click();
		const completeStepBtn = page.getByRole("button", { name: "Complete step", exact: true });
		await expect(completeStepBtn).toBeEnabled();
		await completeStepBtn.click();
		await expect(page.locator("p", { hasText: "Completed. Field values above are now read-only." })).toBeVisible({ timeout: 10000 });

		// Reload run view to let recompute hook sync
		await page.reload();
		await page.waitForLoadState("networkidle");

		// Click Step B. Verify it has due date: May 30 (today + 2 days)
		await page.locator("nav[aria-label='Run steps'] button").filter({ hasText: "Step B" }).first().click();
		const stepBMetaSpan = page.locator("section").locator("span", { hasText: /due/ }).first();
		await expect(stepBMetaSpan).toBeVisible();
		await expect(stepBMetaSpan).toContainText("due May 30");

		// Capture screenshot 07-run-after-step-a-complete.png
		await page.screenshot({ path: path.join(artifactsDir, "07-run-after-step-a-complete.png") });
		console.log("Saved: 07-run-after-step-a-complete.png");

		// ==========================================
		// P1 — F: setFieldValue recompute (admin kickoff edit)
		// ==========================================
		console.log("--- P1 — F: setFieldValue recompute ---");
		// Directly call setFieldValue API for kickoff field arrival_date: set to 2026-06-18
		const setValRes = await page.evaluate(async ({ runId, value }) => {
			const res = await fetch("/api/rpc/runs/field-value", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					runStepId: null,
					runId,
					fieldKey: "arrival_date",
					value
				})
			});
			return { status: res.status, json: await res.json().catch(() => null) };
		}, { runId, value: "2026-06-18" });

		console.log("Kickoff field update result:", setValRes);
		expect(setValRes.status).toBe(200);

		// Reload page and check Step C's due date updates to June 17
		await page.reload();
		await page.waitForLoadState("networkidle");

		await page.locator("nav[aria-label='Run steps'] button").filter({ hasText: "Step C" }).first().click();
		await expect(stepCMetaSpan).toBeVisible();
		await expect(stepCMetaSpan).toContainText("due Jun 17");

		// Capture screenshot 08-kickoff-edit-recompute.png
		await page.screenshot({ path: path.join(artifactsDir, "08-kickoff-edit-recompute.png") });
		console.log("Saved: 08-kickoff-edit-recompute.png");

		// ==========================================
		// P1 — G: Cascade-to-run-complete (the tx fix)
		// ==========================================
		console.log("--- P1 — G: Cascade-to-run-complete ---");
		// Complete Step B
		await page.locator("nav[aria-label='Run steps'] button").filter({ hasText: "Step B" }).first().click();
		await expect(completeStepBtn).toBeEnabled();
		await completeStepBtn.click();
		await expect(page.locator("p", { hasText: "Completed. Field values above are now read-only." })).toBeVisible({ timeout: 10000 });

		// Complete Step C
		await page.locator("nav[aria-label='Run steps'] button").filter({ hasText: "Step C" }).first().click();
		await expect(completeStepBtn).toBeEnabled();
		await completeStepBtn.click();
		await expect(page.locator("p", { hasText: "Completed. Field values above are now read-only." })).toBeVisible({ timeout: 10000 });

		// Verify overall run status is 'completed' in the run header
		const statusBadge = page.locator("div.px-4.py-3.border-b.border-border span").filter({ hasText: "Completed" }).first();
		await expect(statusBadge).toBeVisible({ timeout: 15000 });
		console.log("Run successfully transitioned to Completed!");

		// Capture screenshot 09-run-completed.png
		await page.screenshot({ path: path.join(artifactsDir, "09-run-completed.png") });
		console.log("Saved: 09-run-completed.png");

		// ==========================================
		// P1 — H: AI chip rendering (Library + Builder header)
		// ==========================================
		console.log("--- P1 — H: AI chip rendering ---");
		// Visit Library `/virn/library`
		await page.goto(`/${orgSlug}/library`);
		await page.waitForLoadState("networkidle");

		// Verify AI workflow title from Scenario A has the AI sparkles chip next to its row
		const aiWorkflow = await db.query.workflow.findFirst({
			where: eq(workflow.id, aiWorkflowId!)
		});
		expect(aiWorkflow).toBeDefined();

		const aiWfRow = page.locator("li").filter({ hasText: aiWorkflow!.title }).first();
		await expect(aiWfRow).toBeVisible();

		const libraryAiChip = aiWfRow.locator("span", { hasText: "AI" }).first();
		await expect(libraryAiChip).toBeVisible();
		await libraryAiChip.hover();

		// Capture screenshot 10-library-row-ai-chip.png
		await page.screenshot({ path: path.join(artifactsDir, "10-library-row-ai-chip.png") });
		console.log("Saved: 10-library-row-ai-chip.png");

		// Go into AI workflow builder
		await aiWfRow.getByRole("button", { name: "Continue editing" }).click();
		await page.waitForURL(/\/library\/workflows\/.*\/builder/, { timeout: 15000 });
		
		const builderAiChip = page.locator("span", { hasText: "AI-authored" }).first();
		await expect(builderAiChip).toBeVisible();

		// Capture screenshot 11-builder-header-ai-chip.png
		await page.screenshot({ path: path.join(artifactsDir, "11-builder-header-ai-chip.png") });
		console.log("Saved: 11-builder-header-ai-chip.png");

		// ==========================================
		// P2 — I: Server-side error paths via direct API
		// ==========================================
		console.log("--- P2 — I: Server-side error paths via direct API ---");
		
		// 1. self-anchor
		const err1 = await page.evaluate(async ({ stepId }) => {
			const res = await fetch(`/api/rpc/workflows/steps/${stepId}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					stepId,
					dueType: "offset_from_step",
					dueAnchorStepId: stepId
				})
			});
			return await res.json().catch(() => null);
		}, { stepId: barStep.id });
		console.log("Error 1 (Self Anchor):", err1);
		expect(err1?.data?.code).toBe("DUE_ANCHOR_SELF_REFERENCE");

		// 2. anchor later-step (Foo is later than Bar since we reordered Bar before Foo)
		const err2 = await page.evaluate(async ({ stepId, dueAnchorStepId }) => {
			const res = await fetch(`/api/rpc/workflows/steps/${stepId}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					stepId,
					dueType: "offset_from_step",
					dueAnchorStepId
				})
			});
			return await res.json().catch(() => null);
		}, { stepId: barStep.id, dueAnchorStepId: fooStep.id });
		console.log("Error 2 (Anchor Later):", err2);
		expect(err2?.data?.code).toBe("DUE_ANCHOR_NOT_EARLIER");

		// 3. non-date source field
		// Create a text field on Bar
		const createFieldRes = await page.evaluate(async ({ workflowVersionId, stepId }) => {
			const res = await fetch("/api/rpc/workflows/fields", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					workflowVersionId,
					stepId,
					label: "text_dummy",
					fieldType: "text"
				})
			});
			return await res.json().catch(() => null);
		}, { workflowVersionId: handVerId, stepId: barStep.id });

		// Query the newly created text field
		const dummyTextField = await db.query.field.findFirst({
			where: (f, { eq, and }) => and(eq(f.workflowVersionId, handVerId), eq(f.key, "text_dummy"))
		});
		expect(dummyTextField).toBeDefined();

		const err3 = await page.evaluate(async ({ stepId, dueSourceFieldId }) => {
			const res = await fetch(`/api/rpc/workflows/steps/${stepId}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					stepId,
					dueType: "from_date_field",
					dueSourceFieldId
				})
			});
			return await res.json().catch(() => null);
		}, { stepId: barStep.id, dueSourceFieldId: dummyTextField!.id });
		console.log("Error 3 (Non-Date Source):", err3);
		expect(err3?.data?.code).toBe("DUE_SOURCE_FIELD_NOT_DATE");

		// 4. referenced-date field type change text (using leaseStartField which was referenced by Bar)
		// Wait, we deleted Foo and Bar from the step table, but leaseStartField is still in the field table since step deletion cascades fields?
		// Yes, step deletion cascade deletes fields associated with it! So leaseStartField was cascade-deleted.
		// Let's use `arrival_date` field (which is referenced by Step C's due rule in handVerId version)
		const handFields = await db.select().from(field).where(eq(field.workflowVersionId, handVerId));
		const arrivalDateField = handFields.find(f => f.key === "arrival_date")!;

		const err4 = await page.evaluate(async ({ fieldId }) => {
			const res = await fetch(`/api/rpc/workflows/fields/${fieldId}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					fieldId,
					fieldType: "text"
				})
			});
			return await res.json().catch(() => null);
		}, { fieldId: arrivalDateField.id });
		console.log("Error 4 (Field Type Locked):", err4);
		expect(err4?.data?.code).toBe("FIELD_TYPE_CHANGE_LOCKED");
	});

	test.afterAll(async () => {
		console.log(" E2E Walkthrough finished. Cleaning up templates...");

		// Clean up created AI workflow template
		if (aiWorkflowId) {
			try {
				await db.delete(workflow).where(eq(workflow.id, aiWorkflowId));
				console.log(`Successfully cleaned up AI workflow: ${aiWorkflowId}`);
			} catch (err) {
				console.error("Failed to clean up AI workflow:", err);
			}
		}

		// Clean up created hand-authored workflow template
		if (handWorkflowId) {
			try {
				await db.delete(workflow).where(eq(workflow.id, handWorkflowId));
				console.log(`Successfully cleaned up hand-authored workflow: ${handWorkflowId}`);
			} catch (err) {
				console.error("Failed to clean up hand-authored workflow:", err);
			}
		}

		// Copy screenshots to final reviews/12-2-dogfood directory
		try {
			const finalDir = getArtifactsDir("12-2-dogfood");
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
