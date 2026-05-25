// tooling/scripts/src/seed-settings.ts
//
// Idempotent setting_definition seed. Defines the canonical settings for Virn Ops; the
// upsert helper in @virn/database handles the SQL and resolves `capabilityKey` -> FK.
//
// Requires `seed:capabilities` to have run first (gating capability keys must resolve).
//
// Run: pnpm --filter @virn/scripts seed:settings

import { type SettingDefinitionSeed, upsertSettingDefinitions } from "@virn/database";
import { logger } from "@virn/logs";

const SETTINGS: SettingDefinitionSeed[] = [
	// runs
	{
		key: "runs.auto_close_after_days",
		name: "Auto-close completed runs after (days)",
		description: "Automatically archive completed runs after N days. 0 = never auto-close.",
		dataType: "number",
		defaultValue: 0,
		validationSchema: { min: 0, int: true },
		category: "runs",
		capabilityKey: null,
		sortOrder: 10,
	},
	{
		key: "runs.show_completed_in_dashboard",
		name: "Show completed runs in dashboard",
		description: "Whether the main dashboard surfaces completed runs alongside active ones.",
		dataType: "boolean",
		defaultValue: true,
		validationSchema: null,
		category: "runs",
		capabilityKey: null,
		sortOrder: 20,
	},
	{
		key: "runs.default_assignee_strategy",
		name: "Default assignee strategy",
		description: "How to pick an assignee when a step's role matches multiple users.",
		dataType: "select",
		defaultValue: "role_only",
		validationSchema: { options: ["round_robin", "load_balance", "role_only"] },
		category: "runs",
		capabilityKey: null,
		sortOrder: 30,
	},

	// workflows
	{
		key: "workflows.default_visibility",
		name: "Default workflow visibility",
		description: "Initial visibility for newly created workflow definitions.",
		dataType: "select",
		defaultValue: "organization",
		validationSchema: { options: ["private", "organization"] },
		category: "workflows",
		capabilityKey: null,
		sortOrder: 40,
	},
	{
		key: "workflows.require_publish_changelog",
		name: "Require changelog on publish",
		description: "Force the author to write a changelog entry when publishing a workflow version.",
		dataType: "boolean",
		defaultValue: false,
		validationSchema: null,
		category: "workflows",
		capabilityKey: null,
		sortOrder: 50,
	},

	// governance (gated)
	{
		key: "governance.approval_required_for_publish",
		name: "Approval required before publish",
		description:
			"When enabled, workflow versions cannot be published until a designated approver decides.",
		dataType: "boolean",
		defaultValue: false,
		validationSchema: null,
		category: "governance",
		capabilityKey: "governance.approvals",
		sortOrder: 60,
	},
	{
		key: "governance.acknowledgment_required_before_run",
		name: "Acknowledgment required before run",
		description:
			"Users must acknowledge the active workflow version before they can start (or be assigned) a run.",
		dataType: "boolean",
		defaultValue: false,
		validationSchema: null,
		category: "governance",
		capabilityKey: "governance.acknowledgments",
		sortOrder: 70,
	},

	// notifications
	{
		key: "notifications.daily_digest_enabled",
		name: "Send daily digest email",
		description: "Send a daily summary email of run/step activity.",
		dataType: "boolean",
		defaultValue: true,
		validationSchema: null,
		category: "notifications",
		capabilityKey: null,
		sortOrder: 80,
	},
	{
		key: "notifications.digest_time_local",
		name: "Digest send time (HH:MM local)",
		description: "Local-time hour:minute to send the daily digest.",
		dataType: "string",
		defaultValue: "08:00",
		validationSchema: { pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" },
		category: "notifications",
		capabilityKey: null,
		sortOrder: 90,
	},

	// library
	{
		key: "library.allow_install_from_public",
		name: "Allow installs from public library",
		description: "Whether members can install workflows from the public template library.",
		dataType: "boolean",
		defaultValue: true,
		validationSchema: null,
		category: "library",
		capabilityKey: null,
		sortOrder: 100,
	},

	// branding
	{
		key: "branding.logo_url",
		name: "Organization logo URL",
		description: "URL of the org's logo used in app chrome and emails.",
		dataType: "string",
		defaultValue: null,
		validationSchema: { maxLength: 2048 },
		category: "branding",
		capabilityKey: null,
		sortOrder: 110,
	},
	{
		key: "branding.primary_color",
		name: "Primary brand color (hex)",
		description: "Primary brand accent color, six-digit hex including the leading #.",
		dataType: "string",
		defaultValue: null,
		validationSchema: { pattern: "^#[0-9a-fA-F]{6}$" },
		category: "branding",
		capabilityKey: null,
		sortOrder: 120,
	},
];

async function main() {
	logger.info(`Seeding ${SETTINGS.length} setting definitions...`);
	const { count } = await upsertSettingDefinitions(SETTINGS);
	logger.success(`Upserted ${count} setting definitions.`);
}

main().catch((err) => {
	logger.error(err);
	process.exit(1);
});
