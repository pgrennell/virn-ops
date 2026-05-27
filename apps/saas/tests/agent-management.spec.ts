import { expect, test } from "@playwright/test";
import * as path from "node:path";
import { waitForVerificationForEmail } from "./__helpers/db";
import { getArtifactsDir } from "./__helpers/artifacts";
import { db, agent, user, member, organization } from "@virn/database";
import { eq } from "drizzle-orm";
import { createId as cuid } from "@paralleldrive/cuid2";

const artifactsDir = getArtifactsDir("agent-management");

test.describe("Virn Ops Agent Management settings UI E2E Walk", () => {
	let nonAdminEmail: string;
	let nonAdminUserId: string;
	let nonAdminMemberId: string;
	let orgId: string;

	test.beforeAll(async () => {
		// Clean up any stale agent Turnover AI from database
		await db.delete(agent).where(eq(agent.name, "Turnover AI"));

		// Get the organization ID for slug 'virn'
		const org = await db.query.organization.findFirst({
			where: eq(organization.slug, "virn"),
		});
		if (!org) {
			throw new Error("Preseeded organization with slug 'virn' not found");
		}
		orgId = org.id;

		// Create a non-admin member in the database for the negative path test
		nonAdminEmail = `non-admin-${Date.now()}@example.com`;
		nonAdminUserId = `usr_${cuid()}`;
		nonAdminMemberId = `mbr_${cuid()}`;

		await db.insert(user).values({
			id: nonAdminUserId,
			name: "E2E Non Admin",
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
			role: "member",
			createdAt: new Date(),
		});
		console.log(`Created non-admin user ${nonAdminEmail} and member row.`);
	});

	test.afterAll(async () => {
		// Clean up
		await db.delete(agent).where(eq(agent.name, "Turnover AI"));
		if (nonAdminUserId) {
			await db.delete(member).where(eq(member.userId, nonAdminUserId));
			await db.delete(user).where(eq(user.id, nonAdminUserId));
			console.log("Cleaned up non-admin user and membership.");
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

	test("Execute E2E Agent Management Walk", async ({ page }) => {
		test.setTimeout(120000);

		// --- 1. Authenticate as admin pgrennell@gmail.com ---
		console.log("Step 1: Authenticating admin (pgrennell@gmail.com) via Magic Link UI...");
		await page.goto("/login");

		await page.getByRole("tab", { name: "Magic link" }).click();
		await page.getByRole("textbox", { name: /email/i }).fill("pgrennell@gmail.com");
		await page.getByRole("button", { name: "Send magic link" }).click();

		const successAlert = page.locator("div").filter({ hasText: "Link sent" }).first();
		await expect(successAlert).toBeVisible({ timeout: 15000 });

		console.log("Waiting for magic link token in DB...");
		const row = await waitForVerificationForEmail("pgrennell@gmail.com");
		const token = row.value;

		const callbackUrl = `http://localhost:3000/api/auth/magic-link/verify?token=${token}&callbackURL=http://localhost:3000/virn/settings/agents`;
		await page.goto(callbackUrl);

		// Verify we landed on /virn/settings/agents and header / empty state or list is visible
		console.log("Verifying page render...");
		await expect(page.getByRole("heading", { name: "Agents", exact: true }).first()).toBeVisible({ timeout: 20000 });
		await expect(page.getByText("Manage AI principals that can act on this organization via the MCP surface")).toBeVisible();

		// Check if list or empty state is visible
		const emptyStateText = page.getByText("No agents yet");
		const isEmpty = await emptyStateText.isVisible();

		if (isEmpty) {
			console.log("Empty state visible. Taking screenshot 01_empty_state.png");
			await page.screenshot({ path: path.join(artifactsDir, "01_empty_state.png") });
			console.log("Saved: 01_empty_state.png");
		} else {
			console.log("Agents already exist. Taking screenshot 01_empty_state.png");
			await page.screenshot({ path: path.join(artifactsDir, "01_empty_state.png") });
			console.log("Saved: 01_empty_state.png");
		}

		// --- 2. Click 'New agent' / 'Create your first agent' button ---
		console.log("Step 2: Opening Create dialog...");
		const newAgentBtn = page.getByRole("button", { name: /New agent|Create your first agent/ }).first();
		await newAgentBtn.click();

		// Assert Create dialog opens
		await expect(page.getByRole("heading", { name: "Create an agent" })).toBeVisible({ timeout: 5000 });

		// Fill name Turnover AI, description Handles STR turnover runs end-to-end -> submit
		await page.locator("input#agent-name").fill("Turnover AI");
		await page.locator("input#agent-description").fill("Handles STR turnover runs end-to-end");
		await page.getByRole("button", { name: "Create agent" }).click();

		// --- 3. Credential-reveal dialog should appear ---
		console.log("Step 3: Verifying credential-reveal dialog...");
		const revealTitle = page.getByRole("heading", { name: "Agent created" });
		await expect(revealTitle).toBeVisible({ timeout: 10000 });

		// Confirm plaintext credential format matching agent_<43 base64url chars>
		const credentialInput = page.locator("input[readonly]");
		await expect(credentialInput).toBeVisible();
		const credentialText = await credentialInput.inputValue();
		console.log("Plaintext credential prefix check:", credentialText.substring(0, 10));
		expect(credentialText.startsWith("agent_")).toBe(true);
		
		// The base64url part should be ~43 chars
		const credentialPayload = credentialText.substring("agent_".length);
		console.log(`Plaintext payload length: ${credentialPayload.length} chars (payload: ${credentialPayload})`);
		expect(credentialPayload.length).toBeGreaterThanOrEqual(40);
		expect(credentialPayload.length).toBeLessThanOrEqual(46);

		// Assert dialog close button is disabled
		const closeBtn = page.getByRole("button", { name: "Close" }).first();
		await expect(closeBtn).toBeDisabled();

		// Save screenshot 03_credential_reveal.png
		await page.screenshot({ path: path.join(artifactsDir, "03_credential_reveal.png") });
		console.log("Saved: 03_credential_reveal.png");

		// Click-outside backdrop suppression test
		console.log("Testing click-outside backdrop suppression...");
		await page.mouse.click(10, 10); // click top-left outside dialog
		await expect(revealTitle).toBeVisible(); // Dialog should still be open!

		// Escape key suppression test
		console.log("Testing Escape key suppression...");
		await page.keyboard.press("Escape");
		await expect(revealTitle).toBeVisible(); // Dialog should still be open!

		// Check the checkbox to enable Close button
		console.log("Checking acknowledgement checkbox...");
		await page.getByText("I've stored the credential").click();
		await expect(closeBtn).toBeEnabled();

		// Click Close to dismiss
		await closeBtn.click();
		await expect(revealTitle).toBeHidden();

		// Verify agent appears in the list
		console.log("Verifying agent is added in list...");
		const agentRow = page.locator("li").filter({ hasText: "Turnover AI" }).first();
		await expect(agentRow).toBeVisible();

		// Check description is visible
		await expect(agentRow.getByText("Handles STR turnover runs end-to-end")).toBeVisible();

		// Check last 4 of credential in UI row matches last 4 of plaintext
		const lastFourPlain = credentialText.slice(-4);
		await expect(agentRow.getByText(`…${lastFourPlain}`)).toBeVisible();
		console.log(`Verified last 4 in list matches: …${lastFourPlain}`);

		// --- 4. Rotate Credential ---
		console.log("Step 4: Rotating credential...");
		const actionMenuBtn = agentRow.getByRole("button", { name: /Actions for Turnover AI/i });
		await actionMenuBtn.click();

		await page.getByRole("menuitem", { name: "Rotate credential" }).click();

		// Confirm in dialog
		await expect(page.getByRole("heading", { name: `Rotate credential for "Turnover AI"?` })).toBeVisible({ timeout: 5000 });
		await page.getByRole("button", { name: "Rotate credential" }).click();

		// Assert new reveal dialog appears
		const rotatedRevealTitle = page.getByRole("heading", { name: "Agent credential rotated" });
		await expect(rotatedRevealTitle).toBeVisible({ timeout: 10000 });

		const rotatedCredentialInput = page.locator("input[readonly]");
		const rotatedCredentialText = await rotatedCredentialInput.inputValue();
		expect(rotatedCredentialText.startsWith("agent_")).toBe(true);
		expect(rotatedCredentialText).not.toBe(credentialText); // Different credential!

		// Same blocking-close semantics
		const rotatedCloseBtn = page.getByRole("button", { name: "Close" }).first();
		await expect(rotatedCloseBtn).toBeDisabled();

		// Save screenshot 05_rotation_reveal.png
		await page.screenshot({ path: path.join(artifactsDir, "05_rotation_reveal.png") });
		console.log("Saved: 05_rotation_reveal.png");

		// Acknowledge, Close
		await page.getByText("I've stored the credential").click();
		await expect(rotatedCloseBtn).toBeEnabled();
		await rotatedCloseBtn.click();
		await expect(rotatedRevealTitle).toBeHidden();

		// Verify row's last 4 reflects the new credential's last 4
		const newLastFourPlain = rotatedCredentialText.slice(-4);
		await expect(agentRow.getByText(`…${newLastFourPlain}`)).toBeVisible();
		console.log(`Verified new last 4 in list matches: …${newLastFourPlain}`);

		// --- 5. Disable Agent ---
		console.log("Step 5: Disabling agent...");
		await actionMenuBtn.click();
		await page.getByRole("menuitem", { name: "Disable" }).click();

		// Toast and disabled badge should show
		await expect(page.getByText("Agent disabled.")).toBeVisible({ timeout: 5000 });
		await expect(agentRow.getByText("Disabled")).toBeVisible();
		// Robot icon should dim (in code, text-foreground/30 class is applied when disabled)
		const botIconDisabled = agentRow.locator("svg.lucide-bot.text-foreground\\/30");
		await expect(botIconDisabled).toBeVisible();

		// --- 6. Enable Agent ---
		console.log("Step 6: Enabling agent...");
		await actionMenuBtn.click();
		await page.getByRole("menuitem", { name: "Enable" }).click();

		await expect(page.getByText("Agent enabled.")).toBeVisible({ timeout: 5000 });
		await expect(agentRow.getByText("Disabled")).toBeHidden();
		const botIconEnabled = agentRow.locator("svg.lucide-bot.text-foreground\\/70");
		await expect(botIconEnabled).toBeVisible();

		// --- 7. Delete Agent ---
		console.log("Step 7: Deleting agent...");
		await actionMenuBtn.click();
		await page.getByRole("menuitem", { name: "Delete" }).click();

		// Confirm in dialog
		await expect(page.getByRole("heading", { name: `Delete "Turnover AI"?` })).toBeVisible({ timeout: 5000 });
		await page.getByRole("button", { name: "Delete agent" }).click();

		await expect(page.getByText("Agent deleted.")).toBeVisible({ timeout: 5000 });
		await expect(agentRow).toBeHidden();
		console.log("Soft-delete verified: row has disappeared.");

		// --- 8. Sign out to test negative path ---
		console.log("Step 8: Logging out to test negative path...");
		await page.context().clearCookies();

		// --- 9. Negative path — non-admin redirect ---
		console.log("Step 9: Testing Negative Path (Non-admin member redirect)...");
		await page.goto("/login");

		await page.getByRole("tab", { name: "Magic link" }).click();
		await page.getByRole("textbox", { name: /email/i }).fill(nonAdminEmail);
		await page.getByRole("button", { name: "Send magic link" }).click();

		await expect(page.locator("div").filter({ hasText: "Link sent" }).first()).toBeVisible({ timeout: 15000 });

		console.log("Waiting for non-admin magic link token in DB...");
		const nonAdminRow = await waitForVerificationForEmail(nonAdminEmail);
		const nonAdminToken = nonAdminRow.value;

		const nonAdminCallbackUrl = `http://localhost:3000/api/auth/magic-link/verify?token=${nonAdminToken}&callbackURL=http://localhost:3000/virn/settings/agents`;
		await page.goto(nonAdminCallbackUrl);

		// Expect redirect to /virn/settings/general
		await page.waitForURL(/\/settings\/general/, { timeout: 25000 });
		expect(page.url().endsWith("/settings/general")).toBe(true);
		console.log("Negative path verified: non-admin was redirected successfully to settings/general");
	});
});
