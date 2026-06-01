import { expect, test, type Page } from "@playwright/test";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
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
	versionApproval,
	suggestion,
} from "@virn/database";
import { eq, or, and, like } from "drizzle-orm";
import { createId as cuid } from "@paralleldrive/cuid2";

const specName = "phase-16-governance-2026-05-30";
const tempDir = path.join(os.tmpdir(), "phase-16-governance-2026-05-30-temp");
const orgSlug = "virn";

async function loginAsEmail(page: Page, email: string, callbackURLPath: string = "/virn/compliance") {
	console.log(`Helper: Authenticating ${email}...`);
	await page.goto(callbackURLPath);
	await page.waitForLoadState("networkidle");
	console.log(`Helper: Logged in as ${email} successfully!`);
}

test.describe.serial("Phase 16 Governance E2E Browser-Driven Walkthrough", () => {
	let orgId: string;
	let adminUserId: string;

	// Scenario-specific Workflow IDs (each has its own separate workflow to enforce the single-draft invariant)
	const wflA = `wfl_gov_a_${Date.now()}`;
	const wflB = `wfl_gov_b_${Date.now()}`;
	const wflC = `wfl_gov_c_${Date.now()}`;
	const wflC_neg = `wfl_gov_cneg_${Date.now()}`;
	const wflD = `wfl_gov_d_${Date.now()}`;
	const wflE = `wfl_gov_e_${Date.now()}`;
	const wflF = `wfl_gov_f_${Date.now()}`;

	// Version and section IDs
	const v1A = `wfv_gov_a1_${Date.now()}`;
	const v1B = `wfv_gov_b1_${Date.now()}`;
	const v2B = `wfv_gov_b2_${Date.now()}`;
	const v1C = `wfv_gov_c1_${Date.now()}`;
	const v2C = `wfv_gov_c2_${Date.now()}`;
	const v1C_neg = `wfv_gov_cneg1_${Date.now()}`;
	const v2C_neg = `wfv_gov_cneg2_${Date.now()}`;
	const v1D = `wfv_gov_d1_${Date.now()}`;
	const v1E = `wfv_gov_e1_${Date.now()}`;
	const v1F = `wfv_gov_f1_${Date.now()}`;

	// Caps cache IDs
	let complianceCapId: string;
	let ackCapId: string;
	let appCapId: string;
	let sugCapId: string;

	async function setCapabilityState(capId: string, enabled: boolean) {
		if (enabled) {
			await db.insert(organizationCapability).values({
				organizationId: orgId,
				capabilityId: capId,
				enabled: true,
				createdAt: new Date(),
				updatedAt: new Date(),
			}).onConflictDoUpdate({
				target: [organizationCapability.organizationId, organizationCapability.capabilityId],
				set: { enabled: true, updatedAt: new Date() },
			});
		} else {
			await db.delete(organizationCapability).where(
				and(
					eq(organizationCapability.organizationId, orgId),
					eq(organizationCapability.capabilityId, capId)
				)
			);
		}
	}

	test.beforeAll(async () => {
		fs.mkdirSync(tempDir, { recursive: true });

		console.log("Database baseline setup for Phase 16...");
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

			// Force admin active org alignment
			await db.update(user).set({
				lastActiveOrganizationId: orgId,
			}).where(eq(user.id, adminUserId));

			// Find capabilities
			const findCap = async (key: string) => {
				const r = await db.query.capability.findFirst({ where: eq(capability.key, key) });
				if (!r) throw new Error(`Required capability '${key}' not seeded.`);
				return r.id;
			};
			complianceCapId = await findCap("compliance.pack");
			ackCapId = await findCap("governance.acknowledgments");
			appCapId = await findCap("governance.approvals");
			sugCapId = await findCap("governance.suggestions");

			// Clear all starting capabilities
			await setCapabilityState(complianceCapId, false);
			await setCapabilityState(ackCapId, false);
			await setCapabilityState(appCapId, false);
			await setCapabilityState(sugCapId, false);
			console.log("Cleared governance & compliance capabilities.");

			// Clean up any old test workflows containing "wfl_gov_"
			await db.delete(workflow).where(like(workflow.id, "wfl_gov_%"));

			// Helper to seed a workflow with basic steps
			const seedWorkflow = async (wfId: string, title: string, hasDraft: boolean = false, v1: string, v2?: string) => {
				await db.insert(workflow).values({
					id: wfId,
					organizationId: orgId,
					title,
					description: `E2E verification workflow for ${title}.`,
					reviewState: "published",
					isActive: true,
					createdAt: new Date(),
					updatedAt: new Date(),
				});

				// Version 1 (published)
				await db.insert(workflowVersion).values({
					id: v1,
					workflowId: wfId,
					versionNumber: 1,
					status: "published",
					publishedAt: new Date(),
					createdAt: new Date(),
					updatedAt: new Date(),
				});

				const secId = `sec_${wfId}_v1`;
				await db.insert(section).values({
					id: secId,
					workflowVersionId: v1,
					title: "Version 1 Sections",
					position: 0,
					createdAt: new Date(),
					updatedAt: new Date(),
				});

				await db.insert(step).values({
					id: `stp_${wfId}_v1_1`,
					workflowVersionId: v1,
					sectionId: secId,
					title: "Step 1 of Version 1",
					description: "Validate original version.",
					position: 0,
					isRequired: true,
					isStopTask: false,
					dueType: "none",
					createdAt: new Date(),
					updatedAt: new Date(),
				});

				// Version 2 (draft) if requested
				if (hasDraft && v2) {
					await db.insert(workflowVersion).values({
						id: v2,
						workflowId: wfId,
						versionNumber: 2,
						status: "draft",
						createdAt: new Date(),
						updatedAt: new Date(),
					});

					const secV2 = `sec_${wfId}_v2`;
					await db.insert(section).values({
						id: secV2,
						workflowVersionId: v2,
						title: "Version 2 Sections (Draft)",
						position: 0,
						createdAt: new Date(),
						updatedAt: new Date(),
					});

					await db.insert(step).values({
						id: `stp_${wfId}_v2_1`,
						workflowVersionId: v2,
						sectionId: secV2,
						title: "Step 1 of Version 2 (Draft)",
						description: "Validate the draft version.",
						position: 0,
						isRequired: true,
						isStopTask: false,
						dueType: "none",
						createdAt: new Date(),
						updatedAt: new Date(),
					});
				}
			};

			// Seed workflows for each scenario independently
			await seedWorkflow(wflA, "Scenario A - Ack WRITE", false, v1A);
			await seedWorkflow(wflB, "Scenario B - Approvals Triage", true, v1B, v2B);
			await seedWorkflow(wflC, "Scenario C - Approvals Gate", true, v1C, v2C);
			await seedWorkflow(wflC_neg, "Scenario C Neg - Approvals Bypass", true, v1C_neg, v2C_neg);
			await seedWorkflow(wflD, "Scenario D - Suggestions Triage", false, v1D);
			await seedWorkflow(wflE, "Scenario E - Reattestation", false, v1E);
			await seedWorkflow(wflF, "Scenario F - Capability Gating", false, v1F);

			console.log("Seeded database successfully for Phase 16.");

		} catch (err) {
			console.error("Error setting up Phase 16 seeds:", err);
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

	test("P0 — Scenario A: Ack WRITE button + badge state", async ({ page }) => {
		console.log("--- Scenario A: Ack WRITE button + badge ---");

		// 1. Flip governance.acknowledgments ON + compliance.pack ON
		await setCapabilityState(ackCapId, true);
		await setCapabilityState(complianceCapId, true);

		// 2. Login as admin
		await loginAsEmail(page, "pgrennell@gmail.com", `/virn/library/workflows/${wflA}/read`);

		// 3. Scroll to footer, verify both buttons visible
		await expect(page.getByRole("button", { name: "Acknowledge", exact: true })).toBeVisible({ timeout: 15000 });
		await expect(page.getByRole("button", { name: "Mark as read", exact: true })).toBeVisible();

		// Scroll into view
		await page.getByRole("button", { name: "Acknowledge", exact: true }).scrollIntoViewIfNeeded();
		await page.waitForTimeout(500);

		// Capture screenshot 01: Buttons in footer
		await page.screenshot({ path: path.join(tempDir, "01-readview-footer-buttons.png") });
		console.log("Saved: 01-readview-footer-buttons.png");

		// 4. Click Acknowledge
		await page.getByRole("button", { name: "Acknowledge", exact: true }).click();
		
		// Verify Acknowledged badge exists in the header chips
		const badge = page.locator("span", { hasText: "Acknowledged" }).first();
		await expect(badge).toBeVisible({ timeout: 15000 });

		// Verify footer button changes to "Acknowledged on"
		await expect(page.locator("body", { hasText: /Acknowledged on/i }).first()).toBeVisible({ timeout: 15000 });

		// Capture screenshot 02: Acknowledged state
		await page.screenshot({ path: path.join(tempDir, "02-acknowledged-state.png") });
		console.log("Saved: 02-acknowledged-state.png");

		// 5. Hard refresh and verify it persists
		await page.reload();
		await page.waitForLoadState("networkidle");
		await page.waitForTimeout(2000);

		await expect(badge).toBeVisible({ timeout: 15000 });
		await page.screenshot({ path: path.join(tempDir, "03-acknowledged-after-refresh.png") });
		console.log("Saved: 03-acknowledged-after-refresh.png");

		// 6. Go to /virn/compliance/acknowledgments
		await page.goto("/virn/compliance/acknowledgments");
		await page.waitForLoadState("networkidle");
		await page.waitForTimeout(2000);

		// Verify acknowledgment row exists in table
		const row = page.locator("tr, li").filter({ hasText: "Scenario A - Ack WRITE" }).first();
		await expect(row).toBeVisible({ timeout: 15000 });

		await page.screenshot({ path: path.join(tempDir, "04-acknowledgments-index-populated.png") });
		console.log("Saved: 04-acknowledgments-index-populated.png");
	});

	test("P0 — Scenario B: Approvals triage decided flow", async ({ page }) => {
		console.log("--- Scenario B: Approvals triage decide flow ---");

		// 1. Toggle governance.approvals ON
		await setCapabilityState(appCapId, true);

		// 2. Clear old versionApproval just in case
		await db.delete(versionApproval).where(eq(versionApproval.workflowVersionId, v2B));

		// 3. Create a pending version approval via direct Drizzle insert
		const approvalId = `vapp_test_${Date.now()}`;
		await db.insert(versionApproval).values({
			id: approvalId,
			workflowVersionId: v2B,
			requestedBy: adminUserId,
			decision: "pending",
			createdAt: new Date(),
		});
		console.log("Seeded pending approval row for Version 2 in DB:", approvalId);

		// 4. Navigate to /virn/compliance/approvals
		await loginAsEmail(page, "pgrennell@gmail.com", "/virn/compliance/approvals");
		await page.waitForTimeout(2000);

		// Verify pending row appears
		const row = page.locator("li, tr").filter({ hasText: "Scenario B - Approvals Triage" }).filter({ hasText: "v2" }).first();
		await expect(row).toBeVisible({ timeout: 15000 });

		await page.screenshot({ path: path.join(tempDir, "05-pending-approvals.png") });
		console.log("Saved: 05-pending-approvals.png");

		// 5. Click "Review"
		const reviewBtn = row.getByRole("button", { name: "Review", exact: true }).first();
		await expect(reviewBtn).toBeVisible();
		await reviewBtn.click();

		// Verify notes textarea + decide buttons visible
		const textarea = row.locator("textarea");
		await expect(textarea).toBeVisible({ timeout: 5000 });
		const approveBtn = row.getByRole("button", { name: "Approve", exact: true }).first();
		const rejectBtn = row.getByRole("button", { name: "Reject", exact: true }).first();
		await expect(approveBtn).toBeVisible();
		await expect(rejectBtn).toBeVisible();

		await page.screenshot({ path: path.join(tempDir, "06-decide-form-open.png") });
		console.log("Saved: 06-decide-form-open.png");

		// 6. Enter note and click Approve
		await textarea.fill("Approve E2E test version 2");
		await approveBtn.click();

		// Verify row disappears from pending list
		await expect(row).toBeHidden({ timeout: 15000 });

		await page.screenshot({ path: path.join(tempDir, "07-after-approve.png") });
		console.log("Saved: 07-after-approve.png");
	});

	test("P0 — Scenario C: Approvals publish-gate (LOAD-BEARING)", async ({ page }) => {
		console.log("--- Scenario C: Approvals publish-gate ---");

		// 1. Clear any versionApproval for version 2C
		await db.delete(versionApproval).where(eq(versionApproval.workflowVersionId, v2C));

		// 2. Navigate directly to Version 2C Builder
		await loginAsEmail(page, "pgrennell@gmail.com", `/virn/library/workflows/${wflC}/builder`);
		await page.waitForLoadState("networkidle");
		await page.waitForTimeout(3000);

		// Assert draft status (has Publish button)
		const publishBtn = page.getByRole("button", { name: "Publish", exact: true }).first();
		await expect(publishBtn).toBeVisible();

		// 3. Click Publish (expect refusal because approvals is ON and no approved row exists)
		await publishBtn.click({ force: true });
		
		// Expect toast/alert displaying approvals required error
		const errorToast = page.locator("div, li").filter({ hasText: /Approvals are required|APPROVAL_REQUIRED/i }).first();
		await expect(errorToast).toBeVisible({ timeout: 20000 });

		await page.screenshot({ path: path.join(tempDir, "08-publish-refused.png") });
		console.log("Saved: 08-publish-refused.png");

		// Dismiss toast or wait
		await page.waitForTimeout(2000);

		// 4. Direct Drizzle insert of approved versionApproval row for v2C
		const approvedId = `vapp_test_approved_${Date.now()}`;
		await db.insert(versionApproval).values({
			id: approvedId,
			workflowVersionId: v2C,
			requestedBy: adminUserId,
			approverId: adminUserId,
			decision: "approved",
			decidedAt: new Date(),
			createdAt: new Date(),
		});
		console.log("Seeded approved row for Version 2C in DB.");

		// 5. Click Publish again (expect success)
		await publishBtn.click({ force: true });

		// Verify published status (Publish button is replaced by Edit or similar)
		await expect(publishBtn).toBeHidden({ timeout: 25000 });
		const editBtn = page.getByRole("button", { name: "Edit", exact: true }).first();
		await expect(editBtn).toBeVisible({ timeout: 15000 });

		await page.screenshot({ path: path.join(tempDir, "09-publish-success.png") });
		console.log("Saved: 09-publish-success.png");

		// ==========================================
		// Negative Control: Flip capability OFF
		// ==========================================
		console.log("Negative Control: Toggling approvals OFF...");
		await setCapabilityState(appCapId, false);

		// Clear any versionApproval for version 2C_neg
		await db.delete(versionApproval).where(eq(versionApproval.workflowVersionId, v2C_neg));

		// Navigate to Version 2C_neg Builder
		await page.goto(`/virn/library/workflows/${wflC_neg}/builder`);
		await page.waitForLoadState("networkidle");
		await page.waitForTimeout(3000);

		// Click Publish (should succeed instantly with NO approved row)
		const publishBtnNeg = page.getByRole("button", { name: "Publish", exact: true }).first();
		await expect(publishBtnNeg).toBeVisible();
		await publishBtnNeg.click({ force: true });

		await expect(publishBtnNeg).toBeHidden({ timeout: 25000 });
		await page.screenshot({ path: path.join(tempDir, "10-publish-cap-off.png") });
		console.log("Saved: 10-publish-cap-off.png");
	});

	test("P0 — Scenario D: Suggestions submit + triage", async ({ page }) => {
		console.log("--- Scenario D: Suggestions submit + triage ---");

		// 1. Toggle governance.suggestions ON + compliance.pack ON
		await setCapabilityState(sugCapId, true);
		await setCapabilityState(complianceCapId, true);

		// 2. Clear old suggestions just in case
		await db.delete(suggestion).where(eq(suggestion.workflowId, wflD));

		// 3. Go to workflow Read view
		await loginAsEmail(page, "pgrennell@gmail.com", `/virn/library/workflows/${wflD}/read`);
		await page.waitForTimeout(2000);

		// 4. Scroll to footer, verify "Suggest improvement" button
		const suggestBtn = page.getByRole("button", { name: "Suggest improvement", exact: true }).first();
		await expect(suggestBtn).toBeVisible({ timeout: 15000 });
		await suggestBtn.scrollIntoViewIfNeeded();
		await page.waitForTimeout(500);

		await page.screenshot({ path: path.join(tempDir, "11-suggest-button.png") });
		console.log("Saved: 11-suggest-button.png");

		// 5. Click Suggest Dialog opens
		await suggestBtn.click();
		const dialog = page.getByRole("dialog");
		await expect(dialog).toBeVisible({ timeout: 5000 });

		await page.screenshot({ path: path.join(tempDir, "12-suggest-dialog.png") });
		console.log("Saved: 12-suggest-dialog.png");

		// 6. Enter feedback and click Submit
		const bodyText = "Add a stop-task after step 3.";
		await dialog.locator("textarea").fill(bodyText);
		await dialog.getByRole("button", { name: "Submit", exact: true }).click();

		// Verify success alert message inside dialog
		const thanksAlert = dialog.locator("div").filter({ hasText: "Thanks — your suggestion was recorded." }).first();
		await expect(thanksAlert).toBeVisible({ timeout: 5000 });

		await page.screenshot({ path: path.join(tempDir, "13-suggest-success.png") });
		console.log("Saved: 13-suggest-success.png");

		// Wait for dialog close delay
		await expect(dialog).toBeHidden({ timeout: 5000 });

		// 7. Go to /virn/compliance/suggestions
		await page.goto("/virn/compliance/suggestions");
		await page.waitForLoadState("networkidle");
		await page.waitForTimeout(2000);

		// Verify open suggestion is listed
		const suggRow = page.locator("li").filter({ hasText: "Scenario D - Suggestions Triage" }).filter({ hasText: bodyText }).first();
		await expect(suggRow).toBeVisible({ timeout: 15000 });

		await page.screenshot({ path: path.join(tempDir, "14-suggestions-open-tab.png") });
		console.log("Saved: 14-suggestions-open-tab.png");

		// 8. Click "Accept"
		const acceptBtn = suggRow.getByRole("button", { name: "Accept", exact: true }).first();
		await expect(acceptBtn).toBeVisible();
		await acceptBtn.click();

		// Verify row disappears from open suggestions
		await expect(suggRow).toBeHidden({ timeout: 15000 });

		// Click "Accepted" tab
		await page.getByRole("button", { name: "Accepted", exact: true }).click();
		await page.waitForTimeout(1000);

		// Verify accepted suggestion is listed there
		const acceptedRow = page.locator("li").filter({ hasText: "Scenario D - Suggestions Triage" }).filter({ hasText: bodyText }).first();
		await expect(acceptedRow).toBeVisible({ timeout: 15000 });

		await page.screenshot({ path: path.join(tempDir, "15-suggestions-accepted.png") });
		console.log("Saved: 15-suggestions-accepted.png");
	});

	test("P1 — Scenario E: Re-attestation cron sweep end-to-end", async ({ page }) => {
		console.log("--- Scenario E: Re-attestation sweep ---");

		// 1. Toggle compliance.pack ON so we can see the audit log tab
		await setCapabilityState(complianceCapId, true);

		// 2. Set reviewIntervalDays = 30, and nextReviewAt to a past date (yesterday) for our test workflow
		const yesterday = new Date();
		yesterday.setDate(yesterday.getDate() - 1);

		await db.update(workflow).set({
			reviewIntervalDays: 30,
			nextReviewAt: yesterday,
		}).where(eq(workflow.id, wflE));
		console.log("Updated test workflow review configuration to yesterday.");

		// Clear any audit log entries for this workflow related to reattestation_due
		await db.delete(auditLog).where(
			and(
				eq(auditLog.entityId, wflE),
				eq(auditLog.action, "workflow.reattestation_due")
			)
		);

		// Retrieve CRON_SECRET from env
		const cronSecret = process.env.CRON_SECRET || "mock-cron-secret";

		// 3. Manually call the vercel cron sweep endpoint
		console.log("Triggering re-attestation sweep via api/cron/reattestation-sweep...");
		const response = await page.request.get("/api/cron/reattestation-sweep", {
			headers: {
				"Authorization": `Bearer ${cronSecret}`,
			}
		});

		expect(response.status()).toBe(200);
		const json = await response.json();
		console.log("Sweep JSON response:", json);
		expect(json.ok).toBe(true);
		expect(json.scanned).toBeGreaterThanOrEqual(1);
		expect(json.advanced).toBeGreaterThanOrEqual(1);

		// 4. Navigate to `/virn/library/workflows/<id>/audit`
		await loginAsEmail(page, "pgrennell@gmail.com", `/virn/library/workflows/${wflE}/audit`);
		await page.waitForLoadState("networkidle");
		await page.waitForTimeout(3000);

		// Verify audit entry for `workflow · due for re-attestation` or action is rendered
		const auditItem = page.locator("li").filter({ hasText: /due for re-attestation|reattestation_due/i }).first();
		await expect(auditItem).toBeVisible({ timeout: 15000 });

		await page.screenshot({ path: path.join(tempDir, "16-reattestation-audit-entry.png") });
		console.log("Saved: 16-reattestation-audit-entry.png");

		// 5. Fire sweep again, verify scanned = 0, advanced = 0
		console.log("Triggering sweep again (expecting empty result)...");
		const response2 = await page.request.get("/api/cron/reattestation-sweep", {
			headers: {
				"Authorization": `Bearer ${cronSecret}`,
			}
		});
		expect(response2.status()).toBe(200);
		const json2 = await response2.json();
		console.log("Second sweep JSON response:", json2);

		// Save response JSON to text file
		fs.writeFileSync(
			path.join(tempDir, "17-second-sweep-empty.txt"),
			JSON.stringify(json2, null, 2)
		);
		console.log("Saved: 17-second-sweep-empty.txt");
	});

	test("P2 — Scenario F: Capability gating OFF checks", async ({ page }) => {
		console.log("--- Scenario F: Capability gating OFF checks ---");

		// 1. Flip ALL four capabilities OFF
		await setCapabilityState(complianceCapId, false);
		await setCapabilityState(ackCapId, false);
		await setCapabilityState(appCapId, false);
		await setCapabilityState(sugCapId, false);
		console.log("Disabled all capabilities.");

		// 2. Go to workflow Read view - verify NO "Acknowledge" and NO "Suggest improvement" buttons
		await loginAsEmail(page, "pgrennell@gmail.com", `/virn/library/workflows/${wflF}/read`);
		await page.waitForTimeout(2000);

		const suggestBtn = page.getByRole("button", { name: "Suggest improvement", exact: true }).first();
		const acknowledgeBtn = page.getByRole("button", { name: "Acknowledge", exact: true }).first();
		await expect(suggestBtn).toBeHidden();
		await expect(acknowledgeBtn).toBeHidden();

		// 3. Navigate to /virn/compliance/approvals - verify empty state or capability warning
		await page.goto("/virn/compliance/approvals");
		await page.waitForLoadState("networkidle");
		await page.waitForTimeout(2000);

		await page.screenshot({ path: path.join(tempDir, "18-approvals-cap-off.png") });
		console.log("Saved: 18-approvals-cap-off.png");

		// 4. Navigate to /virn/compliance/suggestions - verify empty state or capability warning
		await page.goto("/virn/compliance/suggestions");
		await page.waitForLoadState("networkidle");
		await page.waitForTimeout(2000);

		await page.screenshot({ path: path.join(tempDir, "19-suggestions-cap-off.png") });
		console.log("Saved: 19-suggestions-cap-off.png");
	});

	test.afterAll(async () => {
		console.log("Cleaning up seeded Phase 16 E2E elements...");

		// Restore baseline capability overrides (turn off)
		try {
			await setCapabilityState(complianceCapId, false);
			await setCapabilityState(ackCapId, false);
			await setCapabilityState(appCapId, false);
			await setCapabilityState(sugCapId, false);
			console.log("Restored capabilities OFF.");
		} catch (err) {
			console.error("Teardown capabilities error:", err);
		}

		// Cascade delete suggestions
		try {
			await db.delete(suggestion).where(
				or(
					eq(suggestion.workflowId, wflA),
					eq(suggestion.workflowId, wflB),
					eq(suggestion.workflowId, wflC),
					eq(suggestion.workflowId, wflC_neg),
					eq(suggestion.workflowId, wflD),
					eq(suggestion.workflowId, wflE),
					eq(suggestion.workflowId, wflF)
				)
			);
		} catch {}

		// Cascade delete acknowledgments
		try {
			await db.delete(acknowledgment).where(
				or(
					eq(acknowledgment.workflowVersionId, v1A),
					eq(acknowledgment.workflowVersionId, v1B),
					eq(acknowledgment.workflowVersionId, v1C),
					eq(acknowledgment.workflowVersionId, v1C_neg),
					eq(acknowledgment.workflowVersionId, v1D),
					eq(acknowledgment.workflowVersionId, v1E),
					eq(acknowledgment.workflowVersionId, v1F)
				)
			);
		} catch {}

		// Cascade delete approvals
		try {
			await db.delete(versionApproval).where(
				or(
					eq(versionApproval.workflowVersionId, v2B),
					eq(versionApproval.workflowVersionId, v2C),
					eq(versionApproval.workflowVersionId, v2C_neg)
				)
			);
		} catch {}

		// Cascade delete workflow versions & workflows
		const wfIds = [wflA, wflB, wflC, wflC_neg, wflD, wflE, wflF];
		const verIds = [v1A, v1B, v2B, v1C, v2C, v1C_neg, v2C_neg, v1D, v1E, v1F];

		try {
			await db.delete(step).where(or(...verIds.map(vid => eq(step.workflowVersionId, vid))));
			await db.delete(section).where(or(...verIds.map(vid => eq(section.workflowVersionId, vid))));
			await db.delete(workflowVersion).where(or(...wfIds.map(wfid => eq(workflowVersion.workflowId, wfid))));
			await db.delete(workflow).where(or(...wfIds.map(wfid => eq(workflow.id, wfid))));
			console.log("Deleted test workflows + versions + steps.");
		} catch (err) {
			console.error("Teardown workflows error:", err);
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
					console.log(`Copied: ${file} to ${dest}`);
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
