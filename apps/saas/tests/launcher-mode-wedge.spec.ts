import { expect, test } from "@playwright/test";
import * as path from "node:path";
import { waitForVerificationForEmail } from "./__helpers/db";
import { db, agent, user, member, organization, organizationCapability, capability, participant } from "@virn/database";
import { eq, and } from "drizzle-orm";

const artifactsDir = "C:\\Users\\pgren\\.gemini\\antigravity-ide\\brain\\8793271f-5d9f-43fe-80e3-12ec2ef2d9b2";

test.describe("Virn Ops Launch-mode wedge UX E2E Walk (S-07)", () => {
	let orgId: string;
	let workflowTitle: string;
	let workflowId: string | null = null;
	let createdAgentId: string | null = null;

	test.beforeAll(async () => {
		// Clean up any stale Turnover AI agents or test workflows
		const staleAgent = await db.query.agent.findFirst({
			where: eq(agent.name, "Turnover AI"),
		});
		if (staleAgent) {
			await db.delete(participant).where(eq(participant.agentId, staleAgent.id));
			await db.delete(agent).where(eq(agent.id, staleAgent.id));
		}

		// Get the organization ID for slug 'virn'
		const org = await db.query.organization.findFirst({
			where: eq(organization.slug, "virn"),
		});
		if (!org) {
			throw new Error("Preseeded organization with slug 'virn' not found");
		}
		orgId = org.id;

		// Force-enable workflows.agent_steps capability in the database for organization 'virn'
		const cap = await db.query.capability.findFirst({
			where: eq(capability.key, "workflows.agent_steps"),
		});
		if (!cap) {
			throw new Error("workflows.agent_steps capability definition not found in catalog");
		}

		const override = await db.query.organizationCapability.findFirst({
			where: and(
				eq(organizationCapability.organizationId, orgId),
				eq(organizationCapability.capabilityId, cap.id)
			),
		});

		if (override) {
			await db.update(organizationCapability)
				.set({ enabled: true })
				.where(and(
					eq(organizationCapability.organizationId, orgId),
					eq(organizationCapability.capabilityId, cap.id)
				));
		} else {
			await db.insert(organizationCapability).values({
				organizationId: orgId,
				capabilityId: cap.id,
				enabled: true,
			});
		}
		console.log("Force-enabled workflows.agent_steps capability for organization 'virn'");
	});

	test.afterAll(async () => {
		// Clean up agent and participant references
		if (createdAgentId) {
			await db.delete(participant).where(eq(participant.agentId, createdAgentId));
		}
		await db.delete(agent).where(eq(agent.name, "Turnover AI"));
		console.log("Cleaned up Turnover AI agent and its participant references.");
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

	test("Execute E2E Launcher Mode Wedge Walk", async ({ page }) => {
		test.setTimeout(150000);

		// --- 1. Authenticate as admin pgrennell@gmail.com ---
		console.log("Authenticating admin pgrennell@gmail.com...");
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

		// Wait for settings/agents to load
		await expect(page.getByRole("heading", { name: "Agents", exact: true }).first()).toBeVisible({ timeout: 20000 });

		// --- 2. Create the active agent "Turnover AI" via UI ---
		console.log("Creating active agent 'Turnover AI' via settings UI...");
		const newAgentBtn = page.getByRole("button", { name: /New agent|Create your first agent/ }).first();
		await newAgentBtn.click();

		await expect(page.getByRole("heading", { name: "Create an agent" })).toBeVisible({ timeout: 5000 });
		await page.locator("input#agent-name").fill("Turnover AI");
		await page.locator("input#agent-description").fill("Handles STR turnover runs end-to-end");
		await page.getByRole("button", { name: "Create agent" }).click();

		// Wait for reveal dialog, checkbox-close
		const revealTitle = page.getByRole("heading", { name: "Agent created" });
		await expect(revealTitle).toBeVisible({ timeout: 10000 });

		// Check the checkbox to enable Close
		await page.getByText("I've stored the credential").click();
		const closeBtn = page.getByRole("button", { name: "Close" }).first();
		await expect(closeBtn).toBeEnabled();
		await closeBtn.click();
		await expect(revealTitle).toBeHidden();

		// Confirm it appears in DB and capture its ID
		const dbAgent = await db.query.agent.findFirst({
			where: eq(agent.name, "Turnover AI"),
		});
		if (!dbAgent) throw new Error("Agent Turnover AI not found in DB after UI creation");
		createdAgentId = dbAgent.id;
		console.log(`Successfully created agent Turnover AI with ID: ${createdAgentId}`);

		// --- 3. Create a workflow with at least ONE AI-typed step in Builder ---
		console.log("Creating test workflow with AI step...");
		await page.goto("/virn/library");
		await expect(page.getByRole("heading", { name: "Library", exact: true })).toBeVisible({ timeout: 20000 });

		await page.locator("header").filter({ hasText: "Library" }).getByRole("button", { name: "Create" }).click();
		await page.getByRole("menuitem", { name: "New workflow" }).click();

		// Wait for redirect to builder
		await page.waitForURL(/\/library\/workflows\/.*\/builder/, { timeout: 15000 });
		const currentUrl = page.url();
		const match = currentUrl.match(/\/workflows\/([a-zA-Z0-9_-]+)\/builder/);
		if (match) {
			workflowId = match[1];
			console.log("Captured Workflow ID:", workflowId);
		} else {
			throw new Error(`Failed to extract workflow ID from URL: ${currentUrl}`);
		}

		workflowTitle = `E2E Wedge ${Date.now()}`;
		console.log("Renaming workflow to:", workflowTitle);

		// Patch workflow title via API call
		await page.evaluate(async ({ workflowId, title }) => {
			const res = await fetch(`/api/workflows/${workflowId}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ workflowId, title }),
			});
			if (!res.ok) throw new Error("Failed to rename workflow");
		}, { workflowId: workflowId!, title: workflowTitle });

		await page.reload();
		await expect(page.locator("h1", { hasText: workflowTitle }).first()).toBeVisible({ timeout: 15000 });

		// Add a section, step, and configure step type to AI
		console.log("Adding step and configuring it as AI type...");
		await page.locator("aside").getByRole("button", { name: "Add section" }).click();
		const addStepBtn = page.locator("aside").getByRole("button", { name: "Add step" }).first();
		await expect(addStepBtn).toBeVisible({ timeout: 10000 });
		await addStepBtn.click();

		const stepRow = page.locator("aside").locator("button").filter({ hasText: "Untitled step" }).first();
		await expect(stepRow).toBeVisible({ timeout: 10000 });
		await stepRow.click();

		const configStepBtn = page.locator("section").getByRole("button", { name: "Configure step" });
		await expect(configStepBtn).toBeVisible({ timeout: 10000 });
		await configStepBtn.click();

		// Select step type AI
		console.log("Setting step type to 'AI'...");
		const stepTypeSelect = page.locator("div").filter({ has: page.getByText("Step type", { exact: true }) }).getByRole("combobox").first();
		await stepTypeSelect.click();
		await page.getByRole("option", { name: "AI" }).first().click();

		// Close settings
		await page.getByRole("button", { name: "Close settings" }).click();
		await expect(page.getByRole("heading", { name: "Step settings" })).toBeHidden();

		// Publish workflow
		console.log("Publishing workflow...");
		const publishBtn = page.getByRole("button", { name: "Publish" });
		await publishBtn.click();

		const editBtn = page.getByRole("button", { name: "Edit" });
		await expect(editBtn).toBeVisible({ timeout: 15000 });
		await expect(page.getByText("Published", { exact: true }).first()).toBeVisible();

		// --- 4. Open Launcher Drawer ---
		console.log("Navigating back to library and opening launcher drawer...");
		await page.goto("/virn/library");
		await expect(page.getByRole("heading", { name: "Library", exact: true })).toBeVisible({ timeout: 15000 });

		const wfRow = page.locator("li").filter({ hasText: workflowTitle }).first();
		await expect(wfRow).toBeVisible();
		await wfRow.getByRole("button", { name: "Run…" }).click();

		// Expect Launcher drawer to open
		await expect(page.getByRole("heading", { name: `Launch ${workflowTitle}` })).toBeVisible({ timeout: 10000 });

		// --- 5. Verify Launch Mode Picker UX ---
		console.log("Verifying Launch Mode cards and default selection...");
		const launchModeLabel = page.getByText("Launch mode", { exact: true }).first();
		await expect(launchModeLabel).toBeVisible();

		// Confirm 3 cards are visible: Human, AI-assisted, Automated
		const humanCard = page.getByRole("button").filter({ hasText: "Human" }).first();
		const aiAssistedCard = page.getByRole("button").filter({ hasText: "AI-assisted" }).first();
		const automatedCard = page.getByRole("button").filter({ hasText: "Automated" }).first();

		await expect(humanCard).toBeVisible();
		await expect(aiAssistedCard).toBeVisible();
		await expect(automatedCard).toBeVisible();

		// Human card should be selected by default and check mark is visible
		const humanCheckMark = humanCard.locator("svg.lucide-check");
		await expect(humanCheckMark).toBeVisible();

		// Confirm no agent picker is visible
		const agentLabel = page.getByText("Agent", { exact: true });
		await expect(agentLabel).toBeHidden();

		await page.screenshot({ path: path.join(artifactsDir, "01_default_human.png") });
		console.log("Saved: 01_default_human.png");

		// Click AI-assisted card
		console.log("Clicking AI-assisted...");
		await aiAssistedCard.click();
		await expect(aiAssistedCard.locator("svg.lucide-check")).toBeVisible();

		// Confirm Agent dropdown appears below
		const agentTrigger = page.locator("div").filter({ has: page.getByText("Agent", { exact: true }) }).getByRole("combobox").first();
		await expect(agentTrigger).toBeVisible();
		// No step preview block yet since no agent is picked
		await expect(page.getByText("will handle")).toBeHidden();

		await page.screenshot({ path: path.join(artifactsDir, "04_ai_assisted_picker.png") });
		console.log("Saved: 04_ai_assisted_picker.png");

		// Open agent dropdown and pick "Turnover AI"
		console.log("Selecting Turnover AI...");
		await agentTrigger.click();
		await page.getByRole("option", { name: "Turnover AI", exact: true }).first().click();

		// Confirm preview block appears showing AI step title
		const previewBlock = page.getByText("Turnover AI will handle 1 AI step:");
		await expect(previewBlock).toBeVisible();
		await expect(page.getByText("• Untitled step")).toBeVisible();

		await page.screenshot({ path: path.join(artifactsDir, "05_preview_block.png") });
		console.log("Saved: 05_preview_block.png");

		// Click Automated card
		console.log("Clicking Automated...");
		await automatedCard.click();
		await expect(automatedCard.locator("svg.lucide-check")).toBeVisible();

		// Confirm preview block updates to show all N steps
		const automatedPreviewBlock = page.getByText("Turnover AI will handle all 1 steps:");
		await expect(automatedPreviewBlock).toBeVisible();

		await page.screenshot({ path: path.join(artifactsDir, "06_automated_preview.png") });
		console.log("Saved: 06_automated_preview.png");

		// Click back to Human
		console.log("Clicking Human...");
		await humanCard.click();
		await expect(agentTrigger).toBeHidden();
		await expect(previewBlock).toBeHidden();

		// --- 6. Intercept Launch and verify payload ---
		console.log("Re-selecting AI-assisted and submitting launch...");
		await aiAssistedCard.click();
		await agentTrigger.click();
		await page.getByRole("option", { name: "Turnover AI", exact: true }).first().click();
		await expect(previewBlock).toBeVisible();

		// Launch the run and intercept network call
		console.log("Intercepting runs.launch mutation...");
		const [response] = await Promise.all([
			page.waitForResponse(resp => resp.url().includes("/api/rpc/runs/launch")),
			page.getByRole("button", { name: "Launch", exact: true }).click()
		]);

		const request = response.request();
		const requestBody = JSON.parse(request.postData() || "{}");
		console.log("Wire check — intercepted payload:", JSON.stringify(requestBody));

		expect(requestBody.json.mode).toBe("ai_assisted");
		expect(requestBody.json.agentId).toBe(createdAgentId);
		console.log("Wire check PASS: launch request successfully includes correct mode and agentId!");

		// --- 7. Confirm redirect and Agent assignment in Run view ---
		await page.waitForURL(/\/runs\/[a-zA-Z0-9_-]+/, { timeout: 25000 });
		console.log("Successfully launched, redirected to run page:", page.url());

		// Verify the step row displays "Turnover AI" as assignee
		await expect(page.locator("h1", { hasText: workflowTitle }).first()).toBeVisible({ timeout: 15000 });
		const stepHeading = page.getByRole("heading", { name: "Untitled step" });
		await expect(stepHeading).toBeVisible();

		// The step detail / pane should display Turnover AI as the assignee
		await expect(page.getByText("Turnover AI").first()).toBeVisible({ timeout: 10000 });
		console.log("Confirmed: Run view correctly displays Turnover AI as the step assignee!");

		await page.screenshot({ path: path.join(artifactsDir, "09_run_view_agent_assignee.png") });
		console.log("Saved: 09_run_view_agent_assignee.png");

		// --- 8. Negative path — submit without agent ---
		console.log("Verifying Negative Path (Submit without agent)...");
		await page.goto("/virn/library");
		await expect(page.getByRole("heading", { name: "Library", exact: true })).toBeVisible({ timeout: 15000 });
		await wfRow.getByRole("button", { name: "Run…" }).click();
		await expect(page.getByRole("heading", { name: `Launch ${workflowTitle}` })).toBeVisible({ timeout: 10000 });

		await aiAssistedCard.click();
		// Assert launch button is disabled because no agent is selected
		const launchButton = page.getByRole("button", { name: "Launch", exact: true });
		await expect(launchButton).toBeDisabled();
		console.log("Negative path PASS: Launch button is disabled when agent is not picked!");

		await page.screenshot({ path: path.join(artifactsDir, "10_submit_disabled.png") });
		console.log("Saved: 10_submit_disabled.png");

		// --- 9. Negative path — disabled mode (zero AI steps) ---
		console.log("Verifying Negative Path (Disabled mode with zero AI steps)...");
		// Locate [Demo] Onboarding (which has 0 AI steps)
		const demoWfRow = page.locator("li").filter({ hasText: "[Demo] Onboarding" }).first();
		await expect(demoWfRow).toBeVisible();
		await demoWfRow.getByRole("button", { name: "Run…" }).click();

		await expect(page.getByRole("heading", { name: "Launch [Demo] Onboarding" })).toBeVisible({ timeout: 10000 });

		const demoAiAssistedCard = page.getByRole("button").filter({ hasText: "AI-assisted" }).first();
		const demoAutomatedCard = page.getByRole("button").filter({ hasText: "Automated" }).first();

		// AI-assisted card should be disabled and show reason
		await expect(demoAiAssistedCard).toBeDisabled();
		const disabledReasonText = page.getByText("This workflow has no AI-shaped steps. Mark a step as AI in the Builder to use this mode.");
		await expect(disabledReasonText).toBeVisible();

		// Automated card should still be enabled
		await expect(demoAutomatedCard).toBeEnabled();
		console.log("Negative path PASS: AI-assisted card is disabled for workflow with zero AI steps!");

		await page.screenshot({ path: path.join(artifactsDir, "11_no_ai_steps_disabled.png") });
		console.log("Saved: 11_no_ai_steps_disabled.png");

		// --- 10. Negative path — no active agents ---
		console.log("Verifying Negative Path (No active agents)...");
		// Deactivate the agent in DB
		await db.update(agent).set({ isActive: false }).where(eq(agent.name, "Turnover AI"));
		console.log("Deactivated Turnover AI agent in database.");

		// Reload/reopen launcher to see updated state
		await page.reload();
		await expect(page.getByRole("heading", { name: "Library", exact: true })).toBeVisible({ timeout: 15000 });
		await demoWfRow.getByRole("button", { name: "Run…" }).click();
		await expect(page.getByRole("heading", { name: "Launch [Demo] Onboarding" })).toBeVisible({ timeout: 10000 });

		const finalAiAssisted = page.getByRole("button").filter({ hasText: "AI-assisted" }).first();
		const finalAutomated = page.getByRole("button").filter({ hasText: "Automated" }).first();

		// Both cards should show disabled with no-agents reason
		await expect(finalAiAssisted).toBeDisabled();
		await expect(finalAutomated).toBeDisabled();
		
		const noAgentsReason = page.getByText("No active agents in this org. Create one in Settings → Agents.");
		await expect(noAgentsReason.first()).toBeVisible();
		console.log("Negative path PASS: Both agent-based launch cards are disabled when no active agents exist!");
	});
});
