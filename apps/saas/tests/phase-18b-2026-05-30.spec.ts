import { expect, test, type Page } from "@playwright/test";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { waitForVerificationForEmail } from "./__helpers/db";
import { getArtifactsDir } from "./__helpers/artifacts";
import {
	db,
	organization,
	playbook,
	playbookRun,
	playbookStep,
	playbookVersion,
	user,
} from "@virn/database";
import { and, eq, like } from "drizzle-orm";

// Phase 18b-3 -- headless verification of the playbook EXECUTION UI (Run button,
// execute-view banner, cancel). DB-seeded + deterministic: no Antigravity, and no
// Inngest runtime required -- the orchestrator's step logic is unit-tested
// (orchestrator.test.ts) and the durable advance is smoke-tested against a local
// Inngest Dev Server separately. Here we pin the React surfaces:
//   - the execute-view banner renders a waiting run's status + next-wake countdown
//     + Cancel control (seeded run, ?runId)
//   - Cancel flips the run to 'cancelled' (pure DB op, no runtime)
//   - the "Run playbook" button renders on a published playbook's Read view
// (We don't CLICK Run here -- launchManual emits an Inngest event, which needs the
//  runtime; that path is the Dev Server smoke + the launchManual contract test.)

const specName = "phase-18b-2026-05-30";
const tempDir = path.join(os.tmpdir(), `${specName}-temp`);
const orgSlug = "virn";
const nonce = Date.now();

const pbId = `pb_e2e18b_${nonce}`;
const pbName = `E2E 18b Exec ${nonce}`;
const verId = `pbv_e2e18b_${nonce}`;
const stepId = `pbs_e2e18b_${nonce}`;
const waitingRunId = `pbr_wait_${nonce}`;

async function loginAsEmail(page: Page, email: string, callbackURLPath: string) {
	await page.goto("/login");
	await page.getByRole("tab", { name: "Magic link" }).click();
	await page.getByRole("textbox", { name: /email/i }).fill(email);
	await page.getByRole("button", { name: "Send magic link" }).click();
	const successAlert = page.locator("div").filter({ hasText: "Link sent" }).first();
	await expect(successAlert).toBeVisible({ timeout: 15000 });
	const row = await waitForVerificationForEmail(email);
	const callbackUrl = `http://localhost:3000/api/auth/magic-link/verify?token=${row.value}&callbackURL=http://localhost:3000${callbackURLPath}`;
	await page.goto(callbackUrl);
	await page.waitForLoadState("networkidle");
}

test.describe.serial("Phase 18b-3 -- playbook execution UI", () => {
	let orgId: string;

	test.beforeAll(async () => {
		test.setTimeout(60000);
		fs.mkdirSync(tempDir, { recursive: true });

		const org = await db.query.organization.findFirst({
			where: eq(organization.slug, orgSlug),
		});
		if (!org) throw new Error("Preseeded org 'virn' not found");
		orgId = org.id;
		const admin = await db.query.user.findFirst({
			where: eq(user.email, "pgrennell@gmail.com"),
		});
		if (!admin) throw new Error("Preseeded admin user not found");
		await db
			.update(user)
			.set({ lastActiveOrganizationId: orgId })
			.where(eq(user.id, admin.id));

		// Clean any leftover E2E playbooks (delete runs first -- version FK isn't cascade).
		const stale = await db
			.select({ vId: playbookVersion.id })
			.from(playbookVersion)
			.innerJoin(playbook, eq(playbook.id, playbookVersion.playbookId))
			.where(and(eq(playbook.organizationId, orgId), like(playbook.name, "E2E 18b %")));
		for (const s of stale) {
			await db.delete(playbookRun).where(eq(playbookRun.playbookVersionId, s.vId));
		}
		await db
			.delete(playbook)
			.where(and(eq(playbook.organizationId, orgId), like(playbook.name, "E2E 18b %")));

		// Seed a published playbook with one step.
		await db.insert(playbook).values({
			id: pbId,
			organizationId: orgId,
			name: pbName,
			reviewState: "published",
			isActive: false,
			createdBy: admin.id,
			createdAt: new Date(),
			updatedAt: new Date(),
		});
		await db.insert(playbookVersion).values({
			id: verId,
			playbookId: pbId,
			versionNumber: 1,
			triggerType: "manual",
			publishedAt: new Date(),
			publishedBy: admin.id,
			createdAt: new Date(),
			updatedAt: new Date(),
		});
		await db.insert(playbookStep).values({
			id: stepId,
			playbookVersionId: verId,
			position: 0,
			type: "send_notification",
			config: { type: "APP_UPDATE" },
			createdAt: new Date(),
			updatedAt: new Date(),
		});

		// Seed a waiting run for the execute-view scenarios.
		await db.insert(playbookRun).values({
			id: waitingRunId,
			organizationId: orgId,
			playbookVersionId: verId,
			status: "waiting",
			triggerPayload: { source: "e2e-seed" },
			triggerFingerprint: `e2e:${nonce}:wait`,
			currentStepId: stepId,
			nextWakeAt: new Date(Date.now() + 60 * 60 * 1000),
			startedAt: new Date(),
			createdAt: new Date(),
			updatedAt: new Date(),
		});
	});

	test.beforeEach(async ({ page }) => {
		test.setTimeout(60000);
		page.on("pageerror", (err) =>
			console.error(`[Browser Uncaught Error]: ${err.message}`),
		);
	});

	test("P0 — A: execute-view banner shows a waiting run + countdown + Cancel", async ({ page }) => {
		await loginAsEmail(page, "pgrennell@gmail.com", `/virn/playbooks/${pbId}/read?runId=${waitingRunId}`);
		await page.waitForLoadState("networkidle");

		// Banner: "Run" label + status badge "waiting" + a next-wake hint + Cancel.
		await expect(page.getByText("waiting", { exact: true })).toBeVisible({ timeout: 15000 });
		await expect(page.getByText(/next wake in/i)).toBeVisible();
		await expect(page.getByRole("button", { name: "Cancel run" })).toBeVisible();
		await page.screenshot({ path: path.join(tempDir, "01-execute-view-waiting.png") });
	});

	test("P0 — B: Cancel run flips the banner to cancelled", async ({ page }) => {
		await loginAsEmail(page, "pgrennell@gmail.com", `/virn/playbooks/${pbId}/read?runId=${waitingRunId}`);
		await page.waitForLoadState("networkidle");

		await page.getByRole("button", { name: "Cancel run" }).click();
		await expect(page.getByText("cancelled", { exact: true })).toBeVisible({ timeout: 15000 });
		await expect(page.getByRole("button", { name: "Cancel run" })).toBeHidden();
		await page.screenshot({ path: path.join(tempDir, "02-execute-view-cancelled.png") });

		// Persisted: a fresh load still shows cancelled.
		await page.reload();
		await page.waitForLoadState("networkidle");
		await expect(page.getByText("cancelled", { exact: true })).toBeVisible({ timeout: 15000 });
	});

	test("P0 — C: Run playbook button renders on a published Read view", async ({ page }) => {
		await loginAsEmail(page, "pgrennell@gmail.com", `/virn/playbooks/${pbId}/read`);
		await page.waitForLoadState("networkidle");

		await expect(page.getByText("Published v1", { exact: true })).toBeVisible({ timeout: 15000 });
		await expect(page.getByRole("button", { name: "Run playbook" })).toBeVisible();
		await page.screenshot({ path: path.join(tempDir, "03-run-button.png") });
	});

	test.afterAll(async () => {
		try {
			await db.delete(playbookRun).where(eq(playbookRun.playbookVersionId, verId));
			await db.delete(playbook).where(eq(playbook.id, pbId));
		} catch (err) {
			console.error("Teardown error:", err);
		}
		try {
			const finalDir = getArtifactsDir(specName);
			fs.mkdirSync(finalDir, { recursive: true });
			if (fs.existsSync(tempDir)) {
				for (const file of fs.readdirSync(tempDir)) {
					fs.copyFileSync(path.join(tempDir, file), path.join(finalDir, file));
				}
				fs.rmSync(tempDir, { recursive: true, force: true });
			}
		} catch (err) {
			console.error("Artifact copy error:", err);
		}
	});
});
