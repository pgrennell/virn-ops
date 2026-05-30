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
	// Phase 15 -- thin compliance / evidence surface (S-10). When ON, the org
	// gains the /compliance area (audit + evidence reader). The flag also
	// gates the per-workflow Audit tab and -- once Phase 16 ships -- mandatory
	// sign-off, scheduled re-attestation, evidence retention enforcement.
	// Independent of the three enablement profiles (checklist/sop/automation);
	// org-level opt-in via /settings/general only.
	{
		key: "compliance.pack",
		name: "Compliance pack",
		description:
			"Org-level audit and evidence reader surface. When on, exposes /compliance + the per-workflow Audit tab; readies the org for mandatory sign-off, scheduled re-attestation, and evidence retention (Phase 16). Off by default.",
		defaultEnabled: false,
		sortOrder: 110,
	},
	// Phase 11a step 4 -- per-agent action-surface gates. These are NOT feature
	// flags in the org-settings sense (admins don't toggle them in the UI);
	// they're capability slugs that compose the agent_capability check.
	// `defaultEnabled: true` means the capability is "available at org level"
	// so the agent-level grant is the operative check. PM-as-agent (D-033)
	// receives these grants at agent-creation time; tenant-internal AI agents
	// are granted whichever subset matches their role.
	{
		key: "action.runs.launch",
		name: "Action: launch runs",
		description:
			"Allows an agent to call runs.launch via the action surface. Required for cross-product launches (PM-as-agent) and for tenant-internal ai_assisted / automated mode agents that kick off their own runs.",
		defaultEnabled: true,
		sortOrder: 200,
	},
	{
		key: "action.runs.set_field_value",
		name: "Action: write field values on assigned steps",
		description:
			"Allows an agent to call runs.setFieldValue on a runStep it participates on. Required for agents that fill data during a run (ai_assisted mode, automated mode).",
		defaultEnabled: true,
		sortOrder: 210,
	},
	{
		key: "action.runs.complete_step",
		name: "Action: complete assigned steps",
		description:
			"Allows an agent to call runs.completeStep on a runStep it participates on. Required for agents that drive a run to completion (automated mode) or hand control back (ai_assisted mode).",
		defaultEnabled: true,
		sortOrder: 220,
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
