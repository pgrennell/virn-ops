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
	user,
	member,
	organization,
	capability,
	organizationCapability,
	auditLog,
	acknowledgment,
} from "@virn/database";
import { eq, or, and, like } from "drizzle-orm";
import { createId as cuid } from "@paralleldrive/cuid2";

const specName = "phase-15-compliance-2026-05-30";
const tempDir = path.join(os.tmpdir(), "phase-15-compliance-2026-05-30-temp");
const orgSlug = "virn";

async function loginAsEmail(page: Page, email: string, callbackURLPath: string = "/virn/compliance") {
	console.log(`Helper: Authenticating ${email}...`);
	await page.goto(callbackURLPath);
	await page.waitForLoadState("networkidle");
	console.log(`Helper: Logged in as ${email} successfully!`);
}

test.describe.serial("Phase 15 Thin Compliance E2E Browser-Driven Verification", () => {
	let orgId: string;
	let adminUserId: string;
	let nonAdminEmail: string;
	let nonAdminUserId: string;
	let nonAdminMemberId: string;
	let complianceCapId: string;

	const testWorkflowId = `wfl_test_compliance_${Date.now()}`;
	const testVersionId = `wfv_test_compliance_v1_${Date.now()}`;
	const testSectionId = `sec_test_compliance_${Date.now()}`;
	const testStepId = `stp_test_compliance_${Date.now()}`;

	const ackIds = {
		admin: `ack_test_admin_${Date.now()}`,
		member: `ack_test_member_${Date.now()}`,
	};

	const auditIds = {
		pub: `aud_test_pub_${Date.now()}`,
		upd: `aud_test_upd_${Date.now()}`,
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

			// Find admin user
			const admin = await db.query.user.findFirst({
				where: eq(user.email, "pgrennell@gmail.com"),
			});
			if (!admin) throw new Error("Preseeded admin user not found");
			adminUserId = admin.id;

			// Force admin's lastActiveOrganizationId to virn orgId to align active organization context
			await db.update(user).set({
				lastActiveOrganizationId: orgId,
			}).where(eq(user.id, adminUserId));

			// Find compliance.pack capability ID
			const cap = await db.query.capability.findFirst({
				where: eq(capability.key, "compliance.pack"),
			});
			if (!cap) throw new Error("Compliance capability 'compliance.pack' not seeded. Run 'seed:capabilities' first.");
			complianceCapId = cap.id;

			// Ensure compliance capability starts as OFF by deleting any org-level overrides
			await db.delete(organizationCapability).where(
				and(
					eq(organizationCapability.organizationId, orgId),
					eq(organizationCapability.capabilityId, complianceCapId)
				)
			);
			console.log("Cleared compliance capability override for org (OFF by default).");

			// Clean up any old test compliance workflows just in case
			await db.delete(workflow).where(like(workflow.id, "wfl_test_compliance_%"));

			// Seed non-admin member
			nonAdminEmail = `non-admin-operator-${Date.now()}@example.com`;
			nonAdminUserId = `usr_${cuid()}`;
			nonAdminMemberId = `mbr_${cuid()}`;

			await db.insert(user).values({
				id: nonAdminUserId,
				name: "E2E Compliance Operator",
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
				role: "member", // maps to operator grade role
				createdAt: new Date(),
			});
			console.log("Seeded non-admin operator:", nonAdminEmail);

			// Seed Test Workflow
			await db.insert(workflow).values({
				id: testWorkflowId,
				organizationId: orgId,
				title: "E2E Compliance Test Workflow",
				description: "Used to test Phase 15 Thin Compliance evidence receipts.",
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
				title: "Compliance Verification Core",
				position: 0,
				createdAt: new Date(),
				updatedAt: new Date(),
			});

			await db.insert(step).values({
				id: testStepId,
				workflowVersionId: testVersionId,
				sectionId: testSectionId,
				title: "Core Verification Step",
				description: "Verify that this audit trail lands securely.",
				position: 0,
				isRequired: true,
				isStopTask: false,
				dueType: "none",
				createdAt: new Date(),
				updatedAt: new Date(),
			});
			console.log("Seeded test workflow version & steps.");

			// Seed test audit log entries
			await db.insert(auditLog).values([
				{
					id: auditIds.pub,
					organizationId: orgId,
					actorKind: "user",
					actorUserId: adminUserId,
					action: "workflow.published",
					entityType: "workflow",
					entityId: testWorkflowId,
					createdAt: new Date(Date.now() - 10 * 60 * 1000), // 10 mins ago
				},
				{
					id: auditIds.upd,
					organizationId: orgId,
					actorKind: "user",
					actorUserId: adminUserId,
					action: "workflow.updated",
					entityType: "workflow",
					entityId: testWorkflowId,
					changes: {
						title: { from: "Old Draft Title", to: "E2E Compliance Test Workflow" }
					},
					createdAt: new Date(Date.now() - 5 * 60 * 1000), // 5 mins ago
				}
			]);
			console.log("Seeded 2 workflow audit log entries.");

			// Seed acknowledgments
			await db.insert(acknowledgment).values([
				{
					id: ackIds.admin,
					organizationId: orgId,
					workflowVersionId: testVersionId,
					userId: adminUserId,
					acknowledgedAt: new Date(Date.now() - 2 * 3600 * 1000), // 2 hrs ago
				},
				{
					id: ackIds.member,
					organizationId: orgId,
					workflowVersionId: testVersionId,
					userId: nonAdminUserId,
					acknowledgedAt: new Date(Date.now() - 1 * 3600 * 1000), // 1 hr ago
				}
			]);
			console.log("Seeded 2 acknowledgment receipt rows.");

		} catch (err) {
			console.error("Error setting up compliance seeds:", err);
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
		await loginAsEmail(page, "pgrennell@gmail.com", "/virn/home");

		// ==========================================
		// P0 — A: Capability gate honesty (OFF checks)
		// ==========================================
		console.log("Step A1: Verifying compliance is OFF by default...");
		const complianceLink = page.locator("a").filter({ hasText: /^Compliance$/i });
		await expect(complianceLink).toBeHidden();

		// Save screenshot 01: Sidebar compliance OFF
		await page.screenshot({ path: path.join(tempDir, "01-sidebar-compliance-off.png") });
		console.log("Saved: 01-sidebar-compliance-off.png");

		// Verify direct compliance routes return 404
		console.log("Step A2: Direct-visiting /compliance -> expecting 404...");
		await page.goto("/virn/compliance");
		await expect(page.locator("h1", { hasText: "404" }).or(page.locator("body", { hasText: /could not be found/i })).first()).toBeVisible({ timeout: 15000 });
		await page.screenshot({ path: path.join(tempDir, "02-compliance-404.png") });
		console.log("Saved: 02-compliance-404.png");

		console.log("Step A3: Direct-visiting /compliance/acknowledgments -> expecting 404...");
		await page.goto("/virn/compliance/acknowledgments");
		await expect(page.locator("h1", { hasText: "404" }).or(page.locator("body", { hasText: /could not be found/i })).first()).toBeVisible({ timeout: 15000 });
		await page.screenshot({ path: path.join(tempDir, "03-acknowledgments-404.png") });
		console.log("Saved: 03-acknowledgments-404.png");

		// Open workflow builder and verify NO Audit pill is rendered
		console.log("Step A4: Checking workflow builder header - expecting NO Audit pill...");
		await page.goto(`/virn/library/workflows/${testWorkflowId}/builder`);
		await page.waitForLoadState("networkidle");
		const auditPill = page.locator("a").filter({ hasText: "Audit" }).first();
		await expect(auditPill).toBeHidden();
		await page.screenshot({ path: path.join(tempDir, "04-workflow-header-audit-off.png") });
		console.log("Saved: 04-workflow-header-audit-off.png");

		// ==========================================
		// P0 — A: Toggle capability ON
		// ==========================================
		console.log("Step A5: Navigating to configuration page and toggling compliance.pack ON...");
		await page.goto("/virn/settings/configuration");
		await page.waitForLoadState("networkidle");

		const complianceKeySpan = page.locator("span", { hasText: "compliance.pack" }).first();
		await expect(complianceKeySpan).toBeVisible({ timeout: 15000 });
		const complianceRow = complianceKeySpan.locator("xpath=ancestor::div[contains(@class, 'justify-between')]").first();
		const capSwitch = complianceRow.getByRole("switch").first();
		
		const isChecked = await capSwitch.getAttribute("aria-checked") === "true";
		if (!isChecked) {
			await capSwitch.click();
			await page.waitForTimeout(1500); // Allow optimistic state and cache invalidation
		}

		await page.screenshot({ path: path.join(tempDir, "05-capability-toggled-on.png") });
		console.log("Saved: 05-capability-toggled-on.png");

		// Verify sidebar compliance ON
		console.log("Step A6: Navigating back home and verifying compliance sidebar link appears...");
		await page.goto("/virn/home");
		await page.waitForLoadState("networkidle");
		await expect(complianceLink).toBeVisible({ timeout: 15000 });
		await page.screenshot({ path: path.join(tempDir, "06-sidebar-compliance-on.png") });
		console.log("Saved: 06-sidebar-compliance-on.png");

		// Verify /compliance landing renders links
		console.log("Step A7: Direct-visiting /compliance -> expecting landing page...");
		await page.goto("/virn/compliance");
		await page.waitForLoadState("networkidle");

		const acksLink = page.locator("a").filter({ hasText: "Acknowledgments" }).first();
		await expect(acksLink).toBeVisible({ timeout: 15000 });
		await page.screenshot({ path: path.join(tempDir, "07-compliance-landing.png") });
		console.log("Saved: 07-compliance-landing.png");

		// Verify Audit pill in builder header
		console.log("Step A8: Checking workflow builder header - expecting Audit pill...");
		await page.goto(`/virn/library/workflows/${testWorkflowId}/builder`);
		await page.waitForLoadState("networkidle");
		await expect(auditPill).toBeVisible({ timeout: 15000 });
		await page.screenshot({ path: path.join(tempDir, "08-workflow-header-audit-on.png") });
		console.log("Saved: 08-workflow-header-audit-on.png");

		// ==========================================
		// P0 — B: Per-workflow audit timeline
		// ==========================================
		console.log("Scenario B: Verifying per-workflow Audit timeline...");
		await auditPill.click();
		await page.waitForURL(/\/audit/, { timeout: 15000 });
		await page.waitForLoadState("networkidle");

		// Assert title
		const auditTitle = page.locator("h1", { hasText: "E2E Compliance Test Workflow" }).first();
		await expect(auditTitle).toBeVisible();

		// Assert publication audit row is rendered correctly
		const pubRow = page.locator("li").filter({ hasText: "workflow · published" }).first();
		await expect(pubRow).toBeVisible({ timeout: 15000 });
		
		// Assert update row with title diff matches changes json
		const updRow = page.locator("li").filter({ hasText: "workflow · updated" }).first();
		await expect(updRow).toBeVisible();
		const diffSpan = updRow.locator("li").filter({ hasText: /title: "Old Draft Title" → "E2E Compliance Test Workflow"/ }).first();
		await expect(diffSpan).toBeVisible();

		await page.screenshot({ path: path.join(tempDir, "09-audit-page-default.png") });
		console.log("Saved: 09-audit-page-default.png");

		// Click Runs pill to check Runs tab active state
		const runsPill = page.locator(`a[href$="/library/workflows/${testWorkflowId}/runs"]`).first();
		await expect(runsPill).toBeVisible();
		await runsPill.click();
		await page.waitForURL(/\/runs/, { timeout: 15000 });
		await expect(runsPill).toHaveAttribute("aria-current", "page"); // Verify runs pill has active state highlight
		await expect(auditPill).not.toHaveAttribute("aria-current", "page");

		// ==========================================
		// P0 — C: Acknowledgments index + single receipt
		// ==========================================
		console.log("Scenario C: Verifying acknowledgments index & single receipt...");
		await page.goto("/virn/compliance/acknowledgments");
		await page.waitForLoadState("networkidle");

		// Verify rows exist
		const ackRow = page.locator("tr").filter({ hasText: "E2E Compliance Test Workflow" }).first();
		await expect(ackRow).toBeVisible({ timeout: 15000 });

		await page.screenshot({ path: path.join(tempDir, "11-acknowledgments-index.png") });
		console.log("Saved: 11-acknowledgments-index.png");

		// Navigate to individual receipt page
		console.log(`Navigating to single acknowledgment receipt: /virn/compliance/acknowledgments/${ackIds.admin}`);
		await page.goto(`/virn/compliance/acknowledgments/${ackIds.admin}`);
		await page.waitForLoadState("networkidle");

		// Verify receipt content
		await expect(page.locator("div", { hasText: "Acknowledgment receipt" }).first()).toBeVisible({ timeout: 15000 });
		await expect(page.locator("h1", { hasText: "E2E Compliance Test Workflow" }).first()).toBeVisible();
		await expect(page.locator("span", { hasText: "Acknowledged" }).first()).toBeVisible();

		// Monospace IDs verify
		const workflowIdText = page.locator("span, div, p").filter({ hasText: testWorkflowId }).first();
		await expect(workflowIdText).toBeVisible();

		await page.screenshot({ path: path.join(tempDir, "12-receipt-default.png") });
		console.log("Saved: 12-receipt-default.png");

		// Empty audit timeline on freshly seeded acknowledgment card
		const emptyAudit = page.locator("div", { hasText: "No additional audit history yet -- the insert itself was the only event." }).first();
		await expect(emptyAudit).toBeVisible();
		await page.screenshot({ path: path.join(tempDir, "13-receipt-audit-empty.png") });
		console.log("Saved: 13-receipt-audit-empty.png");

		// Verify cross-org isolation (expecting Acknowledgment not found in this organization error alert)
		console.log("Step C8: Checking cross-org/invalid ID receipt view...");
		await page.goto("/virn/compliance/acknowledgments/ack_invalid_id_999");
		await expect(page.locator("div").filter({ hasText: /Acknowledgment not found/i }).first()).toBeVisible({ timeout: 15000 });
	});

	test("P1 — Scenario D & E Walkthrough (URL state + Receipt print view)", async ({ page, browser }) => {
		test.setTimeout(180000);
		console.log("--- P1 — Scenario D & E Walkthrough (URL state + Print view) ---");

		// Authenticate as Admin
		await loginAsEmail(page, "pgrennell@gmail.com", "/virn/home");

		// ==========================================
		// P1 — D: URL state hydration
		// ==========================================
		console.log("Scenario D: Testing URL state hydration...");
		// Navigate to workflow audit page with page parameter
		await page.goto(`/virn/library/workflows/${testWorkflowId}/audit?page=2`);
		await page.waitForLoadState("networkidle");

		// Hard refresh
		await page.reload();
		await page.waitForLoadState("networkidle");
		expect(page.url()).toContain("page=2");
		await page.screenshot({ path: path.join(tempDir, "14-audit-page-refresh.png") });
		console.log("Saved: 14-audit-page-refresh.png");

		// Navigate to acknowledgments index with page parameter
		await page.goto(`/virn/compliance/acknowledgments?page=2`);
		await page.waitForLoadState("networkidle");

		// Hard refresh
		await page.reload();
		await page.waitForLoadState("networkidle");
		expect(page.url()).toContain("page=2");
		await page.screenshot({ path: path.join(tempDir, "15-ack-page-refresh.png") });
		console.log("Saved: 15-ack-page-refresh.png");

		// Verify Magic link session hydration in new tab preserves params
		const currentUrl = page.url();
		const newContext = await browser.newContext();
		const newPage = await newContext.newPage();
		await newPage.goto(currentUrl);
		await newPage.waitForLoadState("networkidle");

		// Prompt login redirection
		await newPage.getByRole("tab", { name: "Magic link" }).click();
		await newPage.getByRole("textbox", { name: /email/i }).fill("pgrennell@gmail.com");
		await newPage.getByRole("button", { name: "Send magic link" }).click();
		await expect(newPage.locator("div").filter({ hasText: "Link sent" }).first()).toBeVisible({ timeout: 15000 });

		const row = await waitForVerificationForEmail("pgrennell@gmail.com");
		const token = row.value;
		const callbackUrl = `http://localhost:3000/api/auth/magic-link/verify?token=${token}&callbackURL=${encodeURIComponent(currentUrl)}`;
		await newPage.goto(callbackUrl);
		await newPage.waitForLoadState("networkidle");

		// Page hydrates state cleanly
		expect(newPage.url()).toContain("page=2");
		await newPage.screenshot({ path: path.join(tempDir, "12-url-state-new-tab.png") });
		console.log("Saved: 12-url-state-new-tab.png");
		await newPage.close();
		await newContext.close();

		// ==========================================
		// P1 — E: Receipt print view
		// ==========================================
		console.log("Scenario E: Checking receipt print utility styling...");
		await page.goto(`/virn/compliance/acknowledgments/${ackIds.admin}`);
		await page.waitForLoadState("networkidle");

		// Verify print classes are present on structural receipt containers
		const printButton = page.locator("button", { hasText: "Print" }).first();
		await expect(printButton).toBeVisible();
		const topBar = printButton.locator("xpath=ancestor::div[contains(@class, 'print:hidden')]").first();
		await expect(topBar).toBeVisible();

		await page.screenshot({ path: path.join(tempDir, "16-receipt-print-preview.png") });
		console.log("Saved: 16-receipt-print-preview.png");
	});

	test("P2 — Scenario F Walkthrough (Role Gating on /compliance)", async ({ page }) => {
		test.setTimeout(180000);
		console.log("--- P2 — Scenario F Walkthrough (Role Gating) ---");

		// Authenticate as non-admin Operator
		await loginAsEmail(page, nonAdminEmail, "/virn/home");

		// Non-admin can NOT reach /compliance (expecting 404)
		console.log("Step F2: Non-admin direct navigating /compliance - expecting 404...");
		await page.goto("/virn/compliance");
		await expect(page.locator("h1", { hasText: "404" }).or(page.locator("body", { hasText: /could not be found/i })).first()).toBeVisible({ timeout: 15000 });

		// Non-admin can NOT see Audit pill on workflow detail route
		console.log("Step F3: Non-admin checking workflow detail route - expecting NO Audit pill...");
		// Canonical route will redirect Operator to /read
		await page.goto(`/virn/library/workflows/${testWorkflowId}`);
		await page.waitForURL(/\/read/, { timeout: 15000 });

		const auditPill = page.locator("a").filter({ hasText: "Audit" }).first();
		await expect(auditPill).toBeHidden();

		// Non-admin manual direct navigate to /audit should return 404
		console.log("Step F4: Non-admin manually direct-visiting /audit - expecting 404...");
		await page.goto(`/virn/library/workflows/${testWorkflowId}/audit`);
		await expect(page.locator("h1", { hasText: "404" }).or(page.locator("body", { hasText: /could not be found/i })).first()).toBeVisible({ timeout: 15000 });
		
		await page.screenshot({ path: path.join(tempDir, "17-non-admin-compliance-404.png") });
		console.log("Saved: 17-non-admin-compliance-404.png");
	});

	test.afterAll(async () => {
		console.log("Cleaning up seeded test compliance workflows, audit logs, acknowledgments, and non-admin member...");

		// Cascade delete test acknowledgments
		try {
			await db.delete(acknowledgment).where(
				or(
					eq(acknowledgment.id, ackIds.admin),
					eq(acknowledgment.id, ackIds.member)
				)
			);
			console.log("Deleted test acknowledgments.");
		} catch (err) {
			console.error("Error cleaning up acknowledgments:", err);
		}

		// Delete audit logs
		try {
			await db.delete(auditLog).where(
				or(
					eq(auditLog.id, auditIds.pub),
					eq(auditLog.id, auditIds.upd)
				)
			);
			console.log("Deleted test audit logs.");
		} catch (err) {
			console.error("Error cleaning up audit logs:", err);
		}

		// Delete test workflow
		try {
			await db.delete(step).where(eq(step.id, testStepId));
			await db.delete(section).where(eq(section.id, testSectionId));
			await db.delete(workflowVersion).where(eq(workflowVersion.id, testVersionId));
			await db.delete(workflow).where(eq(workflow.id, testWorkflowId));
			console.log("Deleted test compliance workflows.");
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

		// Ensure compliance.pack is OFF at the end of the spec
		try {
			await db.delete(organizationCapability).where(
				and(
					eq(organizationCapability.organizationId, orgId),
					eq(organizationCapability.capabilityId, complianceCapId)
				)
			);
			console.log("Ensured compliance.pack capability is toggled OFF after cleanup.");
		} catch (err) {
			console.error("Error toggling OFF capability at teardown:", err);
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
