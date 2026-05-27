// tooling/scripts/src/seed-capabilities.ts
//
// Idempotent capability seed. Defines the canonical capability set for Virn Ops; the
// upsert helper in @virn/database handles the SQL. Verifies that every key referenced by
// PROFILES exists after seeding.
//
// Run: pnpm --filter @virn/scripts seed:capabilities

import {
	type CapabilitySeed,
	findMissingProfileCapabilityKeys,
	upsertCapabilities,
} from "@virn/database";
import { logger } from "@virn/logs";

const CAPABILITIES: CapabilitySeed[] = [
	{
		key: "workflows.recurring_runs",
		name: "Recurring runs",
		description: "Schedule workflows to start on a recurring cadence (daily, weekly, monthly).",
		defaultEnabled: true,
		sortOrder: 10,
	},
	{
		key: "workflows.kickoff_forms",
		name: "Kickoff forms",
		description: "Collect structured data at run start via launch-level fields.",
		defaultEnabled: true,
		sortOrder: 20,
	},
	{
		key: "workflows.guest_participants",
		name: "Guest participants",
		description:
			"Allow guest emails (non-account users) to be assigned as run participants for external sign-off.",
		defaultEnabled: false,
		sortOrder: 30,
	},
	{
		key: "workflows.agent_steps",
		name: "AI agent steps",
		description:
			"Lift step.type=ai from reserved to live -- authors can mark steps as agent actions (one of the three S-07 modes: human / AI-assisted / automated). Per the 2026-05-26 pivot, AI is v1; default ON across all profiles.",
		defaultEnabled: true,
		sortOrder: 35,
	},
	{
		key: "automation.rules",
		name: "Automation rules",
		description:
			"Event-driven rules that trigger actions (show/hide steps, assign, notify, call webhooks) during a run.",
		defaultEnabled: false,
		sortOrder: 40,
	},
	{
		key: "governance.approvals",
		name: "Approvals",
		description: "Require approval before a workflow version can be published.",
		defaultEnabled: false,
		sortOrder: 50,
	},
	{
		key: "governance.acknowledgments",
		name: "Acknowledgments",
		description: "Require users to acknowledge a published workflow version before starting a run.",
		defaultEnabled: false,
		sortOrder: 60,
	},
	{
		key: "governance.suggestions",
		name: "Suggestions",
		description: "In-app intake for improvement suggestions on workflows.",
		defaultEnabled: false,
		sortOrder: 70,
	},
	{
		key: "library.public_listings",
		name: "Public template listings",
		description: "Publish workflows as public template listings (vs. private or org-only).",
		defaultEnabled: false,
		sortOrder: 80,
	},
	{
		key: "fields.custom_definitions",
		name: "Custom field definitions",
		description: "Org-scoped custom field_definition registry for extending core records.",
		defaultEnabled: false,
		sortOrder: 90,
	},
	{
		key: "integrations.webhooks",
		name: "Outbound webhooks",
		description: "Call external HTTP endpoints as automation actions.",
		defaultEnabled: false,
		sortOrder: 100,
	},
];

async function main() {
	logger.info(`Seeding ${CAPABILITIES.length} capabilities...`);

	const { count } = await upsertCapabilities(CAPABILITIES);
	logger.success(`Upserted ${count} capabilities.`);

	const missing = await findMissingProfileCapabilityKeys();
	if (missing.length > 0) {
		logger.error(
			`Profile validation failed: ${missing.length} key(s) referenced by PROFILES but not seeded: ${missing.join(", ")}`,
		);
		process.exit(1);
	}
	logger.success("All profile-managed keys present.");
}

main().catch((err) => {
	logger.error(err);
	process.exit(1);
});
