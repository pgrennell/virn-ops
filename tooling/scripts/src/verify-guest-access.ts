// tooling/scripts/src/verify-guest-access.ts
//
// Fully automated end-to-end self-contained verification script for tokenized guest run access.

import {
	db,
	run,
	participant,
	participantToken,
	revokeParticipantToken,
	getOrganizationBySlug,
	getUserByEmail,
	insertRunSnapshot,
	issueParticipantToken,
} from "@virn/database";
import { logger } from "@virn/logs";
import { eq } from "drizzle-orm";

const BASE_URL = "http://localhost:3000/api";
const DEMO_WORKFLOW_TITLE = "[Demo] Onboarding";

async function makePostRequest(path: string, body: Record<string, any>) {
	const res = await fetch(`${BASE_URL}${path}`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`HTTP error ${res.status}: ${text}`);
	}
	return await res.json();
}

async function buildLaunchBundle(workflowVersionId: string): Promise<{
	workflowId: string;
	steps: Array<{
		stepId: string;
		title: string;
		description: string | null;
		position: number;
		assignedRoleId: string | null;
		dueAt: Date | null;
	}>;
	customerNameFieldId: string;
}> {
	const version = await db.query.workflowVersion.findFirst({
		where: (v, { eq: e }) => e(v.id, workflowVersionId),
		with: {
			steps: true,
			fields: true,
		},
	});
	if (!version) throw new Error(`Workflow version ${workflowVersionId} vanished`);

	const customerNameField = version.fields.find((f) => f.key === "customer_name" && f.stepId === null);
	if (!customerNameField) throw new Error("Demo workflow missing kickoff `customer_name`");

	const start = new Date();
	const steps = version.steps
		.sort((a, b) => a.position - b.position)
		.map((s) => ({
			stepId: s.id,
			title: s.title,
			description: s.description,
			position: s.position,
			assignedRoleId: s.assignedRoleId,
			dueAt:
				s.dueType === "offset_from_start" && typeof s.dueOffsetDays === "number"
					? new Date(start.getTime() + s.dueOffsetDays * 24 * 60 * 60 * 1000)
					: null,
		}));

	const wf = await db.query.workflow.findFirst({
		where: (w, { eq: e }) => e(w.id, version.workflowId),
		columns: { id: true },
	});
	if (!wf) throw new Error(`Workflow ${version.workflowId} vanished`);

	return { workflowId: wf.id, steps, customerNameFieldId: customerNameField.id };
}

async function main() {
	logger.info("=== Starting Guest Run Access E2E Verification ===");

	const orgSlug = "virn";
	const org = await getOrganizationBySlug(orgSlug);
	if (!org) {
		logger.error(`No org with slug "${orgSlug}".`);
		process.exit(1);
	}

	const adminEmail = "pgrennell@gmail.com";
	const user = await getUserByEmail(adminEmail);
	if (!user) {
		logger.error(`No user with email "${adminEmail}".`);
		process.exit(1);
	}

	// 1. Find the existing demo workflow
	let existingWorkflow = await db.query.workflow.findFirst({
		where: (w, { and: a, eq: e }) =>
			a(e(w.organizationId, org.id), e(w.title, DEMO_WORKFLOW_TITLE)),
		with: {
			versions: {
				where: (v, { eq: e }) => e(v.status, "published"),
				orderBy: (v, { desc }) => [desc(v.versionNumber)],
				limit: 1,
			},
		},
	});

	let publishedVersionId: string;
	let operatorRoleId: string;

	if (existingWorkflow && existingWorkflow.versions[0]) {
		publishedVersionId = existingWorkflow.versions[0].id;
		const role = await db.query.workflowRole.findFirst({
			where: (r, { and: a, eq: e }) =>
				a(e(r.organizationId, org.id), e(r.name, "Operator (Demo)")),
		});
		if (!role) {
			logger.error("Operator role missing.");
			process.exit(1);
		}
		operatorRoleId = role.id;
	} else {
		logger.error("Demo workflow not found. Please run seed:demo-workflow first.");
		process.exit(1);
	}

	// 2. Launch a completely fresh, isolated guest run for this E2E run
	logger.info("1. Launching a fresh guest run for E2E...");
	const bundle = await buildLaunchBundle(publishedVersionId);
	
	const { runId } = await insertRunSnapshot({
		organizationId: org.id,
		workflowId: bundle.workflowId,
		workflowVersionId: publishedVersionId,
		title: `[E2E Guest Access Test] — ${new Date().toLocaleTimeString()}`,
		createdBy: user.id,
		startedAt: new Date(),
		runDueAt: null,
		steps: bundle.steps,
		kickoffValues: [{ fieldId: bundle.customerNameFieldId, value: "E2E Guest Verification Inc." }],
		participants: [
			{ tempKey: "p_user", kind: "user", userId: user.id, guestEmail: null, guestName: null, agentId: null },
			{ tempKey: "p_guest", kind: "guest", userId: null, guestEmail: "e2e-guest@example.com", guestName: "E2E Guest User", agentId: null }
		],
		roleAssignments: [
			{ roleId: operatorRoleId, participantTempKey: "p_user" }
		],
		stepAssignments: bundle.steps.map((s, idx) => ({
			stepId: s.stepId,
			participantTempKey: idx === 0 ? "p_guest" : "p_user",
		})),
	});

	logger.success(`Launched run ID: ${runId}`);

	// 3. Find the guest participant ID
	const guestParticipant = await db.query.participant.findFirst({
		where: (p, { and: a, eq: e, isNull: n }) =>
			a(e(p.runId, runId), n(p.userId), e(p.guestEmail, "e2e-guest@example.com")),
	});

	if (!guestParticipant) {
		logger.error("Guest participant row not found in DB!");
		process.exit(1);
	}
	logger.success(`Resolved Guest Participant ID: ${guestParticipant.id}`);

	// 4. Issue a fresh participant token
	logger.info("2. Issuing a fresh guest participant token...");
	const tokenBundle = await issueParticipantToken({
		organizationId: org.id,
		participantId: guestParticipant.id,
		issuedByUserId: user.id,
	});
	const TOKEN = tokenBundle.plaintext;
	logger.success(`Issued token. Plaintext: ${TOKEN}`);

	// 5. Fetch Guest Run Bundle (runs.getForGuest)
	logger.info("3. Fetching guest run bundle via REST /runs/guest/get...");
	let getRes: any;
	try {
		getRes = await makePostRequest("/runs/guest/get", { token: TOKEN });
		logger.success("Guest run bundle fetched successfully!");
	} catch (e: any) {
		logger.error("Failed to fetch guest run bundle:", e.message);
		process.exit(1);
	}

	// Print sanitized response body for security auditing
	const sanitized = {
		...getRes,
		tokenHash: "[REDACTED]",
	};
	console.log("\n=== POST /api/runs/guest/get Response Body ===");
	console.log(JSON.stringify(sanitized, null, 2));
	console.log("==================================================\n");

	// Perform leak audit
	logger.info("4. Performing leak audit...");
	const leaksDetected = [];
	
	// Check for kickoff data
	if (getRes.kickoffValues || getRes.kickoffFields || getRes.run?.kickoffValues) {
		leaksDetected.push("kickoff data");
	}
	
	// Check for other participants
	if (getRes.participants || getRes.otherParticipants) {
		leaksDetected.push("other participants");
	}
	
	// Check for other runs
	if (getRes.runs || getRes.allRuns) {
		leaksDetected.push("other runs");
	}

	// Check for workflow definition graph
	if (getRes.workflow?.versions || getRes.workflowDefinition) {
		leaksDetected.push("workflow definition graph");
	}

	if (leaksDetected.length > 0) {
		logger.error(`LEAK AUDIT FAILED! Detected leaks of: ${leaksDetected.join(", ")}`);
		process.exit(1);
	} else {
		logger.success("Leak audit passed: No kickoff data, other participants, other runs, or workflow definition graph leaked.");
	}

	// Confirm structure
	const firstStep = getRes.steps[0];
	if (!firstStep) {
		logger.error("No steps assigned to the guest in this run!");
		process.exit(1);
	}
	logger.info(`Guest Step 1 Details: Title="${firstStep.title}", StepType="${firstStep.stepType}", Status="${firstStep.status}", CanComplete=${firstStep.canComplete}`);
	
	const runStepId = firstStep.runStepId;
	const fieldKey = "reference_number";
	const field = firstStep.fields.find((f: any) => f.key === fieldKey);
	if (!field) {
		logger.error(`Field '${fieldKey}' not found on first step!`);
		process.exit(1);
	}
	logger.info(`Field on Step 1: Key="${field.key}", Label="${field.label}", IsRequired=${field.isRequired}, CurrentValue="${field.value}"`);

	// 6. Field Save: Set Field Value As Guest (runs.setFieldValueAsGuest)
	logger.info("\n5. Testing field save as guest via REST /runs/guest/field-value...");
	try {
		const saveRes = await makePostRequest("/runs/guest/field-value", {
			token: TOKEN,
			runStepId,
			fieldKey,
			value: "REF-TEST-GUEST-999",
		});
		logger.success(`Field value set successfully! Response:`, JSON.stringify(saveRes));
	} catch (e: any) {
		logger.error("Failed to set field value as guest:", e.message);
		process.exit(1);
	}

	// Re-fetch and verify persistence
	logger.info("Re-fetching guest bundle to verify persistence...");
	const getRes2 = await makePostRequest("/runs/guest/get", { token: TOKEN });
	const updatedField = getRes2.steps[0].fields.find((f: any) => f.key === fieldKey);
	if (updatedField.value !== "REF-TEST-GUEST-999") {
		logger.error(`Value persistence check failed! Expected "REF-TEST-GUEST-999" but got "${updatedField.value}"`);
		process.exit(1);
	}
	logger.success(`Value persistence verified! Field value is "${updatedField.value}".`);

	// 7. Complete Step As Guest (runs.completeStepAsGuest)
	logger.info("\n6. Testing complete step as guest via REST /runs/guest/complete-step...");
	try {
		const completeRes = await makePostRequest("/runs/guest/complete-step", {
			token: TOKEN,
			runStepId,
		});
		logger.success(`Step completed successfully! Response:`, JSON.stringify(completeRes));
	} catch (e: any) {
		logger.error("Failed to complete step as guest:", e.message);
		process.exit(1);
	}

	// Re-fetch and verify status
	logger.info("Re-fetching guest bundle to verify step status...");
	const getRes3 = await makePostRequest("/runs/guest/get", { token: TOKEN });
	const completedStep = getRes3.steps[0];
	if (completedStep.status !== "completed") {
		logger.error(`Step status verify failed! Expected "completed" but got "${completedStep.status}"`);
		process.exit(1);
	}
	logger.success(`Step completion verified! Step status is now "completed".`);

	// 8. Test Negative Path: Tampered Token
	logger.info("\n7. Testing negative path: tampered token...");
	try {
		await makePostRequest("/runs/guest/get", { token: "garbage_garbage_garbage_garbage_garbage" });
		logger.error("Negative path failed: tampered token did NOT reject!");
		process.exit(1);
	} catch (e: any) {
		logger.success(`Negative path passed: tampered token rejected successfully with error: ${e.message}`);
	}

	// 9. Test D-016 guard: run NOT active
	logger.info("\n8. Testing negative path: D-016 run completed (non-active)...");
	// Mark the run as completed directly in the DB to simulate admin completing it
	await db
		.update(run)
		.set({ status: "completed", completedAt: new Date(), updatedAt: new Date() })
		.where(eq(run.id, runId));
	logger.info("Run marked as completed in database.");

	// Now try to mutate field value or complete step using the still-valid token
	try {
		await makePostRequest("/runs/guest/field-value", {
			token: TOKEN,
			runStepId,
			fieldKey,
			value: "REF-TEST-GUEST-AFTER-COMPLETE",
		});
		logger.error("D-016 negative path failed: field value update on completed run did NOT reject!");
		process.exit(1);
	} catch (e: any) {
		logger.success(`D-016 negative path passed: field value update rejected on completed run: ${e.message}`);
	}

	try {
		await makePostRequest("/runs/guest/complete-step", {
			token: TOKEN,
			runStepId,
		});
		logger.error("D-016 negative path failed: step completion on completed run did NOT reject!");
		process.exit(1);
	} catch (e: any) {
		logger.success(`D-016 negative path passed: step completion rejected on completed run: ${e.message}`);
	}

	// Reset run status back to active for the next verification test (token revocation)
	await db
		.update(run)
		.set({ status: "active", completedAt: null, updatedAt: new Date() })
		.where(eq(run.id, runId));
	logger.info("Run status reset back to active.");

	// 10. Test Token Revocation
	logger.info("\n9. Testing token revocation...");
	const activeTokenRow = await db.query.participantToken.findFirst({
		where: (t, { eq: e }) =>
			e(t.participantId, guestParticipant.id),
	});
	if (!activeTokenRow) {
		logger.error("Could not find the participant token row in DB!");
		process.exit(1);
	}

	// Revoke via DB update or standard query helper
	await revokeParticipantToken({
		organizationId: org.id,
		tokenId: activeTokenRow.id,
	});
	logger.info(`Token ${activeTokenRow.id} marked as revoked in database.`);

	// Re-fetch using revoked token and verify it fails
	try {
		await makePostRequest("/runs/guest/get", { token: TOKEN });
		logger.error("Revocation negative path failed: revoked token did NOT reject!");
		process.exit(1);
	} catch (e: any) {
		logger.success(`Revocation negative path passed: revoked token rejected successfully: ${e.message}`);
	}

	logger.info("\n=== All E2E Verification Steps Completed Successfully! ===");
}

main().catch((err) => {
	logger.error(err);
	process.exit(1);
});
