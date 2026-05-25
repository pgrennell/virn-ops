// tooling/scripts/src/test-config-resolution.ts
//
// Smoke test for the org-config resolution layer (queries/config.ts).
// Exercises:
//   1. L1 defaults flow through getEffectiveCapabilities / getEffectiveSettings
//   2. setOrganizationCapabilityOverride / clearOrganizationCapabilityOverride
//   3. setOrganizationSettingOverride / clearOrganizationSettingOverride
//   4. Setting gating: a setting whose capability is disabled is filtered out;
//      defense-in-depth refuses writes to such settings.
//   5. validateSettingValue happy + sad paths per dataType.
//   6. applyEnablementProfile: checklist / sop / automation mutual exclusion +
//      preservation of the resolver's "row present = override" semantics.
//   7. Unknown-key error cases.
//
// Creates an ephemeral org for isolation (slug `__config_smoke_<timestamp>`) and
// cleans up at the end via cascade delete. Requires `seed:config` first.
//
// Run: pnpm --filter @virn/scripts test:config

import { eq } from "drizzle-orm";
import {
	PROFILES,
	applyEnablementProfile,
	clearOrganizationCapabilityOverride,
	clearOrganizationSettingOverride,
	db,
	getEffectiveCapabilities,
	getEffectiveSettingValue,
	getEffectiveSettings,
	isCapabilityEnabledForOrg,
	organization,
	setOrganizationCapabilityOverride,
	setOrganizationSettingOverride,
	validateSettingValue,
} from "@virn/database";
import { logger } from "@virn/logs";

let passed = 0;
let failures = 0;

function check(condition: boolean, message: string): void {
	if (condition) {
		passed++;
		logger.info(`  PASS  ${message}`);
	} else {
		failures++;
		logger.error(`  FAIL  ${message}`);
	}
}

async function throwsAsync(fn: () => Promise<unknown>, pattern?: RegExp): Promise<boolean> {
	try {
		await fn();
		return false;
	} catch (e) {
		if (!pattern) return true;
		return e instanceof Error && pattern.test(e.message);
	}
}

function throwsSync(fn: () => unknown): boolean {
	try {
		fn();
		return false;
	} catch {
		return true;
	}
}

// ---------------------------------------------------------------------------
// Ephemeral org lifecycle
// ---------------------------------------------------------------------------

async function createEphemeralOrg(slug: string): Promise<string> {
	const [row] = await db
		.insert(organization)
		.values({ name: `Smoke Test ${slug}`, slug, createdAt: new Date() })
		.returning({ id: organization.id });
	if (!row) throw new Error("createEphemeralOrg: insert returned no row");
	return row.id;
}

async function deleteEphemeralOrg(orgId: string): Promise<void> {
	// onDelete: "cascade" on organizationId fans out to organization_capability +
	// organization_setting; deleting the org row is sufficient cleanup.
	await db.delete(organization).where(eq(organization.id, orgId));
}

// ---------------------------------------------------------------------------
// Test sections
// ---------------------------------------------------------------------------

async function testDefaultsAndResolverShape(orgId: string): Promise<void> {
	logger.info("--- L1 defaults flow through resolver ---");

	const caps = await getEffectiveCapabilities(orgId);
	check(caps.length > 0, `getEffectiveCapabilities returns rows (got ${caps.length})`);
	check(
		caps.every((c) => c.isOverridden === false),
		"clean org: every capability isOverridden=false",
	);

	const capMap = new Map(caps.map((c) => [c.key, c]));
	check(
		capMap.get("workflows.recurring_runs")?.enabled === true,
		"workflows.recurring_runs defaults to enabled=true",
	);
	check(
		capMap.get("automation.rules")?.enabled === false,
		"automation.rules defaults to enabled=false",
	);
	check(
		capMap.get("governance.approvals")?.enabled === false,
		"governance.approvals defaults to enabled=false",
	);

	const settings = await getEffectiveSettings(orgId);
	check(settings.length > 0, `getEffectiveSettings returns rows (got ${settings.length})`);
	check(
		settings.every((s) => s.isOverridden === false),
		"clean org: every setting isOverridden=false",
	);

	const settingMap = new Map(settings.map((s) => [s.key, s]));
	check(
		settingMap.get("runs.auto_close_after_days")?.value === 0,
		"runs.auto_close_after_days defaults to 0",
	);
	check(
		settingMap.get("workflows.default_visibility")?.value === "organization",
		'workflows.default_visibility defaults to "organization"',
	);

	// Gated settings whose parent is off should be filtered out by default.
	check(
		!settingMap.has("governance.approval_required_for_publish"),
		"governance.approval_required_for_publish filtered (parent capability is off)",
	);
}

async function testCapabilityRoundtrip(orgId: string): Promise<void> {
	logger.info("--- Capability override roundtrip ---");

	await setOrganizationCapabilityOverride(orgId, "automation.rules", true);
	let caps = await getEffectiveCapabilities(orgId);
	let row = caps.find((c) => c.key === "automation.rules");
	check(row?.enabled === true && row?.isOverridden === true, "set true: enabled=true, isOverridden=true");
	check(
		(await isCapabilityEnabledForOrg(orgId, "automation.rules")) === true,
		"isCapabilityEnabledForOrg matches",
	);

	// Idempotent overwrite to false (override row stays present, value flips)
	await setOrganizationCapabilityOverride(orgId, "automation.rules", false);
	caps = await getEffectiveCapabilities(orgId);
	row = caps.find((c) => c.key === "automation.rules");
	check(
		row?.enabled === false && row?.isOverridden === true,
		"overwrite false: enabled=false, isOverridden=true (explicit override-to-off)",
	);
	check(
		(await isCapabilityEnabledForOrg(orgId, "automation.rules")) === false,
		"isCapabilityEnabledForOrg reflects override-to-off",
	);

	await clearOrganizationCapabilityOverride(orgId, "automation.rules");
	caps = await getEffectiveCapabilities(orgId);
	row = caps.find((c) => c.key === "automation.rules");
	check(
		row?.enabled === false && row?.isOverridden === false,
		"clear: reverts to default (false), isOverridden=false",
	);
}

async function testSettingRoundtrip(orgId: string): Promise<void> {
	logger.info("--- Setting override roundtrip ---");

	const before = await getEffectiveSettingValue(orgId, "runs.auto_close_after_days");
	check(before === 0, `before override: value=0 (got ${JSON.stringify(before)})`);

	await setOrganizationSettingOverride(orgId, "runs.auto_close_after_days", 14);
	const after = await getEffectiveSettingValue(orgId, "runs.auto_close_after_days");
	check(after === 14, `after set: value=14 (got ${JSON.stringify(after)})`);

	const settings = await getEffectiveSettings(orgId);
	const overridden = settings.find((s) => s.key === "runs.auto_close_after_days");
	check(overridden?.isOverridden === true, "isOverridden=true on resolved row");

	await setOrganizationSettingOverride(orgId, "runs.auto_close_after_days", 30);
	const overwritten = await getEffectiveSettingValue(orgId, "runs.auto_close_after_days");
	check(overwritten === 30, `idempotent overwrite: value=30 (got ${JSON.stringify(overwritten)})`);

	await clearOrganizationSettingOverride(orgId, "runs.auto_close_after_days");
	const reverted = await getEffectiveSettingValue(orgId, "runs.auto_close_after_days");
	check(reverted === 0, `after clear: reverts to default 0 (got ${JSON.stringify(reverted)})`);
}

async function testSettingGating(orgId: string): Promise<void> {
	logger.info("--- Setting gating: filter + defense-in-depth on write ---");

	// L1 default for governance.approvals is false, so the gated setting is filtered out.
	let value = await getEffectiveSettingValue(orgId, "governance.approval_required_for_publish");
	check(value === undefined, "gated-off: getEffectiveSettingValue returns undefined");

	// Defense in depth: API refuses to set an override on a gated-off setting.
	const refusedWhileOff = await throwsAsync(
		() =>
			setOrganizationSettingOverride(
				orgId,
				"governance.approval_required_for_publish",
				true,
			) as Promise<unknown>,
		/gated by capability.*currently disabled/,
	);
	check(refusedWhileOff, "set on gated-off setting: refused with gating error");

	// Enable the parent capability via override, then the setting becomes writable + visible.
	await setOrganizationCapabilityOverride(orgId, "governance.approvals", true);
	value = await getEffectiveSettingValue(orgId, "governance.approval_required_for_publish");
	check(
		value === false,
		`gated-on (no override yet): value=false default (got ${JSON.stringify(value)})`,
	);

	await setOrganizationSettingOverride(orgId, "governance.approval_required_for_publish", true);
	value = await getEffectiveSettingValue(orgId, "governance.approval_required_for_publish");
	check(value === true, "set after enabling parent: override applied");

	// Re-disable parent — setting filtered again, but the L3 override row persists silently
	// (per CONFIGURATION.md §6 gotcha #2). Re-enable -> override resurfaces.
	await setOrganizationCapabilityOverride(orgId, "governance.approvals", false);
	value = await getEffectiveSettingValue(orgId, "governance.approval_required_for_publish");
	check(value === undefined, "re-disable parent: setting filtered out again");

	await setOrganizationCapabilityOverride(orgId, "governance.approvals", true);
	value = await getEffectiveSettingValue(orgId, "governance.approval_required_for_publish");
	check(value === true, "re-enable parent: prior override resurfaces (no auto-cleanup)");

	// Cleanup for next test.
	await clearOrganizationSettingOverride(orgId, "governance.approval_required_for_publish");
	await clearOrganizationCapabilityOverride(orgId, "governance.approvals");
}

async function testValidation(orgId: string): Promise<void> {
	logger.info("--- validateSettingValue happy + sad paths ---");

	// boolean
	check(
		!throwsSync(() => validateSettingValue({ dataType: "boolean", validationSchema: null }, true)),
		"boolean: true accepted",
	);
	check(
		throwsSync(() => validateSettingValue({ dataType: "boolean", validationSchema: null }, "true")),
		'boolean: "true" (string) rejected',
	);

	// number with min/max + int
	check(
		!throwsSync(() =>
			validateSettingValue({ dataType: "number", validationSchema: { min: 0, max: 30 } }, 14),
		),
		"number: 14 in [0,30] accepted",
	);
	check(
		throwsSync(() =>
			validateSettingValue({ dataType: "number", validationSchema: { min: 0, max: 30 } }, 31),
		),
		"number: 31 above max rejected",
	);
	check(
		throwsSync(() => validateSettingValue({ dataType: "number", validationSchema: { int: true } }, 1.5)),
		"number: 1.5 with int=true rejected",
	);

	// string with pattern
	check(
		!throwsSync(() =>
			validateSettingValue(
				{ dataType: "string", validationSchema: { pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" } },
				"08:30",
			),
		),
		'string: "08:30" matches HH:MM pattern',
	);
	check(
		throwsSync(() =>
			validateSettingValue(
				{ dataType: "string", validationSchema: { pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" } },
				"25:99",
			),
		),
		'string: "25:99" rejected by pattern',
	);

	// select
	check(
		!throwsSync(() =>
			validateSettingValue(
				{ dataType: "select", validationSchema: { options: ["private", "organization"] } },
				"private",
			),
		),
		'select: "private" in options accepted',
	);
	check(
		throwsSync(() =>
			validateSettingValue(
				{ dataType: "select", validationSchema: { options: ["private", "organization"] } },
				"public",
			),
		),
		'select: "public" not in options rejected',
	);

	// json (no constraints)
	check(
		!throwsSync(() => validateSettingValue({ dataType: "json", validationSchema: null }, { x: 1 })),
		"json: any object accepted",
	);

	// setOrganizationSettingOverride enforces validation end-to-end
	const rejected = await throwsAsync(
		() => setOrganizationSettingOverride(orgId, "notifications.digest_time_local", "99:99"),
	);
	check(rejected, "setOrganizationSettingOverride: invalid HH:MM rejected");
}

async function testProfileApplication(orgId: string): Promise<void> {
	logger.info("--- applyEnablementProfile mutual exclusion ---");

	// Start clean: clear any leftover capability overrides on profile-managed keys.
	for (const key of new Set(Object.values(PROFILES).flat())) {
		await clearOrganizationCapabilityOverride(orgId, key);
	}

	// checklist enables 2, disables the other 8 profile-managed.
	await applyEnablementProfile(orgId, "checklist");
	let map = new Map((await getEffectiveCapabilities(orgId)).map((c) => [c.key, c]));
	check(map.get("workflows.recurring_runs")?.enabled === true, "checklist: recurring_runs on");
	check(map.get("workflows.kickoff_forms")?.enabled === true, "checklist: kickoff_forms on");
	check(
		map.get("workflows.guest_participants")?.enabled === false,
		"checklist: guest_participants off",
	);
	check(map.get("automation.rules")?.enabled === false, "checklist: automation.rules off");
	check(map.get("governance.approvals")?.enabled === false, "checklist: approvals off");

	// sop superset of checklist.
	await applyEnablementProfile(orgId, "sop");
	map = new Map((await getEffectiveCapabilities(orgId)).map((c) => [c.key, c]));
	check(map.get("governance.approvals")?.enabled === true, "sop: approvals on");
	check(map.get("governance.acknowledgments")?.enabled === true, "sop: acknowledgments on");
	check(map.get("library.public_listings")?.enabled === true, "sop: public_listings on");
	check(map.get("automation.rules")?.enabled === false, "sop: automation.rules still off");
	check(
		map.get("integrations.webhooks")?.enabled === false,
		"sop: webhooks off (automation-only)",
	);

	// automation enables everything profile-managed.
	await applyEnablementProfile(orgId, "automation");
	map = new Map((await getEffectiveCapabilities(orgId)).map((c) => [c.key, c]));
	check(map.get("automation.rules")?.enabled === true, "automation: automation.rules on");
	check(map.get("integrations.webhooks")?.enabled === true, "automation: webhooks on");
	check(
		map.get("workflows.kickoff_forms")?.enabled === true,
		"automation: kickoff_forms still on (carried)",
	);

	// Switch back to checklist — destructive within profile scope.
	await applyEnablementProfile(orgId, "checklist");
	map = new Map((await getEffectiveCapabilities(orgId)).map((c) => [c.key, c]));
	check(map.get("automation.rules")?.enabled === false, "back to checklist: automation.rules off");
	check(
		map.get("integrations.webhooks")?.enabled === false,
		"back to checklist: webhooks off",
	);
	check(map.get("workflows.recurring_runs")?.enabled === true, "back to checklist: recurring_runs on");
}

async function testUnknownKeys(orgId: string): Promise<void> {
	logger.info("--- Unknown-key error cases ---");

	check(
		(await isCapabilityEnabledForOrg(orgId, "does.not.exist")) === false,
		"isCapabilityEnabledForOrg: unknown key returns false (no throw)",
	);
	check(
		(await getEffectiveSettingValue(orgId, "does.not.exist")) === undefined,
		"getEffectiveSettingValue: unknown key returns undefined",
	);
	check(
		await throwsAsync(
			() => setOrganizationCapabilityOverride(orgId, "does.not.exist", true),
			/Unknown capability key/,
		),
		"setOrganizationCapabilityOverride: unknown key throws",
	);
	check(
		await throwsAsync(
			() => setOrganizationSettingOverride(orgId, "does.not.exist", 1),
			/Unknown setting key/,
		),
		"setOrganizationSettingOverride: unknown key throws",
	);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	const slug = `__config_smoke_${Date.now()}`;
	const orgId = await createEphemeralOrg(slug);
	logger.info(`Running smoke test against ephemeral org "${slug}" (${orgId})`);

	try {
		await testDefaultsAndResolverShape(orgId);
		await testCapabilityRoundtrip(orgId);
		await testSettingRoundtrip(orgId);
		await testSettingGating(orgId);
		await testValidation(orgId);
		await testProfileApplication(orgId);
		await testUnknownKeys(orgId);
	} finally {
		await deleteEphemeralOrg(orgId);
		logger.info(`Cleaned up ephemeral org ${orgId}`);
	}

	logger.info("--- Summary ---");
	if (failures > 0) {
		logger.error(`FAILED: ${failures} of ${passed + failures} checks`);
		process.exit(1);
	}
	logger.success(`PASSED: ${passed} of ${passed} checks`);
}

main().catch((e) => {
	logger.error(e);
	process.exit(1);
});
