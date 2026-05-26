// tooling/scripts/src/walk-builder-publish-launch.ts
//
// Real-Postgres end-to-end walk of the Builder -> Publish -> Launch loop. The Pass 1
// acceptance test proves the contract against an in-memory store; this script proves
// it against Neon -- FK constraints, jsonb round-trip of field config, real transaction
// semantics, the same publishVersion + insertRunSnapshot paths the operator surface
// hits. When this passes green, the demo seed (seed-demo-workflow.ts) can retire and
// the operator screens can point at real built workflows.
//
// Implementation: hits the oRPC HTTP endpoints from a signed-in admin session, then
// reads the result directly from the DB to assert the snapshot's field-key identity
// survives the boundary. Same pattern as verify-guest-access.ts -- no cross-package
// import gymnastics, exercises the actual HTTP path operators hit.
//
// Prereqs:
//   - pnpm dev (saas on :3000)
//   - An admin / owner of the target org with a Better Auth session cookie. Either
//     log in via the browser then paste the session cookie when prompted, OR pass
//     ADMIN_SESSION_COOKIE in the env.
//
// Run: pnpm --filter @virn/scripts walk:builder
//
// Idempotent: every run creates a fresh, uniquely-titled workflow. Rows are left in
// the org for inspection (no auto-cleanup).

import { db, getOrganizationBySlug, getUserByEmail } from "@virn/database";
import { logger } from "@virn/logs";

const BASE_URL = process.env.SAAS_URL ?? "http://localhost:3000";
const RPC_PREFIX = `${BASE_URL}/api/rpc`;
const SUITE_TITLE = `[Builder Walk] Onboarding ${new Date().toISOString()}`;

interface OrpcCallOptions {
	cookieHeader: string;
	activeOrgId: string;
}

async function rpcCall<T>(
	procPath: string,
	body: Record<string, unknown>,
	opts: OrpcCallOptions,
): Promise<T> {
	const res = await fetch(`${RPC_PREFIX}/${procPath}`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Cookie: opts.cookieHeader,
			// Better Auth threads active-org via the session row; we pass the org via the
			// cookie. The server-side procedure middleware (protectedOrgProcedure /
			// adminOrgProcedure) reads it from session.activeOrganizationId.
		},
		body: JSON.stringify(body),
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`POST ${procPath} -> HTTP ${res.status}: ${text}`);
	}
	return (await res.json()) as T;
}

async function main() {
	logger.info("Builder -> Publish -> Launch real-Postgres walk.\n");

	if (!process.env.DATABASE_URL) {
		logger.error("DATABASE_URL not set -- can't read the snapshot back.");
		process.exit(1);
	}

	const orgSlug = (
		await logger.prompt("Organization slug to walk against:", {
			required: true,
			type: "text",
			placeholder: "virn",
		})
	).trim();
	const org = await getOrganizationBySlug(orgSlug);
	if (!org) {
		logger.error(`No org with slug "${orgSlug}".`);
		process.exit(1);
	}

	const adminEmail = (
		await logger.prompt("Admin email (must be admin/owner of this org):", {
			required: true,
			type: "text",
		})
	).trim();
	const adminUser = await getUserByEmail(adminEmail);
	if (!adminUser) {
		logger.error(`No user with email "${adminEmail}".`);
		process.exit(1);
	}

	const sessionCookie =
		process.env.ADMIN_SESSION_COOKIE ??
		(await logger.prompt(
			"Better Auth session cookie (sign in in the browser, copy from devtools):",
			{ required: true, type: "text" },
		)).trim();

	const opts: OrpcCallOptions = {
		cookieHeader: sessionCookie,
		activeOrgId: org.id,
	};

	logger.info(`\nWalking as ${adminUser.email} in org ${org.slug} (${org.id}).\n`);

	// 1. Create workflow + initial draft.
	logger.info(`Creating workflow "${SUITE_TITLE}"...`);
	const createRes = await rpcCall<{ workflowId: string; draftVersionId: string }>(
		"workflows/create",
		{
			title: SUITE_TITLE,
			description: "End-to-end Builder walk. Verifies publish output is launchable.",
			type: "procedure",
		},
		opts,
	);
	const { workflowId, draftVersionId } = createRes;
	logger.success(`  workflowId=${workflowId}  draftVersionId=${draftVersionId}`);

	// 2. Add structure.
	logger.info("Adding section + steps + fields + dependency...");
	const section = await rpcCall<{ id: string }>(
		"workflows/createSection",
		{ workflowVersionId: draftVersionId, title: "Setup" },
		opts,
	);
	const step1 = await rpcCall<{ id: string }>(
		"workflows/createStep",
		{
			workflowVersionId: draftVersionId,
			sectionId: section.id,
			title: "Collect signed agreement",
			isStopTask: true,
		},
		opts,
	);
	const step2 = await rpcCall<{ id: string }>(
		"workflows/createStep",
		{
			workflowVersionId: draftVersionId,
			sectionId: section.id,
			title: "Provision accounts",
		},
		opts,
	);
	const kickoffField = await rpcCall<{ id: string; key: string }>(
		"workflows/createField",
		{
			workflowVersionId: draftVersionId,
			stepId: null,
			label: "Customer name",
			fieldType: "text",
			isRequired: true,
		},
		opts,
	);
	const refField = await rpcCall<{ id: string; key: string }>(
		"workflows/createField",
		{
			workflowVersionId: draftVersionId,
			stepId: step1.id,
			label: "Reference number",
			fieldType: "text",
			isRequired: true,
		},
		opts,
	);
	const systemsField = await rpcCall<{ id: string; key: string }>(
		"workflows/createField",
		{
			workflowVersionId: draftVersionId,
			stepId: step2.id,
			label: "Systems provisioned",
			fieldType: "multiselect",
			isRequired: true,
			config: { options: ["Email", "Slack", "GitHub"] },
		},
		opts,
	);
	await rpcCall(
		"workflows/addStepDependency",
		{ stepId: step2.id, dependsOnStepId: step1.id },
		opts,
	);
	logger.success(
		`  fields: kickoff='${kickoffField.key}' step1='${refField.key}' step2='${systemsField.key}'`,
	);

	// 3. Publish.
	logger.info("Publishing draft via oRPC...");
	const publishRes = await rpcCall<{ versionId: string; versionNumber: number }>(
		"workflows/publishVersion",
		{ versionId: draftVersionId },
		opts,
	);
	logger.success(`  Published v${publishRes.versionNumber}`);

	// 4. Negative path: launchRun WITHOUT kickoff value -> should refuse.
	logger.info("Negative path: launchRun without kickoff value -> should refuse...");
	let refused = false;
	try {
		await rpcCall(
			"runs/launch",
			{ workflowId, kickoffValues: {}, roleAssignments: [] },
			opts,
		);
	} catch (err) {
		refused = true;
		const msg = err instanceof Error ? err.message : String(err);
		if (!msg.includes("REQUIRED_KICKOFF_FIELD_MISSING")) {
			logger.error(`Expected REQUIRED_KICKOFF_FIELD_MISSING; got: ${msg}`);
			process.exit(1);
		}
		logger.success("  Correctly refused (REQUIRED_KICKOFF_FIELD_MISSING).");
	}
	if (!refused) {
		logger.error("Expected launchRun to refuse without a kickoff value.");
		process.exit(1);
	}

	// 5. Happy path: launchRun with the kickoff value.
	logger.info("Happy path: launchRun with kickoff value...");
	const launched = await rpcCall<{ runId: string }>(
		"runs/launch",
		{
			workflowId,
			kickoffValues: { [kickoffField.key]: "Acme Corp" },
			roleAssignments: [],
		},
		opts,
	);
	logger.success(`  runId=${launched.runId}`);

	// 6. THE LOAD-BEARING ASSERTION. Read the run's field_value rows directly from
	// the DB and verify the kickoff value lands on a field whose key is the original.
	// This is the real-Postgres analogue of the in-memory acceptance test's assertion.
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
		logger.error("No kickoff field_value row (runStepId IS NULL) -- not present or fieldId null.");
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

	// 7. Sanity: read the runStep rows back and verify both steps materialized.
	const runStepRows = await db.query.runStep.findMany({
		where: (rs, { eq: e }) => e(rs.runId, launched.runId),
		orderBy: (rs, { asc }) => [asc(rs.position)],
	});
	if (runStepRows.length !== 2) {
		logger.error(`Expected 2 runStep rows; got ${runStepRows.length}`);
		process.exit(1);
	}
	const stepTitles = runStepRows.map((r) => r.title);
	if (
		!stepTitles.includes("Collect signed agreement") ||
		!stepTitles.includes("Provision accounts")
	) {
		logger.error(`Step title drift: ${JSON.stringify(stepTitles)}`);
		process.exit(1);
	}
	logger.success(`  runSteps=${runStepRows.length} titles=${JSON.stringify(stepTitles)} ✓`);

	logger.success("\n=== Walk passed ===");
	logger.info(`Workflow:        ${workflowId}`);
	logger.info(`Published v1:    ${draftVersionId}`);
	logger.info(`Run:             ${launched.runId}`);
	logger.info(`Run URL:         ${BASE_URL}/${org.slug}/runs/${launched.runId}`);
	logger.info("");
	logger.info("Publish output is launch-compatible against real Postgres. The Builder API,");
	logger.info("the publish path, and the run engine snapshot are wired together end-to-end.");
	logger.info("The demo seed (seed-demo-workflow.ts) can be retired -- the Builder produces");
	logger.info("the same shape it does.");
}

main().catch((err) => {
	logger.error(err);
	process.exit(1);
});
