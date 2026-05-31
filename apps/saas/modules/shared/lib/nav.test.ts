// saas shared lib hardening -- nav.ts is the access-control single source of truth
// (UX_SPEC section 3): every nav area's role allow-list + capability gate lives here,
// read by the sidebar, route guards, and server-side gating. This pins mapBetterAuthRole,
// the admin-superset set, the NAV_AREA_DEFINITIONS completeness + the reader-grade vs
// author-grade split (D-042), the admin-only areas, the capability gates, and
// NAV_GROUPS integrity. Pure data + one mapping fn -> no mocks.

import { describe, expect, it } from "vitest";

import {
	ADMIN_SUPERSET_ROLES,
	CAPABILITIES,
	mapBetterAuthRole,
	NAV_AREA_DEFINITIONS,
	NAV_AREAS,
	NAV_GROUPS,
	ROLES,
	type RoleId,
} from "./nav";

describe("mapBetterAuthRole", () => {
	it("maps owner -> owner and admin -> admin", () => {
		expect(mapBetterAuthRole("owner")).toBe(ROLES.owner);
		expect(mapBetterAuthRole("admin")).toBe(ROLES.admin);
	});

	it("maps a plain member -> operator (ADR-004 custom roles not shipped yet)", () => {
		expect(mapBetterAuthRole("member")).toBe(ROLES.operator);
	});

	it("falls back to operator for null / undefined", () => {
		expect(mapBetterAuthRole(null)).toBe(ROLES.operator);
		expect(mapBetterAuthRole(undefined)).toBe(ROLES.operator);
	});
});

describe("ADMIN_SUPERSET_ROLES", () => {
	it("is exactly owner + admin", () => {
		expect([...ADMIN_SUPERSET_ROLES].sort()).toEqual([ROLES.admin, ROLES.owner].sort());
	});
});

describe("NAV_AREA_DEFINITIONS -- completeness + invariants", () => {
	const allAreas = Object.values(NAV_AREAS);
	const validRoles = new Set<string>(Object.values(ROLES));

	it("defines exactly one entry per NavArea, with the area key matching", () => {
		for (const area of allAreas) {
			const def = NAV_AREA_DEFINITIONS[area];
			expect(def).toBeDefined();
			expect(def.area).toBe(area);
		}
		// no extra definitions beyond the declared areas
		expect(Object.keys(NAV_AREA_DEFINITIONS).sort()).toEqual([...allAreas].sort());
	});

	it("every area has a non-empty allowedRoles of valid RoleIds, and admin+owner are always included", () => {
		for (const area of allAreas) {
			const def = NAV_AREA_DEFINITIONS[area];
			expect(def.allowedRoles.length).toBeGreaterThan(0);
			for (const r of def.allowedRoles) expect(validRoles.has(r)).toBe(true);
			expect(def.allowedRoles).toContain(ROLES.admin);
			expect(def.allowedRoles).toContain(ROLES.owner);
		}
	});
});

describe("NAV_AREA_DEFINITIONS -- reader-grade vs author-grade split (D-042)", () => {
	it("sop (reader-grade) admits operator AND reviewer", () => {
		const roles = NAV_AREA_DEFINITIONS[NAV_AREAS.sop].allowedRoles;
		expect(roles).toContain(ROLES.operator);
		expect(roles).toContain(ROLES.reviewer);
	});

	it.each([NAV_AREAS.library, NAV_AREAS.templates, NAV_AREAS.playbooks, NAV_AREAS.automations])(
		"%s (author-grade) EXCLUDES operator",
		(area) => {
			expect(NAV_AREA_DEFINITIONS[area].allowedRoles).not.toContain(ROLES.operator);
		},
	);
});

describe("NAV_AREA_DEFINITIONS -- admin-only areas", () => {
	const adminOnly = [
		NAV_AREAS.configuration,
		NAV_AREAS.membersAndRoles,
		NAV_AREAS.agents,
		NAV_AREAS.vendors,
		NAV_AREAS.dataSets,
		NAV_AREAS.branding,
		NAV_AREAS.integrations,
		NAV_AREAS.billing,
		NAV_AREAS.orgGeneral,
	];

	it.each(adminOnly)("%s is restricted to exactly admin + owner", (area) => {
		const roles = [...NAV_AREA_DEFINITIONS[area].allowedRoles].sort();
		expect(roles).toEqual([ROLES.admin, ROLES.owner].sort() as RoleId[]);
	});
});

describe("NAV_AREA_DEFINITIONS -- capability gates", () => {
	it("gates the three capability-bound areas on the correct capability key", () => {
		expect(NAV_AREA_DEFINITIONS[NAV_AREAS.automations].capability).toBe(CAPABILITIES.automationRules);
		expect(NAV_AREA_DEFINITIONS[NAV_AREAS.compliance].capability).toBe(CAPABILITIES.compliancePack);
		expect(NAV_AREA_DEFINITIONS[NAV_AREAS.integrations].capability).toBe(CAPABILITIES.integrationsWebhooks);
	});

	it("leaves un-gated areas without a capability (always capability-enabled)", () => {
		for (const area of [NAV_AREAS.library, NAV_AREAS.sop, NAV_AREAS.home, NAV_AREAS.agents, NAV_AREAS.billing]) {
			expect(NAV_AREA_DEFINITIONS[area].capability).toBeUndefined();
		}
	});
});

describe("NAV_GROUPS -- integrity", () => {
	it("every rendered nav item references an area that has a definition (no orphan items)", () => {
		for (const group of NAV_GROUPS) {
			for (const item of group.items) {
				expect(NAV_AREA_DEFINITIONS[item.area]).toBeDefined();
			}
		}
	});
});
