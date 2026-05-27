// tooling/scripts/src/seed-demo-scratch.ts
//
// Non-interactive version of seed-demo-workflow.ts that hardcodes organization 'virn'
// and assignee 'pgrennell@gmail.com' to bypass EBADF TTY headless errors.

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
	logger.info("Demo workflow seed (Non-interactive) — creates a published workflow you can launch + verify.");

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

	// Find-or-create the workflow definition. Idempotent by title within the org.
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
		logger.info(`Demo workflow already exists (${existingWorkflow.id}). Reusing.`);
		publishedVersionId = existingWorkflow.versions[0].id;
		const role = await db.query.workflowRole.findFirst({
			where: (r, { and: a, eq: e }) =>
				a(e(r.organizationId, org.id), e(r.name, "Operator (Demo)")),
		});
		if (!role) {
			logger.error(
				"Demo workflow exists but the Operator (Demo) role is missing — DB is in an unexpected state. Aborting.",
			);
			process.exit(1);
		}
		operatorRoleId = role.id;
	} else {
		logger.info("Creating demo workflow definition...");
		const result = await createDemoWorkflow(org.id, user.id);
		publishedVersionId = result.versionId;
		operatorRoleId = result.operatorRoleId;
		logger.success(`Created demo workflow (workflowId=${result.workflowId}).`);
	}

	// Make sure the org has the capabilities the demo exercises. If the org hasn't run the
	// mode picker, applyEnablementProfile("checklist") gives a sensible baseline.
	logger.info("Ensuring at least the 'checklist' enablement profile is applied...");
	await applyEnablementProfile(org.id, "checklist");

	// Launch one run.
	logger.info("Launching a fresh demo run...");
	const bundle = await buildLaunchBundle(publishedVersionId);
	const { runId } = await insertRunSnapshot({
		organizationId: org.id,
		workflowId: bundle.workflowId,
		workflowVersionId: publishedVersionId,
		title: `[Demo] Onboarding — ${new Date().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`,
		createdBy: user.id,
		startedAt: new Date(),
		runDueAt: null,
		steps: bundle.steps,
		kickoffValues: [{ fieldId: bundle.customerNameFieldId, value: "Acme Corp" }],
		participants: [{ tempKey: "p_user", kind: "user", userId: user.id, guestEmail: null, guestName: null, agentId: null }],
		roleAssignments: [{ roleId: operatorRoleId, participantTempKey: "p_user" }],
		stepAssignments: bundle.steps.map((s) => ({
			stepId: s.stepId,
			participantTempKey: "p_user",
		})),
	});

	logger.success("\n=== Done ===");
	logger.info(`Run URL:  http://localhost:3000/${org.slug}/runs/${runId}`);
	logger.info(`My Work:  http://localhost:3000/${org.slug}/my-work`);
	logger.info("");
	logger.info(`Assignee: ${user.email}`);
	logger.info("Kickoff `customer_name` is pre-filled as 'Acme Corp'.");
	logger.info("");
}

// ---------------------------------------------------------------------------
// Definition writer
// ---------------------------------------------------------------------------

async function createDemoWorkflow(
	organizationId: string,
	createdByUserId: string,
): Promise<{ workflowId: string; versionId: string; operatorRoleId: string }> {
	return await db.transaction(async (tx) => {
		const [role] = await tx
			.insert(workflowRole)
			.values({
				organizationId,
				name: "Operator (Demo)",
				isInitiator: true,
			})
			.returning({ id: workflowRole.id });

		const [wf] = await tx
			.insert(workflow)
			.values({
				organizationId,
				title: DEMO_WORKFLOW_TITLE,
				description:
					"Sample workflow seeded for the operator-screen walkthrough. Exercises stop-task gating, required-field refusal, and optional-step cascade.",
				type: "procedure",
				createdBy: createdByUserId,
			})
			.returning({ id: workflow.id });

		const [version] = await tx
			.insert(workflowVersion)
			.values({
				workflowId: wf.id,
				versionNumber: 1,
				status: "published",
				publishedAt: new Date(),
				publishedBy: createdByUserId,
			})
			.returning({ id: workflowVersion.id });

		const [setupSection, followupSection] = await tx
			.insert(section)
			.values([
				{ workflowVersionId: version.id, title: "Setup", position: 0 },
				{ workflowVersionId: version.id, title: "Follow-up", position: 1 },
			])
			.returning({ id: section.id });

		const [step1, step2, step3] = await tx
			.insert(step)
			.values([
				{
					workflowVersionId: version.id,
					sectionId: setupSection.id,
					assignedRoleId: role.id,
					type: "task",
					title: "Collect signed agreement",
					description:
						"Get the signed agreement on file. The reference number is required before this step can complete.",
					position: 0,
					isRequired: true,
					isStopTask: true,
					dueType: "offset_from_start",
					dueOffsetDays: 1,
				},
				{
					workflowVersionId: version.id,
					sectionId: setupSection.id,
					assignedRoleId: role.id,
					type: "task",
					title: "Provision accounts",
					description: "Create accounts in the systems the new hire needs.",
					position: 1,
					isRequired: true,
					isStopTask: false,
					dueType: "offset_from_start",
					dueOffsetDays: 2,
				},
				{
					workflowVersionId: version.id,
					sectionId: followupSection.id,
					assignedRoleId: role.id,
					type: "task",
					title: "Send welcome packet",
					description: "Nice-to-have. Skipping this won't block the run from completing.",
					position: 2,
					isRequired: false,
					isStopTask: false,
					dueType: "offset_from_start",
					dueOffsetDays: 3,
				},
			])
			.returning({ id: step.id });

		await tx.insert(stepDependency).values({
			stepId: step2.id,
			dependsOnStepId: step1.id,
		});

		await tx.insert(field).values([
			// Kickoff — required.
			{
				workflowVersionId: version.id,
				stepId: null,
				key: "customer_name",
				label: "Customer name",
				fieldType: "text",
				isRequired: true,
				position: 0,
			},
			// Step 1 — required text.
			{
				workflowVersionId: version.id,
				stepId: step1.id,
				key: "reference_number",
				label: "Reference number",
				fieldType: "text",
				isRequired: true,
				position: 0,
			},
			// Step 2 — required multiselect.
			{
				workflowVersionId: version.id,
				stepId: step2.id,
				key: "systems_provisioned",
				label: "Systems provisioned",
				fieldType: "multiselect",
				isRequired: true,
				config: { options: ["Email", "Slack", "GitHub", "Notion"] },
				position: 0,
			},
			// Step 3 — optional notes.
			{
				workflowVersionId: version.id,
				stepId: step3.id,
				key: "notes",
				label: "Notes",
				fieldType: "textarea",
				isRequired: false,
				position: 0,
			},
		]);

		return { workflowId: wf.id, versionId: version.id, operatorRoleId: role.id };
	});
}

// ---------------------------------------------------------------------------
// Launch bundle
// ---------------------------------------------------------------------------

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

void eq;

main().catch((err) => {
	logger.error(err);
	process.exit(1);
});
