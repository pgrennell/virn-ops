# Configuration

How per-org configuration resolves in Virn Ops — the capability/setting model, the
three levels that combine into an "effective" config at runtime, the enablement-profile
shortcut, and the deferred seams.

> **Scope.** This document is normative for the resolver and write helpers. Schema lives in
> [packages/database/drizzle/schema/postgres.ts](packages/database/drizzle/schema/postgres.ts);
> resolver and seed helpers live in
> [packages/database/drizzle/queries/config.ts](packages/database/drizzle/queries/config.ts).
> See also: [ARCHITECTURE.md §2](ARCHITECTURE.md) (layered architecture),
> [ARCHITECTURE.md §4 ADR-005](ARCHITECTURE.md) (entitlements use the same capability unit),
> and [BUILD_PLAN.md Phase 2](BUILD_PLAN.md) (the config/mode system).

---

## 1. The three levels

Configuration resolves bottom-up. Each level is sparse — absence means "inherit from the
level below."

| # | Level | Owner | Storage | Lifetime |
|---|---|---|---|---|
| **L1** | **Platform defaults** | Platform engineers | `capability`, `setting_definition` | Append-only via seed scripts; backward-compatible |
| **L2** | **Profile preset** | Org admin (or onboarding) | Bulk-writes to L3 — not a separate table | Applied once, then can drift via L3 edits |
| **L3** | **Per-org override** | Org admin | `organization_capability`, `organization_setting` | Sparse: one row per explicit override |

L2 is a **bulk-setter shortcut**, not a separate storage layer — applying a profile
upserts a specific set of `organization_capability` rows. The org's *current* state is
always the union of L1 defaults + L3 overrides; profiles are just a fast way to seed L3.

This is intentional: it keeps the resolver simple (two levels at read time — default vs.
override) while preserving the *intent* of profile application as a discrete operator
gesture.

### L1 — Platform definitions (source of truth)

- **`capability`** — boolean feature toggles, keyed by stable namespaced strings
  (`workflows.recurring_runs`, `governance.approvals`, `automation.rules`, …).
  Fields: `key`, `name`, `description`, `defaultEnabled`, `status` (`active|deprecated`),
  `sortOrder`.
- **`setting_definition`** — typed config keys with validation.
  Fields: `key`, `dataType` (`string|number|boolean|json|select|multiselect`),
  `defaultValue` (jsonb), `validationSchema` (jsonb), `category`, **`capabilityId`
  (nullable FK)**, `isAdvanced`, `sortOrder`, `status`.

A setting's `capabilityId` is the **gating link**: if the gating capability resolves to
disabled, the setting is hidden entirely. `capabilityId IS NULL` means the setting is
universal (always visible).

**Seeding.** Idempotent via key match:
- [tooling/scripts/src/seed-capabilities.ts](../tooling/scripts/src/seed-capabilities.ts) →
  `upsertCapabilities()`
- [tooling/scripts/src/seed-settings.ts](../tooling/scripts/src/seed-settings.ts) →
  `upsertSettingDefinitions()` (resolves `capabilityKey` → FK at upsert time)

Run with `pnpm --filter @virn/scripts seed:capabilities` and `seed:settings`. The
capability seed verifies that every key referenced by a profile is present
(`findMissingProfileCapabilityKeys`) and exits non-zero otherwise.

Changing `defaultEnabled` or `defaultValue` propagates to every org on the next read —
there is no backfill. L3 rows continue to win where present.

### L2 — Enablement profiles

A profile is a **named bundle of capability keys** — applying it bulk-upserts
`organization_capability` rows so that profile-listed keys are enabled and every other
profile-managed key is disabled. Capabilities **outside profile scope are not touched**,
so custom L3 overrides on non-profile capabilities survive.

Defined in [packages/database/drizzle/queries/config.ts:36-60](../packages/database/drizzle/queries/config.ts#L36-L60):

| Profile | Adds (cumulatively) |
|---|---|
| `checklist` | recurring runs, kickoff forms |
| `sop` | + guest participants, approvals, acknowledgments, suggestions, public listings, custom field definitions |
| `automation` | + automation rules, outbound webhooks |

Profiles are **mode-shaped and mutually exclusive** in intent — applying `sop` will
re-enable everything `checklist` had plus more, and (importantly) disable any
profile-managed capability not in `sop`'s list. `applyEnablementProfile` is at
[config.ts:399-437](../packages/database/drizzle/queries/config.ts#L399-L437).

The profile-managed set is computed at module load
([config.ts:64-66](../packages/database/drizzle/queries/config.ts#L64-L66)) — adding a
key to any profile automatically expands the managed set; the capability seed will then
require that key to exist in L1.

### L3 — Per-org overrides

- **`organization_capability(organizationId, capabilityId, enabled)`** — composite PK.
  Row presence means "this org has explicitly chosen a value." Both `enabled=true` and
  `enabled=false` are overrides.
- **`organization_setting(organizationId, settingDefinitionId, value)`** — composite PK.
  `value` is validated at write time against the definition's `dataType` +
  `validationSchema` via `validateSettingValue` ([config.ts:257-266](../packages/database/drizzle/queries/config.ts#L257-L266)).

Both tables are **sparse** — no row means "inherit the default." Clearing an override is
a delete, not a write of the default value.

---

## 2. The resolver

All gating, UI display, and feature checks must go through the resolver. Never
reimplement the merge per feature.

```ts
import {
  getEffectiveCapabilities,
  getEffectiveSettings,
  getEffectiveSettingValue,
} from "@virn/database";
```

### Capabilities — [config.ts:109-142](../packages/database/drizzle/queries/config.ts#L109-L142)

For each active capability:

```
enabled = override_row_present ? override.enabled : capability.defaultEnabled
isOverridden = override_row_present
```

Returns one row per active capability with `{ id, key, name, enabled, isOverridden,
sortOrder }`.

### Settings — [config.ts:149-212](../packages/database/drizzle/queries/config.ts#L149-L212)

For each active setting definition:

```
gating_enabled =
  capabilityId IS NULL ? true
  : override_present ? capOverride.enabled : capability.defaultEnabled

IF NOT gating_enabled: drop the setting entirely
ELSE:
  value = override_present ? override.value : setting_definition.defaultValue
  isOverridden = override_present
```

Settings gated by a disabled capability are **filtered out**, not returned as hidden.
The UI receives only what's currently active for the org. This is stricter than PM's
visible-but-disabled approach and matches the principle "settings only exist if their
feature does."

### Single-value lookup — [config.ts:216-219](../packages/database/drizzle/queries/config.ts#L216-L219)

`getEffectiveSettingValue(orgId, key)` returns `undefined` if the setting doesn't exist,
is inactive, or is filtered out by a disabled gating capability. Callers should treat
`undefined` the same as "feature disabled."

### Validation — [config.ts:227-266](../packages/database/drizzle/queries/config.ts#L227-L266)

`validateSettingValue(definition, value)` builds a Zod schema at call time from
`(dataType, validationSchema)` and parses. Throws `ZodError` on failure. Callers that
write to `organization_setting` **must** run this first.

---

## 3. Capabilities vs. settings

| Aspect | Capability | Setting |
|---|---|---|
| Answers | Is this feature area on? | What value should we use? |
| Type | Boolean | `string`, `number`, `boolean`, `json`, `select`, `multiselect` |
| Gating | Drives setting visibility | Hidden when its gating capability is off |
| Default | `capability.defaultEnabled` | `setting_definition.defaultValue` |
| Override | `organization_capability.enabled` | `organization_setting.value` |
| Bulk action | Profiles | (none — set per-key) |

A capability with no settings under it is fine — it's just a feature flag. A setting
with `capabilityId IS NULL` is fine too — it's a universal config knob (e.g.
`branding.logo_url`, `notifications.digest_time_local`).

---

## 4. Write helpers

All live in [packages/database/drizzle/queries/config.ts](../packages/database/drizzle/queries/config.ts).
oRPC procedures that wrap them must be `protectedOrgProcedure` / `adminOrgProcedure` per
the org-scoping invariant ([ARCHITECTURE.md §3](ARCHITECTURE.md)).

- **`setOrganizationCapabilityOverride(orgId, capabilityKey, enabled)`** — upsert L3
  capability override. Throws on unknown key.
- **`clearOrganizationCapabilityOverride(orgId, capabilityKey)`** — delete L3 row;
  reverts to L1 default. Throws on unknown key; no-op if no override exists.
- **`setOrganizationSettingOverride(orgId, settingKey, value)`** — validate `value`
  against the definition, then upsert. **Refuses to write** if the setting is gated by a
  capability that currently resolves to disabled for this org (defense in depth — the UI
  shouldn't surface such settings, but the API enforces it too).
- **`clearOrganizationSettingOverride(orgId, settingKey)`** — delete L3 row; reverts to
  L1 default.
- **`isCapabilityEnabledForOrg(orgId, key)`** — single-capability gate. Returns `false`
  if the key doesn't exist or isn't active. Use in feature gates / middleware where you
  only need one answer.

---

## 5. Reserved seam — solution packs (deferred)

Solution packs ([ARCHITECTURE.md §4 ADR-001](ARCHITECTURE.md)) will introduce a fourth
level **between L1 and L3**: an installed pack stamps capability + setting overrides into
the org at install time, recording provenance in `pack_install`. Pack-level values then
behave as defaults that L3 can override.

The resolver shape doesn't need to change yet — pack installs simply write
`organization_capability` / `organization_setting` rows during install, marked with a
provenance pointer back to `pack_install`. The current "row present = override" semantics
hold; pack rows are just overrides whose author is a pack, not a user.

When packs land, this doc adds a new section between L1 and L2, and `isOverridden`
splits into `source ∈ { default | pack | user }`.

Also reserved (per [ARCHITECTURE.md §4 ADR-002](ARCHITECTURE.md)): the `field_definition`
registry uses the same scope axis (`platform | pack | org`) — same mental model,
different table.

---

## 6. Gotchas

1. **Profile re-application is destructive within profile scope.** Switching from
   `automation` to `checklist` will disable `automation.rules`, `integrations.webhooks`,
   `governance.approvals`, etc. — every profile-managed capability not in `checklist`'s
   list flips to `enabled=false`. Capabilities outside *any* profile's scope are
   untouched.

2. **Settings under a disabled capability still have L3 rows.** If a user sets
   `governance.approval_required_for_publish=true`, then disables the
   `governance.approvals` capability, the override row persists silently. Re-enabling
   the capability resurfaces the old `true`. There's no auto-cleanup; this is
   intentional (toggle-off should not be data loss). Document it for org admins.

3. **Default-value drift.** Changing `setting_definition.defaultValue` propagates to
   every org on next read — except where an L3 override happens to equal the *old*
   default. That override now diverges from the new platform default silently. Rare, but
   worth flagging when changing defaults.

4. **Universal settings ignore capabilities entirely.** `capabilityId IS NULL` means
   "always visible, always resolves to its own value." Use this only for settings that
   genuinely apply regardless of features (branding, default-assignee strategy, digest
   timing).

5. **`status='deprecated'` is a tombstone, not a filter shortcut.** The resolver filters
   on `status='active'`. Setting a capability or setting definition to deprecated hides
   it from the resolver immediately, but `organization_*` rows persist. Cleanup is a
   separate operation.

6. **Profile keys must exist in L1 or the seed fails.** The capability seed validates
   the canonical set is a superset of `ALL_PROFILE_CAPABILITY_KEYS`. Adding a key to
   `PROFILES` without adding the corresponding capability row breaks the seed.

---

## 7. Key files

- Resolver + seed helpers — [packages/database/drizzle/queries/config.ts](../packages/database/drizzle/queries/config.ts)
- Schema — [packages/database/drizzle/schema/postgres.ts](../packages/database/drizzle/schema/postgres.ts)
- Capability seed — [tooling/scripts/src/seed-capabilities.ts](../tooling/scripts/src/seed-capabilities.ts)
- Setting seed — [tooling/scripts/src/seed-settings.ts](../tooling/scripts/src/seed-settings.ts)
- Architecture context — [ARCHITECTURE.md §2, §4 ADR-001/002/005, §6](ARCHITECTURE.md)
- Build plan context — [BUILD_PLAN.md Phase 2](BUILD_PLAN.md)
