// tooling/scripts/src/launch-guest-run.ts
//
// Standalone script to launch a run with a guest participant assigned to step 1.

import { eq } from "drizzle-orm";
import {
	applyEnablementProfile,
	db,
	field,
	getOrganizationBySlug,
	getUserByEmail,
	insertRunSnapshot,
	section,
	step,
	stepDependency,
	workflow,
	workflowRole,
	workflowVersion,
} from "@virn/database";
import { logger } from "@virn/logs";

const DEMO_WORKFLOW_TITLE = "[Demo] Onboarding";

async function main() {
	logger.info("Launching guest verification run...");

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

	// Find the existing workflow
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

	logger.info("Launching a fresh guest run...");
	const bundle = await buildLaunchBundle(publishedVersionId);
	
	const { runId } = await insertRunSnapshot({
		organizationId: org.id,
		workflowId: bundle.workflowId,
		workflowVersionId: publishedVersionId,
		title: `[Guest Verify] Onboarding — ${new Date().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`,
		createdBy: user.id,
		startedAt: new Date(),
		runDueAt: null,
		steps: bundle.steps,
		kickoffValues: [{ fieldId: bundle.customerNameFieldId, value: "Acme Corp" }],
		participants: [
			{ tempKey: "p_user", kind: "user", userId: user.id, guestEmail: null, guestName: null, agentId: null },
			{ tempKey: "p_guest", kind: "guest", userId: null, guestEmail: "guest@example.com", guestName: "Gus Guest", agentId: null }
		],
		roleAssignments: [
			{ roleId: operatorRoleId, participantTempKey: "p_user" }
		],
		stepAssignments: bundle.steps.map((s, idx) => ({
			stepId: s.stepId,
			participantTempKey: idx === 0 ? "p_guest" : "p_user", // Step 0 assigned to Guest, others to Admin user
		})),
	});

	logger.success(`Created run (runId=${runId})`);

	// Let's find the guest participant id we just created in the DB!
	const guestParticipant = await db.query.participant.findFirst({
		where: (p, { and: a, eq: e, isNull: n }) =>
			a(e(p.runId, runId), n(p.userId), e(p.guestEmail, "guest@example.com")),
	});

	if (!guestParticipant) {
		logger.error("Guest participant not created in database!");
		process.exit(1);
	}

	logger.success(`Guest Participant ID: ${guestParticipant.id}`);
	logger.info(`Run URL: http://localhost:3000/${org.slug}/runs/${runId}`);
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
					? offsetDays(start, s.dueOffsetDays)
					: null,
		}));

	const wf = await db.query.workflow.findFirst({
		where: (w, { eq: e }) => e(w.id, version.workflowId),
		columns: { id: true },
	});
	if (!wf) throw new Error(`Workflow ${version.workflowId} vanished`);

	return { workflowId: wf.id, steps, customerNameFieldId: customerNameField.id };
}

function offsetDays(base: Date, days: number): Date {
	const d = new Date(base);
	d.setDate(d.getDate() + days);
	return d;
}

main().catch((err) => {
	logger.error(err);
	process.exit(1);
});
