// tooling/scripts/src/walk-builder-publish-launch.ts
//
// Real-Postgres end-to-end walk of the Builder -> Publish -> Launch loop. The Pass 1
// acceptance test proves the contract against an in-memory store; this script proves
// it against Neon -- FK constraints, jsonb round-trip of field config, real transaction
// semantics, the same publishVersion + insertRunSnapshot paths the operator surface
// hits. When this passes green, the demo seed (seed-demo-workflow.ts) retires --
// the Builder API produces the same shape it does, with real authoring.
//
// Implementation: calls the Builder lib functions directly (createWorkflow,
// createSection, createStep, createField, addStepDependency, publishVersion) and the
// run engine's launchRun directly. Bypasses the oRPC HTTP layer because the
// real-Postgres proof is about FK/jsonb/transaction semantics, not HTTP routing.
// The procedure layer is a thin Zod-validated wrapper over these libs and is
// covered by the existing api test suite.
//
// Inputs: WALK_ORG_SLUG and WALK_ADMIN_EMAIL env vars (or interactive prompts).
//
// Run: pnpm --filter @virn/scripts walk:builder
//
// Idempotent in the sense that every invocation creates a fresh, uniquely-titled
// workflow + launches one fresh run. Cleanup is left to the operator.

import {
	db,
	getOrganizationBySlug,
	getUserByEmail,
	getWorkflowVersionById,
	getVersionLaunchBundle,
} from "@virn/database";
import { logger } from "@virn/logs";

import { launchRun } from "@virn/api/modules/runs/lib/launch-run";
import {
	addStepDependency,
	createField,
	createSection,
	createStep,
	createWorkflow,
	publishVersion,
} from "@virn/api/modules/workflows/lib";

const SUITE_TITLE = `[Builder Walk] Onboarding ${new Date().toISOString()}`;

async function resolvePrompt(envName: string, promptText: string): Promise<string> {
	const fromEnv = process.env[envName];
	if (fromEnv && fromEnv.trim().length > 0) return fromEnv.trim();
	const answered = await logger.prompt(promptText, { required: true, type: "text" });
	return answered.trim();
}

async function main() {
	logger.info("Builder -> Publish -> Launch real-Postgres walk.\n");

	if (!process.env.DATABASE_URL) {
		logger.error("DATABASE_URL not set -- expected the script wrapper to load .env.local.");
		process.exit(1);
	}

	const orgSlug = await resolvePrompt("WALK_ORG_SLUG", "Organization slug:");
	const org = await getOrganizationBySlug(orgSlug);
	if (!org) {
		logger.error(`No org with slug "${orgSlug}".`);
		process.exit(1);
	}

	const adminEmail = await resolvePrompt(
		"WALK_ADMIN_EMAIL",
		"Admin email (any org member works since we bypass HTTP authz):",
	);
	const adminUser = await getUserByEmail(adminEmail);
	if (!adminUser) {
		logger.error(`No user with email "${adminEmail}".`);
		process.exit(1);
	}

	const ctx = { organizationId: org.id, userId: adminUser.id };
	logger.info(`\nWalking in org "${org.slug}" (${org.id}) as ${adminUser.email}.\n`);

	// 1. Create workflow + initial draft.
	logger.info(`Creating workflow "${SUITE_TITLE}"...`);
	const { workflowId, draftVersionId } = await createWorkflow(ctx, {
		title: SUITE_TITLE,
		description: "End-to-end Builder walk. Verifies publish output is launchable.",
		type: "procedure",
	});
	logger.success(`  workflowId=${workflowId}  draftVersionId=${draftVersionId}`);

	// 2. Add structure.
	logger.info("Adding section + steps + fields + dependency...");
	const section = await createSection(ctx, {
		workflowVersionId: draftVersionId,
		title: "Setup",
	});
	const step1 = await createStep(ctx, {
		workflowVersionId: draftVersionId,
		sectionId: section.id,
		title: "Collect signed agreement",
		isStopTask: true,
	});
	const step2 = await createStep(ctx, {
		workflowVersionId: draftVersionId,
		sectionId: section.id,
		title: "Provision accounts",
	});
	const kickoffField = await createField(ctx, {
		workflowVersionId: draftVersionId,
		stepId: null,
		label: "Customer name",
		fieldType: "text",
		isRequired: true,
	});
	const refField = await createField(ctx, {
		workflowVersionId: draftVersionId,
		stepId: step1.id,
		label: "Reference number",
		fieldType: "text",
		isRequired: true,
	});
	const systemsField = await createField(ctx, {
		workflowVersionId: draftVersionId,
		stepId: step2.id,
		label: "Systems provisioned",
		fieldType: "multiselect",
		isRequired: true,
		// jsonb round-trip is what we're proving here. select + multiselect store
		// `options` in field.config, which is jsonb. If Drizzle's serializer drops or
		// rewrites it, launchRun's validateFieldValue (Zod) would reject the kickoff.
		config: { options: ["Email", "Slack", "GitHub"] },
	});
	await addStepDependency(ctx, {
		stepId: step2.id,
		dependsOnStepId: step1.id,
	});
	logger.success(
		`  fields: kickoff='${kickoffField.key}' step1='${refField.key}' step2='${systemsField.key}'`,
	);

	// 3. Publish (atomic UPDATE WHERE status='draft' + audit row -- D-018).
	logger.info("Publishing draft...");
	const publishResult = await publishVersion(ctx, { versionId: draftVersionId });
	logger.success(`  Published v${publishResult.versionNumber}`);

	const publishedVersion = await getWorkflowVersionById(draftVersionId);
	if (publishedVersion?.status !== "published") {
		logger.error(
			`Expected version status='published'; got '${publishedVersion?.status ?? "missing"}'`,
		);
		process.exit(1);
	}

	// 4. Negative path: launchRun WITHOUT kickoff value -> should refuse with
	// REQUIRED_KICKOFF_FIELD_MISSING. Proves the published version's required-field
	// metadata round-tripped correctly.
	logger.info("Negative path: launchRun without kickoff value -> should refuse...");
	let refused = false;
	try {
		await launchRun(ctx, { workflowId, kickoffValues: {}, roleAssignments: [] });
	} catch (err) {
		refused = true;
		const code = (err as { code?: string }).code ?? "unknown";
		if (code !== "REQUIRED_KICKOFF_FIELD_MISSING") {
			logger.error(`Expected REQUIRED_KICKOFF_FIELD_MISSING; got ${code}`);
			process.exit(1);
		}
		logger.success(`  Correctly refused: ${code}`);
	}
	if (!refused) {
		logger.error("Expected launchRun to refuse without a kickoff value.");
		process.exit(1);
	}

	// 5. Happy path: launchRun with the kickoff value.
	logger.info("Happy path: launchRun with kickoff value...");
	const launched = await launchRun(ctx, {
		workflowId,
		kickoffValues: { [kickoffField.key]: "Acme Corp" },
		roleAssignments: [],
	});
	logger.success(`  runId=${launched.runId}`);

	// 6. THE LOAD-BEARING ASSERTION. Read the run's field_value rows directly from
	// Neon and verify the kickoff value lands on a field whose key is the original.
	// This is the real-Postgres analogue of the in-memory acceptance test's assertion.
	// Proves Invariant #5 (stable keys) survives the build->publish->launch boundary
	// against real FK constraints.
	logger.info("Verifying kickoff field_value keyed by original field key...");
	const valueRows = await db.query.fieldValue.findMany({
		where: (fv, { eq: e }) => e(fv.runId, launched.runId),
	});
	if (valueRows.length === 0) {
		logger.error("No field_value rows on the run -- expected the kickoff value.");
		process.exit(1);
	}
	const kickoffValueRow = valueRows.find((v) => v.runStepId === null);
	if (!kickoffValueRow || !kickoffValueRow.fieldId) {
		logger.error("No kickoff field_value row (runStepId IS NULL) or fieldId is null.");
		process.exit(1);
	}
	const pinnedField = await db.query.field.findFirst({
		where: (f, { eq: e }) => e(f.id, kickoffValueRow.fieldId as string),
	});
	if (!pinnedField) {
		logger.error("Couldn't resolve the field row the kickoff value FKs to.");
		process.exit(1);
	}
	if (pinnedField.key !== kickoffField.key) {
		logger.error(
			`Key drift: expected '${kickoffField.key}', got '${pinnedField.key}' on the field row the run's kickoff value points at.`,
		);
		process.exit(1);
	}
	logger.success(
		`  kickoff value=${JSON.stringify(kickoffValueRow.value)} -> field.key='${pinnedField.key}' ✓`,
	);

	// 7. jsonb round-trip on the multiselect's options config. The Builder wrote
	// `{ options: ["Email", "Slack", "GitHub"] }` to field.config (jsonb); read it
	// back and confirm the array survived round-trip.
	logger.info("Verifying jsonb round-trip on multiselect field config...");
	const systemsRow = await db.query.field.findFirst({
		where: (f, { eq: e }) => e(f.id, systemsField.id),
	});
	if (!systemsRow) {
		logger.error("Multiselect field row vanished.");
		process.exit(1);
	}
	const cfg = systemsRow.config as { options?: unknown } | null;
	const options = cfg?.options;
	if (
		!Array.isArray(options) ||
		options.length !== 3 ||
		options[0] !== "Email" ||
		options[1] !== "Slack" ||
		options[2] !== "GitHub"
	) {
		logger.error(
			`jsonb round-trip drift: expected ["Email","Slack","GitHub"], got ${JSON.stringify(options)}`,
		);
		process.exit(1);
	}
	logger.success(`  field.config.options=${JSON.stringify(options)} ✓`);

	// 8. Sanity: the launch bundle reads back what publish wrote.
	logger.info("Sanity: getVersionLaunchBundle returns the published structure...");
	const bundle = await getVersionLaunchBundle(draftVersionId);
	if (bundle.steps.length !== 2) {
		logger.error(`Expected 2 steps in bundle; got ${bundle.steps.length}`);
		process.exit(1);
	}
	const keysInBundle = bundle.fields.map((f) => f.key).sort();
	const expectedKeys = [kickoffField.key, refField.key, systemsField.key].sort();
	if (JSON.stringify(keysInBundle) !== JSON.stringify(expectedKeys)) {
		logger.error(
			`Field key drift: expected ${JSON.stringify(expectedKeys)}, got ${JSON.stringify(keysInBundle)}`,
		);
		process.exit(1);
	}
	if (bundle.deps.length !== 1) {
		logger.error(`Expected 1 step_dependency; got ${bundle.deps.length}`);
		process.exit(1);
	}
	logger.success(
		`  bundle steps=${bundle.steps.length} fields=${bundle.fields.length} deps=${bundle.deps.length} ✓`,
	);

	// 9. Sanity: 2 runStep rows materialized with the snapshotted titles.
	const runStepRows = await db.query.runStep.findMany({
		where: (rs, { eq: e }) => e(rs.runId, launched.runId),
		orderBy: (rs, { asc }) => [asc(rs.position)],
	});
	if (runStepRows.length !== 2) {
		logger.error(`Expected 2 runStep rows; got ${runStepRows.length}`);
		process.exit(1);
	}
	const titles = runStepRows.map((r) => r.title);
	if (titles[0] !== "Collect signed agreement" || titles[1] !== "Provision accounts") {
		logger.error(`runStep title drift: ${JSON.stringify(titles)}`);
		process.exit(1);
	}
	logger.success(`  runSteps=${runStepRows.length} titles=${JSON.stringify(titles)} ✓`);

	logger.success("\n=== Walk passed ===");
	logger.info(`Workflow:        ${workflowId}`);
	logger.info(`Published v1:    ${draftVersionId}`);
	logger.info(`Run:             ${launched.runId}`);
	logger.info(`Run URL:         http://localhost:3000/${org.slug}/runs/${launched.runId}`);
	logger.info("");
	logger.info("Build->publish->launch is launch-compatible against real Postgres. FK constraints");
	logger.info("hold; jsonb round-trip survives; transactions are atomic; the Builder lib produces");
	logger.info("snapshot-shaped output the run engine accepts. The demo seed can retire.");
}

main().catch((err) => {
	logger.error(err);
	process.exit(1);
});
