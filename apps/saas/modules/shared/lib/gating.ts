// Gating helper — the spine of UX_SPEC §2.
//
//   visible = capabilityEnabled(org)  ∧  permitted(user)
//
// Admin/Owner is a superset on the permission axis but still respects the
// capability axis (a feature that's off for the whole org is off for everyone).
//
// Two entry points:
//   - canSee(area, snapshot)        — covers both axes
//   - isEnabled(capability, snapshot) — capability axis only
//
// The async server resolver that produces `GatingSnapshot` lives in
// `gating-server.ts` (kept in a separate file so this module stays client-safe).

import {
	ADMIN_SUPERSET_ROLES,
	type CapabilityKey,
	type NavArea,
	NAV_AREA_DEFINITIONS,
	type RoleId,
} from "./nav";

export interface GatingSnapshot {
	/** Set of capability keys currently enabled for the active org. */
	enabledCapabilities: ReadonlySet<string>;
	/** The viewing user's role (mapped to the preset RoleId space). */
	role: RoleId;
	/** Convenience derived from `role` — Admin/Owner bypasses the permission axis. */
	isAdminSuperset: boolean;
}

export function buildGatingSnapshot(
	role: RoleId,
	enabledCapabilityKeys: Iterable<string>,
): GatingSnapshot {
	return {
		role,
		enabledCapabilities: new Set(enabledCapabilityKeys),
		isAdminSuperset: (ADMIN_SUPERSET_ROLES as readonly RoleId[]).includes(role),
	};
}

export function isEnabled(capability: CapabilityKey, snapshot: GatingSnapshot): boolean {
	return snapshot.enabledCapabilities.has(capability);
}

function permitted(area: NavArea, snapshot: GatingSnapshot): boolean {
	const def = NAV_AREA_DEFINITIONS[area];
	if (snapshot.isAdminSuperset) return true;
	return def.allowedRoles.includes(snapshot.role);
}

function capabilityEnabled(area: NavArea, snapshot: GatingSnapshot): boolean {
	const def = NAV_AREA_DEFINITIONS[area];
	if (!def.capability) return true;
	return snapshot.enabledCapabilities.has(def.capability);
}

export function canSee(area: NavArea, snapshot: GatingSnapshot): boolean {
	return capabilityEnabled(area, snapshot) && permitted(area, snapshot);
}
