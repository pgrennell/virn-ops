// tooling/scripts/src/seed-demo-workflow.ts
//
// One-shot seed for a sample published workflow so the operator screens (Run view, My Work,
// Home) have something real to point at. The fixture is shaped to exercise every runtime
// branch you'd want to verify in a 5-minute browser walkthrough:
//
//   Step 1  Collect signed agreement      required + STOP-TASK + required field
//   Step 2  Provision accounts            required + depends_on Step 1 + multiselect field
//   Step 3  Send welcome packet           OPTIONAL (isRequired = false) + textarea
//
// Plus one required kickoff field (`customer_name`).
//
// Behaviors covered by launching one run:
//   - stop-task gating  → Step 2 shows Lock in My Work and Run view's step list
//   - required field refusal → quick-complete on Step 1 without `reference_number` bounces
//   - optional step    → Step 3 carries the "Optional" pill; run can auto-complete with
//                        only required steps done (D-015 cascade)
//   - sections        → "Setup" (steps 1+2) vs "Follow-up" (step 3) groups in the list
//
// Idempotent: a workflow with title "[Demo] Onboarding" inside the target org is reused
// if it already exists. Run side effects are NOT idempotent -- the script launches one
// fresh run every time (so re-running gives a clean canvas to play with).
//
// Run: pnpm --filter @virn/scripts seed:demo-workflow
//
// Prompts for: org slug, admin email (must be a member of the org).
// Outputs: the run URL to visit.

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
	logger.info("Demo workflow seed — creates a published workflow you can launch + verify.");

	const orgSlug = (
		await logger.prompt("Organization slug to seed into:", {
			required: true,
			type: "text",
			placeholder: "acme",
		})
	).trim();
	const org = await getOrganizationBySlug(orgSlug);
	if (!org) {
		logger.error(`No org with slug "${orgSlug}".`);
		process.exit(1);
	}

	const adminEmail = (
		await logger.prompt("Email of the user to assign Step 1+2+3 to (must be an org member):", {
			required: true,
			type: "text",
			placeholder: "you@example.com",
		})
	).trim();
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
		participants: [{ tempKey: "p_user", userId: user.id, guestEmail: null, guestName: null }],
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
	logger.info("Try these in the Run view:");
	logger.info("  1. Step 2 should show as Lock-blocked until Step 1 completes");
	logger.info("  2. Try Complete on Step 1 WITHOUT filling 'Reference number' → bounces");
	logger.info("  3. Fill the reference number, complete Step 1, watch Step 2 unlock");
	logger.info("  4. Complete Step 2 → run auto-completes (Step 3 is optional)");
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
// Launch bundle (re-read the canonical step/field rows from the version we just created
// or found — keeps the seed insulated from drift if someone edits the definition).
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

	// Single-version lookup to fetch the workflowId (we don't have it from the prompt).
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

// Silence "unused" for `eq` -- imported only because of the where helpers above using closure.
void eq;

main().catch((err) => {
	logger.error(err);
	process.exit(1);
});
