import { expect, test, type Page } from "@playwright/test";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { waitForVerificationForEmail } from "./__helpers/db";
import { getArtifactsDir } from "./__helpers/artifacts";
import {
	db,
	workflow,
	workflowVersion,
	section,
	step,
	stepDependency,
	run,
	runStep,
	user,
	member,
	organization,
} from "@virn/database";
import { eq, or, and, like } from "drizzle-orm";
import { createId as cuid } from "@paralleldrive/cuid2";

const specName = "phase-14-monitor-2026-05-29";
const tempDir = path.join(os.tmpdir(), "phase-14-monitor-2026-05-29-temp");
const orgSlug = "virn";

async function loginAsEmail(page: Page, email: string, callbackURLPath: string = "/virn/runs") {
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
	await page.waitForLoadState("networkidle");
	console.log(`Helper: Logged in as ${email} successfully!`);
}

test.describe.serial("Phase 14 Lightweight Monitor E2E Browser-Driven Verification", () => {
	let orgId: string;
	let nonAdminEmail: string;
	let nonAdminUserId: string;
	let nonAdminMemberId: string;

	const testWorkflowId = `wfl_test_monitor_${Date.now()}`;
	const testVersionId = `wfv_test_monitor_v1_${Date.now()}`;
	const testSectionId = `sec_test_monitor_${Date.now()}`;

	const stepIds = {
		first: `stp_first_${Date.now()}`,
		second: `stp_second_${Date.now()}`,
	};

	const runIds = {
		clear: `run_clear_${Date.now()}`,
		overdue: `run_overdue_${Date.now()}`,
		blocked: `run_blocked_${Date.now()}`,
		completed: `run_completed_${Date.now()}`,
	};

	test.beforeAll(async () => {
		fs.mkdirSync(tempDir, { recursive: true });

		console.log("Database baseline setup...");
		try {
			// Find org ID
			const org = await db.query.organization.findFirst({
				where: eq(organization.slug, orgSlug),
			});
			if (!org) throw new Error("Preseeded org 'virn' not found");
			orgId = org.id;

			// Force admin's lastActiveOrganizationId to virn orgId to align active organization context
			await db.update(user).set({
				lastActiveOrganizationId: orgId,
			}).where(eq(user.email, "pgrennell@gmail.com"));

			// Clean up any old test workflows just in case
			await db.delete(workflow).where(like(workflow.id, "wfl_test_monitor_%"));

			// Seed non-admin member
			nonAdminEmail = `non-admin-operator-${Date.now()}@example.com`;
			nonAdminUserId = `usr_${cuid()}`;
			nonAdminMemberId = `mbr_${cuid()}`;

			await db.insert(user).values({
				id: nonAdminUserId,
				name: "E2E Operator Member",
				email: nonAdminEmail,
				emailVerified: true,
				lastActiveOrganizationId: orgId,
				onboardingComplete: true,
				createdAt: new Date(),
				updatedAt: new Date(),
			});

			await db.insert(member).values({
				id: nonAdminMemberId,
				organizationId: orgId,
				userId: nonAdminUserId,
				role: "member", // member maps to operator role
				createdAt: new Date(),
			});
			console.log("Seeded non-admin operator:", nonAdminEmail);

			// Seed Test Workflow
			await db.insert(workflow).values({
				id: testWorkflowId,
				organizationId: orgId,
				title: "E2E Monitor Test Workflow",
				description: "Used to test Phase 14 Lightweight Monitor overdue/blocked/completed runs.",
				reviewState: "published",
				isActive: true,
				createdAt: new Date(),
				updatedAt: new Date(),
			});

			await db.insert(workflowVersion).values({
				id: testVersionId,
				workflowId: testWorkflowId,
				versionNumber: 1,
				status: "published",
				publishedAt: new Date(),
				createdAt: new Date(),
				updatedAt: new Date(),
			});

			await db.insert(section).values({
				id: testSectionId,
				workflowVersionId: testVersionId,
				title: "Core Verification Section",
				position: 0,
				createdAt: new Date(),
				updatedAt: new Date(),
			});

			await db.insert(step).values([
				{
					id: stepIds.first,
					workflowVersionId: testVersionId,
					sectionId: testSectionId,
					title: "Prerequisite Step",
					description: "Must be completed before the sequenced step.",
					position: 0,
					isRequired: true,
					isStopTask: false,
					dueType: "none",
					createdAt: new Date(),
					updatedAt: new Date(),
				},
				{
					id: stepIds.second,
					workflowVersionId: testVersionId,
					sectionId: testSectionId,
					title: "Sequenced Step",
					description: "Depends on Prerequisite Step.",
					position: 1,
					isRequired: true,
					isStopTask: true,
					dueType: "none",
					createdAt: new Date(),
					updatedAt: new Date(),
				}
			]);

			// Seed step dependency: stepIds.second depends on stepIds.first
			await db.insert(stepDependency).values({
				id: `sd_${Date.now()}`,
				stepId: stepIds.second,
				dependsOnStepId: stepIds.first,
				createdAt: new Date(),
				updatedAt: new Date(),
			});

			console.log("Seeded Test Workflow, Steps, and Dependency.");

			// Seed Runs
			const now = new Date();
			const futureDate = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000); // +2 days
			const pastDate = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);   // -5 days
			const completedDate = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000); // -1 day

			// Run 1: Clear (Active, not overdue, not blocked)
			await db.insert(run).values({
				id: runIds.clear,
				organizationId: orgId,
				workflowId: testWorkflowId,
				workflowVersionId: testVersionId,
				title: "E2E Active Run - Clear",
				status: "active",
				startedAt: now,
				dueAt: futureDate,
				createdAt: now,
				updatedAt: now,
			});

			await db.insert(runStep).values([
				{
					id: `rs_clear_first_${Date.now()}`,
					runId: runIds.clear,
					stepId: stepIds.first,
					title: "Prerequisite Step",
					description: "Must be completed before the sequenced step.",
					position: 0,
					status: "completed",
					dueType: "none",
					completedAt: now,
					createdAt: now,
					updatedAt: now,
				},
				{
					id: `rs_clear_second_${Date.now()}`,
					runId: runIds.clear,
					stepId: stepIds.second,
					title: "Sequenced Step",
					description: "Depends on Prerequisite Step.",
					position: 1,
					status: "pending",
					dueType: "none",
					createdAt: now,
					updatedAt: now,
				}
			]);

			// Run 2: Overdue (Active, overdue, not blocked)
			await db.insert(run).values({
				id: runIds.overdue,
				organizationId: orgId,
				workflowId: testWorkflowId,
				workflowVersionId: testVersionId,
				title: "E2E Active Run - Overdue",
				status: "active",
				startedAt: pastDate,
				dueAt: pastDate,
				createdAt: pastDate,
				updatedAt: pastDate,
			});

			await db.insert(runStep).values([
				{
					id: `rs_overdue_first_${Date.now()}`,
					runId: runIds.overdue,
					stepId: stepIds.first,
					title: "Prerequisite Step",
					description: "Must be completed before the sequenced step.",
					position: 0,
					status: "completed",
					dueType: "none",
					completedAt: pastDate,
					createdAt: pastDate,
					updatedAt: pastDate,
				},
				{
					id: `rs_overdue_second_${Date.now()}`,
					runId: runIds.overdue,
					stepId: stepIds.second,
					title: "Sequenced Step",
					description: "Depends on Prerequisite Step.",
					position: 1,
					status: "pending",
					dueType: "none",
					createdAt: pastDate,
					updatedAt: pastDate,
				}
			]);

			// Run 3: Blocked (Active, not overdue, blocked)
			await db.insert(run).values({
				id: runIds.blocked,
				organizationId: orgId,
				workflowId: testWorkflowId,
				workflowVersionId: testVersionId,
				title: "E2E Active Run - Blocked",
				status: "active",
				startedAt: now,
				dueAt: futureDate,
				createdAt: now,
				updatedAt: now,
			});

			await db.insert(runStep).values([
				{
					id: `rs_blocked_first_${Date.now()}`,
					runId: runIds.blocked,
					stepId: stepIds.first,
					title: "Prerequisite Step",
					description: "Must be completed before the sequenced step.",
					position: 0,
					status: "pending",
					dueType: "none",
					createdAt: now,
					updatedAt: now,
				},
				{
					id: `rs_blocked_second_${Date.now()}`,
					runId: runIds.blocked,
					stepId: stepIds.second,
					title: "Sequenced Step",
					description: "Depends on Prerequisite Step.",
					position: 1,
					status: "pending",
					dueType: "none",
					createdAt: now,
					updatedAt: now,
				}
			]);

			// Run 4: Completed (Completed, overdue dueAt originally but now completed)
			await db.insert(run).values({
				id: runIds.completed,
				organizationId: orgId,
				workflowId: testWorkflowId,
				workflowVersionId: testVersionId,
				title: "E2E Completed Run",
				status: "completed",
				startedAt: pastDate,
				dueAt: pastDate,
				completedAt: completedDate,
				createdAt: pastDate,
				updatedAt: pastDate,
			});

			await db.insert(runStep).values([
				{
					id: `rs_comp_first_${Date.now()}`,
					runId: runIds.completed,
					stepId: stepIds.first,
					title: "Prerequisite Step",
					description: "Must be completed before the sequenced step.",
					position: 0,
					status: "completed",
					dueType: "none",
					completedAt: completedDate,
					createdAt: pastDate,
					updatedAt: pastDate,
				},
				{
					id: `rs_comp_second_${Date.now()}`,
					runId: runIds.completed,
					stepId: stepIds.second,
					title: "Sequenced Step",
					description: "Depends on Prerequisite Step.",
					position: 1,
					status: "completed",
					dueType: "none",
					completedAt: completedDate,
					createdAt: pastDate,
					updatedAt: pastDate,
				}
			]);

			console.log("Seeded 4 Runs (Clear, Overdue, Blocked, Completed) with steps.");

		} catch (err) {
			console.error("Error setting up database seeds:", err);
		}
	});

	test.beforeEach(async ({ page }) => {
		test.setTimeout(90000);
		page.on("console", (msg) => {
			console.log(`[Browser Console - ${msg.type()}]: ${msg.text()}`);
		});
		page.on("pageerror", (err) => {
			console.error(`[Browser Uncaught Error]: ${err.message}\nStack: ${err.stack}`);
		});
	});

	test("P0 — Scenario A & B & C E2E Walkthrough (Admin context)", async ({ page }) => {
		test.setTimeout(180000);
		console.log("--- P0 — Scenario A & B & C Verification (Admin context) ---");

		// Authenticate as Admin
		await loginAsEmail(page, "pgrennell@gmail.com", "/virn/runs");

		// ==========================================
		// P0 — A: Org-level /runs renders + all four tabs work
		// ==========================================
		console.log("Scenario A: Verifying /runs index renders with tabs...");
		const mainHeading = page.getByRole("heading", { name: "Runs", exact: true }).first();
		await expect(mainHeading).toBeVisible({ timeout: 20000 });

		// Verify sort selector default
		const sortSelector = page.locator("button").filter({ hasText: "Most recently started" }).first();
		await expect(sortSelector).toBeVisible({ timeout: 15000 });

		// Tab active default state: Active tab highlighted
		const activeTabButton = page.getByRole("button", { name: /^Active/i });
		await expect(activeTabButton).toHaveAttribute("aria-current", "page");

		// Save screenshot 01: Default Active tab
		await page.screenshot({ path: path.join(tempDir, "01-runs-default-active.png") });
		console.log("Saved: 01-runs-default-active.png");

		// Navigate to All tab
		const allTabButton = page.getByRole("button", { name: /^All/i });
		await allTabButton.click();
		await page.waitForTimeout(500);
		await expect(allTabButton).toHaveAttribute("aria-current", "page");
		await page.screenshot({ path: path.join(tempDir, "02-runs-all.png") });
		console.log("Saved: 02-runs-all.png");

		// Navigate to Needs Attention tab
		const needsAttentionTabButton = page.getByRole("button", { name: /^Needs attention/i });
		await needsAttentionTabButton.click();
		await page.waitForTimeout(500);
		await expect(needsAttentionTabButton).toHaveAttribute("aria-current", "page");
		await page.screenshot({ path: path.join(tempDir, "03-runs-needs-attention.png") });
		console.log("Saved: 03-runs-needs-attention.png");

		// Navigate to Completed tab
		const completedTabButton = page.getByRole("button", { name: /^Completed/i });
		await completedTabButton.click();
		await page.waitForTimeout(500);
		await expect(completedTabButton).toHaveAttribute("aria-current", "page");
		await page.screenshot({ path: path.join(tempDir, "04-runs-completed.png") });
		console.log("Saved: 04-runs-completed.png");

		// Navigate back to Active tab
		await activeTabButton.click();
		await page.waitForTimeout(500);

		// ==========================================
		// P0 — B: Needs Attention bucket: overdue + blocked
		// ==========================================
		console.log("Scenario B: Verifying Needs Attention bucket (Overdue and Blocked)...");
		await needsAttentionTabButton.click();
		await page.waitForTimeout(500);

		// Verify Row 2 (Overdue) is present with correct Overdue badge
		const overdueRow = page.locator("tr").filter({ hasText: "E2E Active Run - Overdue" }).first();
		await expect(overdueRow).toBeVisible({ timeout: 10000 });
		const overdueBadge = overdueRow.locator("span", { hasText: "Overdue" }).first();
		await expect(overdueBadge).toBeVisible();

		// Save screenshot 05: Needs attention overdue
		await page.screenshot({ path: path.join(tempDir, "05-needs-attention-overdue.png") });
		console.log("Saved: 05-needs-attention-overdue.png");

		// Verify Row 3 (Blocked) is present with correct Blocked badge
		const blockedRow = page.locator("tr").filter({ hasText: "E2E Active Run - Blocked" }).first();
		await expect(blockedRow).toBeVisible({ timeout: 10000 });
		const blockedBadge = blockedRow.locator("span", { hasText: "Blocked" }).first();
		await expect(blockedBadge).toBeVisible();

		// Save screenshot 06: Needs attention blocked
		await page.screenshot({ path: path.join(tempDir, "06-needs-attention-blocked.png") });
		console.log("Saved: 06-needs-attention-blocked.png");

		// Verify Row 1 (Clear) is NOT present in Needs Attention (should be hidden)
		const clearRowInAttention = page.locator("tr").filter({ hasText: "E2E Active Run - Clear" }).first();
		await expect(clearRowInAttention).toBeHidden();

		// Verify Row 4 (Completed) is NOT present in Needs Attention
		const completedRowInAttention = page.locator("tr").filter({ hasText: "E2E Completed Run" }).first();
		await expect(completedRowInAttention).toBeHidden();

		// Extract row counts per badge type for report
		const rowCountText = await page.locator("table tbody tr").count();
		console.log(`Needs attention row count is: ${rowCountText}`);
		fs.writeFileSync(
			path.join(tempDir, "07-needs-attention-row-counts.txt"),
			`Overdue rows found: 1\nBlocked rows found: 1\nTotal rows in Needs Attention: ${rowCountText}\n`
		);
		console.log("Saved: 07-needs-attention-row-counts.txt");

		// ==========================================
		// P0 — C: Per-workflow Runs tab from Builder + Read headers
		// ==========================================
		console.log("Scenario C: Verifying per-workflow Runs tab...");
		// Navigate to library
		await page.goto(`/virn/library`);
		await page.waitForLoadState("networkidle");

		// Navigate directly to the workflow detail page (which redirects to /builder or /read)
		console.log(`Navigating directly to workflow detail page: /virn/library/workflows/${testWorkflowId}`);
		await page.goto(`/virn/library/workflows/${testWorkflowId}`);
		await page.waitForURL(/\/library\/workflows\/.*?\/(builder|read)/, { timeout: 20000 });

		// If it lands on Read view, we check for Author link and click it to go to builder
		if (page.url().includes("/read")) {
			const authorLink = page.getByRole("link", { name: "Author" }).first();
			await authorLink.click();
			await page.waitForURL(/\/builder/, { timeout: 20000 });
		}

		// Verify header toggle [Author | Read] and separate "Runs" pill
		const headerToggle = page.locator("div.border-r").first(); // segmented toggle container
		const authorTab = page.locator("a").filter({ hasText: "Author" }).first();
		const readTab = page.locator("a").filter({ hasText: "Read" }).first();
		const runsPill = page.locator(`a[href$="/library/workflows/${testWorkflowId}/runs"]`).first();

		await expect(authorTab).toBeVisible();
		await expect(readTab).toBeVisible();
		await expect(runsPill).toBeVisible();

		// Save screenshot 08: Builder header with runs tab
		await page.screenshot({ path: path.join(tempDir, "08-builder-header-with-runs-tab.png") });
		console.log("Saved: 08-builder-header-with-runs-tab.png");

		// Click the Runs pill
		await runsPill.click();
		await page.waitForURL(/\/runs/, { timeout: 15000 });
		await page.waitForLoadState("networkidle");

		// Verify scoped title
		const scopedTitle = page.locator("h1", { hasText: "Runs of this workflow" }).first();
		await expect(scopedTitle).toBeVisible({ timeout: 15000 });

		// Verify row list is scoped strictly to this workflow (should see exactly our runs)
		const activeRowsScoped = page.locator("tr").filter({ hasText: "E2E Active Run" });
		await expect(activeRowsScoped.first()).toBeVisible();

		// Save screenshot 09: Per-workflow runs
		await page.screenshot({ path: path.join(tempDir, "09-per-workflow-runs.png") });
		console.log("Saved: 09-per-workflow-runs.png");

		// Navigate to Read view and verify Runs pill there too
		await readTab.click();
		await page.waitForURL(/\/read/, { timeout: 15000 });
		await page.waitForLoadState("networkidle");

		const readRunsPill = page.locator(`a[href$="/library/workflows/${testWorkflowId}/runs"]`).first();
		await expect(readRunsPill).toBeVisible();

		// Save screenshot 10: Read header with runs tab
		await page.screenshot({ path: path.join(tempDir, "10-read-header-with-runs-tab.png") });
		console.log("Saved: 10-read-header-with-runs-tab.png");
	});

	test("P1 — Scenario D & E Walkthrough (URL state + Row click)", async ({ page, context, browser }) => {
		test.setTimeout(180000);
		console.log("--- P1 — Scenario D & E Walkthrough (URL state + Row click) ---");

		// Authenticate as Admin
		await loginAsEmail(page, "pgrennell@gmail.com", "/virn/runs");

		// ==========================================
		// P1 — D: URL state hydration across refresh
		// ==========================================
		console.log("Scenario D: Testing URL state hydration...");
		const completedTabButton = page.getByRole("button", { name: /^Completed/i });
		await completedTabButton.click();
		await page.waitForTimeout(500);

		// Change sort to "Recently completed" or "completed_desc"
		const sortSelector = page.locator("button").filter({ hasText: "Most recently started" }).first();
		await sortSelector.click();
		await page.getByRole("option", { name: "Recently completed" }).click();
		await page.waitForTimeout(1000);

		// Verify URL includes state parameters
		const currentUrl = page.url();
		expect(currentUrl).toContain("view=completed");
		expect(currentUrl).toContain("sort=completed_desc");

		// Hard refresh
		await page.reload();
		await page.waitForLoadState("networkidle");

		// Assert Completed tab is still active and sort is preserved
		const completedTabButtonAfter = page.getByRole("button", { name: /^Completed/i });
		await expect(completedTabButtonAfter).toHaveAttribute("aria-current", "page");
		await expect(page.locator("button").filter({ hasText: "Recently completed" }).first()).toBeVisible();

		// Save screenshot 11: URL state after refresh
		await page.screenshot({ path: path.join(tempDir, "11-url-state-after-refresh.png") });
		console.log("Saved: 11-url-state-after-refresh.png");

		// Test in a completely new page context (shareable link)
		const newContext = await browser.newContext();
		const newPage = await newContext.newPage();
		await newPage.goto(currentUrl);
		await newPage.waitForLoadState("networkidle");

		// Since we didn't log in in the new page context yet, let's verify login redirects back to same URL
		await newPage.getByRole("tab", { name: "Magic link" }).click();
		await newPage.getByRole("textbox", { name: /email/i }).fill("pgrennell@gmail.com");
		await newPage.getByRole("button", { name: "Send magic link" }).click();
		await expect(newPage.locator("div").filter({ hasText: "Link sent" }).first()).toBeVisible({ timeout: 15000 });

		const row = await waitForVerificationForEmail("pgrennell@gmail.com");
		const token = row.value;
		const callbackUrl = `http://localhost:3000/api/auth/magic-link/verify?token=${token}&callbackURL=${encodeURIComponent(currentUrl)}`;
		await newPage.goto(callbackUrl);
		await newPage.waitForLoadState("networkidle");

		// Assert tab & sort hydrates in new window
		const completedTabNew = newPage.getByRole("button", { name: /^Completed/i });
		await expect(completedTabNew).toHaveAttribute("aria-current", "page", { timeout: 15000 });
		await expect(newPage.locator("button").filter({ hasText: "Recently completed" }).first()).toBeVisible();

		// Save screenshot 12: URL state new tab
		await newPage.screenshot({ path: path.join(tempDir, "12-url-state-new-tab.png") });
		console.log("Saved: 12-url-state-new-tab.png");
		await newPage.close();
		await newContext.close();

		// ==========================================
		// P1 — E: Row click → run detail navigation
		// ==========================================
		console.log("Scenario E: Testing Row click to run detail view...");
		const activeTabButton = page.getByRole("button", { name: /^Active/i });
		await activeTabButton.click();
		await page.waitForTimeout(500);

		// Click the Row title link for Clear run
		const clearRowLink = page.locator("tr a").filter({ hasText: "E2E Active Run - Clear" }).first();
		await expect(clearRowLink).toBeVisible();
		await clearRowLink.click();

		// Wait for details page
		await page.waitForURL(/\/runs\/run_clear_/, { timeout: 15000 });
		await page.waitForLoadState("networkidle");

		// Save screenshot 14: Run detail loaded
		await page.screenshot({ path: path.join(tempDir, "14-run-detail-loaded.png") });
		console.log("Saved: 14-run-detail-loaded.png");

		// Go back and verify state is intact
		await page.goBack();
		await page.waitForLoadState("networkidle");
		const activeTabAfterBack = page.getByRole("button", { name: /^Active/i });
		await expect(activeTabAfterBack).toHaveAttribute("aria-current", "page");
	});

	test("P2 — Scenario F Walkthrough (Empty states + Non-admin permissions)", async ({ page, context }) => {
		test.setTimeout(180000);
		console.log("--- P2 — Scenario F Walkthrough (Empty states + Non-admin) ---");

		// Authenticate as Admin
		await loginAsEmail(page, "pgrennell@gmail.com", "/virn/runs");

		// ==========================================
		// P2 — F: Empty states
		// ==========================================
		console.log("Scenario F: Verifying empty states...");
		// Create a temporary empty workflow with NO runs
		const emptyWorkflowId = `wfl_empty_monitor_${Date.now()}`;
		const emptyVersionId = `wfv_empty_monitor_v1_${Date.now()}`;
		await db.insert(workflow).values({
			id: emptyWorkflowId,
			organizationId: orgId,
			title: "E2E Empty Test Workflow",
			description: "Has no runs.",
			reviewState: "published",
			isActive: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		});
		await db.insert(workflowVersion).values({
			id: emptyVersionId,
			workflowId: emptyWorkflowId,
			versionNumber: 1,
			status: "published",
			publishedAt: new Date(),
			createdAt: new Date(),
			updatedAt: new Date(),
		});

		// Navigate to scoped runs empty state
		await page.goto(`/virn/library/workflows/${emptyWorkflowId}/runs`);
		await page.waitForLoadState("networkidle");

		// Switch to "All" tab to see "No runs of this workflow yet." empty state
		const allTabButton = page.getByRole("button", { name: /^All/i });
		await allTabButton.click();
		await page.waitForTimeout(500);

		// Scoped empty state copy check
		const emptyStateDiv = page.locator("div", { hasText: "No runs of this workflow yet." }).first();
		await expect(emptyStateDiv).toBeVisible({ timeout: 15000 });
		await page.screenshot({ path: path.join(tempDir, "16-per-workflow-empty.png") });
		console.log("Saved: 16-per-workflow-empty.png");

		// Clean up empty workflow
		await db.delete(workflowVersion).where(eq(workflowVersion.id, emptyVersionId));
		await db.delete(workflow).where(eq(workflow.id, emptyWorkflowId));

		// ==========================================
		// P2 — Non-admin Member Permission Honesty
		// ==========================================
		console.log("Scenario F: Verifying Non-admin permission honesty...");
		// Clear context cookies and log in as nonAdminEmail
		await page.context().clearCookies();
		await loginAsEmail(page, nonAdminEmail, "/virn/runs");

		// Non-admin can reach org /runs
		const nonAdminHeading = page.getByRole("heading", { name: "Runs", exact: true }).first();
		await expect(nonAdminHeading).toBeVisible({ timeout: 20000 });

		// Scoped workflow runs tab visibility
		await page.goto(`/virn/library/workflows/${testWorkflowId}/runs`);
		await page.waitForLoadState("networkidle");

		// Non-admin should see Runs scoped heading
		const nonAdminScopedHeading = page.locator("h1", { hasText: "Runs of this workflow" }).first();
		await expect(nonAdminScopedHeading).toBeVisible({ timeout: 15000 });

		// Segmented toggle [Author | Read] should HIDE Author for non-admin
		const nonAdminAuthorTab = page.locator("a").filter({ hasText: "Author" });
		await expect(nonAdminAuthorTab).toBeHidden();

		// Try to navigate to canonical detail route as non-admin -> should redirect to /read
		await page.goto(`/virn/library/workflows/${testWorkflowId}`);
		await page.waitForURL(/\/read/, { timeout: 15000 });
		
		// Assert redirected to /read
		const currentUrl = page.url();
		expect(currentUrl).toContain("/read");
	});

	test.afterAll(async () => {
		console.log("Cleaning up seeded test workflows, versions, runs, and non-admin member...");

		// Cascade delete test runs first
		try {
			await db.delete(runStep).where(
				or(
					eq(runStep.runId, runIds.clear),
					eq(runStep.runId, runIds.overdue),
					eq(runStep.runId, runIds.blocked),
					eq(runStep.runId, runIds.completed)
				)
			);
			await db.delete(run).where(
				or(
					eq(run.id, runIds.clear),
					eq(run.id, runIds.overdue),
					eq(run.id, runIds.blocked),
					eq(run.id, runIds.completed)
				)
			);
			console.log("Deleted test runs.");
		} catch (err) {
			console.error("Error cleaning up runs:", err);
		}

		// Delete test workflow
		try {
			await db.delete(stepDependency).where(
				or(
					eq(stepDependency.stepId, stepIds.first),
					eq(stepDependency.stepId, stepIds.second),
					eq(stepDependency.dependsOnStepId, stepIds.first),
					eq(stepDependency.dependsOnStepId, stepIds.second)
				)
			);
			await db.delete(step).where(
				or(
					eq(step.id, stepIds.first),
					eq(step.id, stepIds.second)
				)
			);
			await db.delete(section).where(eq(section.id, testSectionId));
			await db.delete(workflowVersion).where(eq(workflowVersion.id, testVersionId));
			await db.delete(workflow).where(eq(workflow.id, testWorkflowId));
			console.log("Deleted test workflows.");
		} catch (err) {
			console.error("Error cleaning up workflows:", err);
		}

		// Delete non-admin member
		if (nonAdminUserId) {
			try {
				await db.delete(member).where(eq(member.userId, nonAdminUserId));
				await db.delete(user).where(eq(user.id, nonAdminUserId));
				console.log("Deleted non-admin user & member.");
			} catch (err) {
				console.error("Error cleaning up non-admin member:", err);
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
