// packages/database/drizzle/queries/config.ts
//
// Resolver for the capability/setting mode engine. See ARCHITECTURE.md ADR-001 and §5;
// BUILD_PLAN.md Phase 2. Per-org configuration resolves as: per-org override -> capability
// default. Enablement profiles (checklist/SOP/automation) are bulk-setter shortcuts, not
// stored state -- the org's current configuration IS the union of capability overrides.
//
// A setting whose parent capability is disabled is filtered out of the resolved set entirely
// (settings only exist if their feature does). Validation uses each setting's stored
// `validationSchema` jsonb to build a Zod schema at runtime.

import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "../client";
import {
	capability,
	organizationCapability,
	organizationSetting,
	settingDefinition,
} from "../schema/postgres";

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

export type EnablementProfile = "checklist" | "sop" | "automation";

/**
 * Profile -> capability-key map. Each profile is an enablement preset that bulk-sets the
 * capabilities it manages. Profiles are mutually exclusive (mode-shaped): applying a profile
 * sets every key it manages to `enabled=true` and every other profile-managed key to
 * `enabled=false`. Capabilities NOT referenced by ANY profile are never touched by
 * `applyEnablementProfile`, so org-level custom overrides outside profile scope survive.
 */
export const PROFILES = {
	checklist: ["workflows.recurring_runs", "workflows.kickoff_forms"],
	sop: [
		"workflows.recurring_runs",
		"workflows.kickoff_forms",
		"workflows.guest_participants",
		"governance.approvals",
		"governance.acknowledgments",
		"governance.suggestions",
		"library.public_listings",
		"fields.custom_definitions",
	],
	automation: [
		"workflows.recurring_runs",
		"workflows.kickoff_forms",
		"workflows.guest_participants",
		"governance.approvals",
		"governance.acknowledgments",
		"governance.suggestions",
		"library.public_listings",
		"fields.custom_definitions",
		"automation.rules",
		"integrations.webhooks",
	],
} as const satisfies Record<EnablementProfile, readonly string[]>;

/** Union of every capability key referenced by any profile. Seed validates the canonical
 * capability set is a superset of this. */
export const ALL_PROFILE_CAPABILITY_KEYS: readonly string[] = Array.from(
	new Set(Object.values(PROFILES).flat()),
);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SettingDataType = "string" | "number" | "boolean" | "json" | "select" | "multiselect";

export interface EffectiveCapability {
	id: string;
	key: string;
	name: string;
	description: string | null;
	enabled: boolean;
	isOverridden: boolean;
	sortOrder: number;
}

export interface EffectiveSetting {
	id: string;
	key: string;
	name: string;
	description: string | null;
	dataType: SettingDataType;
	category: string | null;
	capabilityId: string | null;
	isAdvanced: boolean;
	sortOrder: number;
	value: unknown;
	defaultValue: unknown;
	isOverridden: boolean;
	validationSchema: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

/**
 * Return one row per active capability with `enabled` resolved to per-org override (if set)
 * or the capability's `defaultEnabled`. `isOverridden` reflects whether an
 * organization_capability row exists for this (org, capability) pair.
 */
export async function getEffectiveCapabilities(orgId: string): Promise<EffectiveCapability[]> {
	const rows = await db
		.select({
			id: capability.id,
			key: capability.key,
			name: capability.name,
			description: capability.description,
			defaultEnabled: capability.defaultEnabled,
			sortOrder: capability.sortOrder,
			overrideEnabled: organizationCapability.enabled,
			// NOT NULL marker from the override side: present <=> a row was joined.
			overrideMarker: organizationCapability.organizationId,
		})
		.from(capability)
		.leftJoin(
			organizationCapability,
			and(
				eq(organizationCapability.capabilityId, capability.id),
				eq(organizationCapability.organizationId, orgId),
			),
		)
		.where(eq(capability.status, "active"))
		.orderBy(capability.sortOrder, capability.key);

	return rows.map((r) => ({
		id: r.id,
		key: r.key,
		name: r.name,
		description: r.description,
		enabled: r.overrideMarker !== null ? (r.overrideEnabled ?? r.defaultEnabled) : r.defaultEnabled,
		isOverridden: r.overrideMarker !== null,
		sortOrder: r.sortOrder,
	}));
}

/**
 * Return one row per active setting whose parent capability (if any) is enabled. Value is
 * the per-org override (if set) or the setting's `defaultValue`. Settings gated by a
 * disabled capability are filtered out entirely.
 */
export async function getEffectiveSettings(orgId: string): Promise<EffectiveSetting[]> {
	const rows = await db
		.select({
			id: settingDefinition.id,
			key: settingDefinition.key,
			name: settingDefinition.name,
			description: settingDefinition.description,
			dataType: settingDefinition.dataType,
			category: settingDefinition.category,
			capabilityId: settingDefinition.capabilityId,
			isAdvanced: settingDefinition.isAdvanced,
			sortOrder: settingDefinition.sortOrder,
			defaultValue: settingDefinition.defaultValue,
			validationSchema: settingDefinition.validationSchema,
			overrideValue: organizationSetting.value,
			overrideMarker: organizationSetting.organizationId,
			capDefaultEnabled: capability.defaultEnabled,
			capOverrideEnabled: organizationCapability.enabled,
			capOverrideMarker: organizationCapability.organizationId,
		})
		.from(settingDefinition)
		.leftJoin(
			organizationSetting,
			and(
				eq(organizationSetting.settingDefinitionId, settingDefinition.id),
				eq(organizationSetting.organizationId, orgId),
			),
		)
		.leftJoin(capability, eq(capability.id, settingDefinition.capabilityId))
		.leftJoin(
			organizationCapability,
			and(
				eq(organizationCapability.capabilityId, settingDefinition.capabilityId),
				eq(organizationCapability.organizationId, orgId),
			),
		)
		.where(eq(settingDefinition.status, "active"))
		.orderBy(settingDefinition.sortOrder, settingDefinition.key);

	return rows
		.filter((r) => {
			if (!r.capabilityId) return true;
			const capEnabled =
				r.capOverrideMarker !== null
					? (r.capOverrideEnabled ?? r.capDefaultEnabled)
					: r.capDefaultEnabled;
			return capEnabled === true;
		})
		.map((r) => ({
			id: r.id,
			key: r.key,
			name: r.name,
			description: r.description,
			dataType: r.dataType as SettingDataType,
			category: r.category,
			capabilityId: r.capabilityId,
			isAdvanced: r.isAdvanced,
			sortOrder: r.sortOrder,
			value: r.overrideMarker !== null ? r.overrideValue : r.defaultValue,
			defaultValue: r.defaultValue,
			isOverridden: r.overrideMarker !== null,
			validationSchema: r.validationSchema as Record<string, unknown> | null,
		}));
}

/** Look up a single resolved setting value by key. Returns `undefined` if the setting
 * doesn't exist, is inactive, or is gated off by its capability. */
export async function getEffectiveSettingValue(orgId: string, key: string): Promise<unknown> {
	const all = await getEffectiveSettings(orgId);
	return all.find((s) => s.key === key)?.value;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

type ValidationSchemaShape = Record<string, unknown> | null;

const VALIDATION_BUILDERS: Record<SettingDataType, (schema: ValidationSchemaShape) => z.ZodTypeAny> =
	{
		string: (s) => {
			let z_ = z.string();
			if (typeof s?.minLength === "number") z_ = z_.min(s.minLength);
			if (typeof s?.maxLength === "number") z_ = z_.max(s.maxLength);
			if (typeof s?.pattern === "string") z_ = z_.regex(new RegExp(s.pattern));
			return z_;
		},
		number: (s) => {
			let z_ = z.number();
			if (typeof s?.min === "number") z_ = z_.min(s.min);
			if (typeof s?.max === "number") z_ = z_.max(s.max);
			if (s?.int === true) z_ = z_.int();
			return z_;
		},
		boolean: () => z.boolean(),
		json: () => z.unknown(),
		select: (s) =>
			Array.isArray(s?.options) && s.options.length > 0
				? z.enum(s.options as [string, ...string[]])
				: z.string(),
		multiselect: (s) =>
			Array.isArray(s?.options) && s.options.length > 0
				? z.array(z.enum(s.options as [string, ...string[]]))
				: z.array(z.string()),
	};

/** Validate a value against a setting definition. Returns the parsed value or throws
 * `ZodError`. */
export function validateSettingValue(
	definition: Pick<EffectiveSetting, "dataType" | "validationSchema">,
	value: unknown,
): unknown {
	const builder = VALIDATION_BUILDERS[definition.dataType];
	if (!builder) {
		throw new Error(`Unknown setting dataType: ${definition.dataType}`);
	}
	return builder(definition.validationSchema).parse(value);
}

// ---------------------------------------------------------------------------
// Seed helpers (called from tooling/scripts/src/seed-*.ts)
// ---------------------------------------------------------------------------

export interface CapabilitySeed {
	key: string;
	name: string;
	description: string;
	defaultEnabled: boolean;
	sortOrder: number;
}

export interface SettingDefinitionSeed {
	key: string;
	name: string;
	description: string;
	dataType: SettingDataType;
	defaultValue: unknown;
	validationSchema: Record<string, unknown> | null;
	category: string;
	/** Stable key of a gating capability; resolved to FK at upsert time. `null` = ungated. */
	capabilityKey: string | null;
	isAdvanced?: boolean;
	sortOrder: number;
}

/** Idempotent capability upsert matched by `key`. Never touches `status` so manually
 * archived capabilities stay archived. Returns count for reporting. */
export async function upsertCapabilities(rows: CapabilitySeed[]): Promise<{ count: number }> {
	if (rows.length === 0) return { count: 0 };
	await db
		.insert(capability)
		.values(rows)
		.onConflictDoUpdate({
			target: capability.key,
			set: {
				name: sql`excluded.name`,
				description: sql`excluded.description`,
				defaultEnabled: sql`excluded.default_enabled`,
				sortOrder: sql`excluded.sort_order`,
				updatedAt: new Date(),
			},
		});
	return { count: rows.length };
}

/** Idempotent setting_definition upsert matched by `key`. Resolves `capabilityKey` to
 * `capabilityId` via DB lookup; throws if any referenced key is missing (run
 * `upsertCapabilities` first). Never touches `status`. */
export async function upsertSettingDefinitions(
	rows: SettingDefinitionSeed[],
): Promise<{ count: number }> {
	if (rows.length === 0) return { count: 0 };

	const referencedKeys = rows
		.map((s) => s.capabilityKey)
		.filter((k): k is string => k !== null);
	const lookup = new Map<string, string>();
	if (referencedKeys.length > 0) {
		const found = await db
			.select({ id: capability.id, key: capability.key })
			.from(capability)
			.where(inArray(capability.key, referencedKeys));
		for (const r of found) lookup.set(r.key, r.id);
		const missing = referencedKeys.filter((k) => !lookup.has(k));
		if (missing.length > 0) {
			throw new Error(
				`upsertSettingDefinitions: ${missing.length} gating capability key(s) not found: ${missing.join(", ")}. Seed capabilities first.`,
			);
		}
	}

	const values = rows.map((s) => ({
		key: s.key,
		name: s.name,
		description: s.description,
		dataType: s.dataType,
		defaultValue: s.defaultValue,
		validationSchema: s.validationSchema,
		category: s.category,
		capabilityId: s.capabilityKey ? (lookup.get(s.capabilityKey) ?? null) : null,
		isAdvanced: s.isAdvanced ?? false,
		sortOrder: s.sortOrder,
	}));

	await db
		.insert(settingDefinition)
		.values(values)
		.onConflictDoUpdate({
			target: settingDefinition.key,
			set: {
				name: sql`excluded.name`,
				description: sql`excluded.description`,
				dataType: sql`excluded.data_type`,
				defaultValue: sql`excluded.default_value`,
				validationSchema: sql`excluded.validation_schema`,
				category: sql`excluded.category`,
				capabilityId: sql`excluded.capability_id`,
				isAdvanced: sql`excluded.is_advanced`,
				sortOrder: sql`excluded.sort_order`,
				updatedAt: new Date(),
			},
		});

	return { count: rows.length };
}

/** True when the org has any per-org capability override row -- i.e. the onboarding mode
 * picker has already been applied (or the admin has touched the Configuration page).
 * Used by the onboarding mode-picker route to redirect already-configured orgs to the
 * Configuration page instead of re-prompting. */
export async function hasOrgCompletedModeSetup(organizationId: string): Promise<boolean> {
	const rows = await db
		.select({ marker: organizationCapability.organizationId })
		.from(organizationCapability)
		.where(eq(organizationCapability.organizationId, organizationId))
		.limit(1);
	return rows.length > 0;
}

/** Return capability keys referenced by PROFILES that don't yet exist in the DB. Used by
 * the capability seed to verify the canonical set is a superset of profile-managed keys. */
export async function findMissingProfileCapabilityKeys(): Promise<string[]> {
	const present = await db
		.select({ key: capability.key })
		.from(capability)
		.where(inArray(capability.key, [...ALL_PROFILE_CAPABILITY_KEYS]));
	const presentSet = new Set(present.map((r) => r.key));
	return ALL_PROFILE_CAPABILITY_KEYS.filter((k) => !presentSet.has(k));
}

// ---------------------------------------------------------------------------
// Single-capability gate
// ---------------------------------------------------------------------------

/**
 * Resolve a single capability's effective state for an org. Returns `false` if the
 * capability key doesn't exist or is not `active`. Use this in feature gates / middleware
 * where you only need one answer; use `getEffectiveCapabilities` for the full set.
 */
export async function isCapabilityEnabledForOrg(orgId: string, key: string): Promise<boolean> {
	const rows = await db
		.select({
			defaultEnabled: capability.defaultEnabled,
			overrideEnabled: organizationCapability.enabled,
			overrideMarker: organizationCapability.organizationId,
		})
		.from(capability)
		.leftJoin(
			organizationCapability,
			and(
				eq(organizationCapability.capabilityId, capability.id),
				eq(organizationCapability.organizationId, orgId),
			),
		)
		.where(and(eq(capability.key, key), eq(capability.status, "active")))
		.limit(1);

	const row = rows[0];
	if (!row) return false;
	return row.overrideMarker !== null
		? (row.overrideEnabled ?? row.defaultEnabled)
		: row.defaultEnabled;
}

// ---------------------------------------------------------------------------
// Per-org override mutators (called from the oRPC config procedures)
// ---------------------------------------------------------------------------

/** Upsert a per-org capability override matched by capability key. Throws if the key is
 * not a known capability. */
export async function setOrganizationCapabilityOverride(
	organizationId: string,
	capabilityKey: string,
	enabled: boolean,
): Promise<void> {
	const found = await db
		.select({ id: capability.id })
		.from(capability)
		.where(eq(capability.key, capabilityKey))
		.limit(1);
	if (found.length === 0) {
		throw new Error(`Unknown capability key: ${capabilityKey}`);
	}
	await db
		.insert(organizationCapability)
		.values({ organizationId, capabilityId: found[0].id, enabled })
		.onConflictDoUpdate({
			target: [organizationCapability.organizationId, organizationCapability.capabilityId],
			set: { enabled, updatedAt: new Date() },
		});
}

/** Upsert a per-org setting override matched by setting key. Validates `value` against the
 * setting's stored `validationSchema` before writing; throws on validation failure or
 * unknown setting key.
 *
 * Defense in depth: refuses to write if the setting is gated by a capability that
 * currently resolves to disabled for this org. The UI should not surface such settings,
 * but the API enforces it too (per docs/CONFIGURATION.md §4). */
export async function setOrganizationSettingOverride(
	organizationId: string,
	settingKey: string,
	value: unknown,
): Promise<void> {
	const found = await db
		.select({
			id: settingDefinition.id,
			dataType: settingDefinition.dataType,
			validationSchema: settingDefinition.validationSchema,
			capabilityId: settingDefinition.capabilityId,
		})
		.from(settingDefinition)
		.where(eq(settingDefinition.key, settingKey))
		.limit(1);
	if (found.length === 0) {
		throw new Error(`Unknown setting key: ${settingKey}`);
	}
	const def = found[0];

	if (def.capabilityId) {
		const capRows = await db
			.select({
				key: capability.key,
				defaultEnabled: capability.defaultEnabled,
				overrideEnabled: organizationCapability.enabled,
				overrideMarker: organizationCapability.organizationId,
			})
			.from(capability)
			.leftJoin(
				organizationCapability,
				and(
					eq(organizationCapability.capabilityId, capability.id),
					eq(organizationCapability.organizationId, organizationId),
				),
			)
			.where(and(eq(capability.id, def.capabilityId), eq(capability.status, "active")))
			.limit(1);
		const capRow = capRows[0];
		const capEnabled = capRow
			? capRow.overrideMarker !== null
				? (capRow.overrideEnabled ?? capRow.defaultEnabled)
				: capRow.defaultEnabled
			: false;
		if (!capEnabled) {
			throw new Error(
				`setOrganizationSettingOverride: setting "${settingKey}" is gated by capability "${capRow?.key ?? def.capabilityId}", which is currently disabled for this org.`,
			);
		}
	}

	const validated = validateSettingValue(
		{
			dataType: def.dataType as SettingDataType,
			validationSchema: def.validationSchema as Record<string, unknown> | null,
		},
		value,
	);
	await db
		.insert(organizationSetting)
		.values({ organizationId, settingDefinitionId: def.id, value: validated })
		.onConflictDoUpdate({
			target: [organizationSetting.organizationId, organizationSetting.settingDefinitionId],
			set: { value: validated, updatedAt: new Date() },
		});
}

/** Remove a per-org capability override matched by capability key. The org will inherit
 * the capability's default after this. No-op if the override doesn't exist. */
export async function clearOrganizationCapabilityOverride(
	organizationId: string,
	capabilityKey: string,
): Promise<void> {
	const found = await db
		.select({ id: capability.id })
		.from(capability)
		.where(eq(capability.key, capabilityKey))
		.limit(1);
	if (found.length === 0) {
		throw new Error(`Unknown capability key: ${capabilityKey}`);
	}
	await db
		.delete(organizationCapability)
		.where(
			and(
				eq(organizationCapability.organizationId, organizationId),
				eq(organizationCapability.capabilityId, found[0].id),
			),
		);
}

/** Remove a per-org setting override matched by setting key. The org will inherit the
 * setting's default after this. No-op if the override doesn't exist. */
export async function clearOrganizationSettingOverride(
	organizationId: string,
	settingKey: string,
): Promise<void> {
	const found = await db
		.select({ id: settingDefinition.id })
		.from(settingDefinition)
		.where(eq(settingDefinition.key, settingKey))
		.limit(1);
	if (found.length === 0) {
		throw new Error(`Unknown setting key: ${settingKey}`);
	}
	await db
		.delete(organizationSetting)
		.where(
			and(
				eq(organizationSetting.organizationId, organizationId),
				eq(organizationSetting.settingDefinitionId, found[0].id),
			),
		);
}

// ---------------------------------------------------------------------------
// Profile application
// ---------------------------------------------------------------------------

/**
 * Apply an enablement profile to an org. Bulk-upserts `organization_capability` rows for
 * every capability key referenced by any profile: `enabled=true` if the key is in this
 * profile's map, `enabled=false` otherwise. Capabilities outside profile scope are NOT
 * touched, preserving custom overrides.
 *
 * Returns counts of rows set to enabled/disabled. Throws if no profile-managed capability
 * keys resolve to existing capability rows (seed not run).
 */
export async function applyEnablementProfile(
	orgId: string,
	profile: EnablementProfile,
): Promise<{ enabled: number; disabled: number }> {
	const profileKeys = new Set<string>(PROFILES[profile]);
	const managedKeys = [...new Set<string>(ALL_PROFILE_CAPABILITY_KEYS)];

	const capabilities = await db
		.select({ id: capability.id, key: capability.key })
		.from(capability)
		.where(inArray(capability.key, managedKeys));

	if (capabilities.length === 0) {
		throw new Error(
			`applyEnablementProfile: no capabilities found for profile-managed keys. ` +
				`Run \`pnpm --filter @virn/scripts seed:capabilities\` first.`,
		);
	}

	const toUpsert = capabilities.map((c) => ({
		organizationId: orgId,
		capabilityId: c.id,
		enabled: profileKeys.has(c.key),
	}));

	await db
		.insert(organizationCapability)
		.values(toUpsert)
		.onConflictDoUpdate({
			target: [organizationCapability.organizationId, organizationCapability.capabilityId],
			set: {
				enabled: sql`excluded.enabled`,
				updatedAt: new Date(),
			},
		});

	const enabled = toUpsert.filter((r) => r.enabled).length;
	return { enabled, disabled: toUpsert.length - enabled };
}
