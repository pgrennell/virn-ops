// saas shared lib hardening -- gating.ts is the UX_SPEC §2 gating spine:
//   visible = capabilityEnabled(org) AND permitted(user)
// Admin/Owner is a permission-axis superset BUT still respects the capability axis
// (a feature off for the whole org is off for everyone). Pure logic over the real
// NAV_AREA_DEFINITIONS from nav.ts. (Distinct from builder/lib/capability-gates.ts,
// which gates the Builder palette.)

import { describe, expect, it } from "vitest";

import { buildGatingSnapshot, canSee, isEnabled } from "./gating";
import { CAPABILITIES, NAV_AREAS, ROLES } from "./nav";

describe("buildGatingSnapshot", () => {
	it("marks owner + admin as the admin superset", () => {
		expect(buildGatingSnapshot(ROLES.owner, []).isAdminSuperset).toBe(true);
		expect(buildGatingSnapshot(ROLES.admin, []).isAdminSuperset).toBe(true);
	});

	it("marks builder/operator/reviewer as NOT the admin superset", () => {
		for (const role of [ROLES.builder, ROLES.operator, ROLES.reviewer] as const) {
			expect(buildGatingSnapshot(role, []).isAdminSuperset).toBe(false);
		}
	});

	it("captures the enabled capability keys as a set", () => {
		const snap = buildGatingSnapshot(ROLES.admin, [CAPABILITIES.compliancePack, CAPABILITIES.automationRules]);
		expect(snap.enabledCapabilities.has(CAPABILITIES.compliancePack)).toBe(true);
		expect(snap.enabledCapabilities.has(CAPABILITIES.automationRules)).toBe(true);
		expect(snap.enabledCapabilities.has(CAPABILITIES.integrationsWebhooks)).toBe(false);
	});
});

describe("isEnabled -- capability axis only", () => {
	it("is true iff the capability is in the snapshot set", () => {
		const snap = buildGatingSnapshot(ROLES.operator, [CAPABILITIES.governanceApprovals]);
		expect(isEnabled(CAPABILITIES.governanceApprovals, snap)).toBe(true);
		expect(isEnabled(CAPABILITIES.compliancePack, snap)).toBe(false);
	});
});

describe("canSee -- permission axis (no capability gate)", () => {
	it("library (author-grade) is visible to builder/admin/owner but NOT operator", () => {
		const caps: string[] = [];
		expect(canSee(NAV_AREAS.library, buildGatingSnapshot(ROLES.builder, caps))).toBe(true);
		expect(canSee(NAV_AREAS.library, buildGatingSnapshot(ROLES.admin, caps))).toBe(true);
		expect(canSee(NAV_AREAS.library, buildGatingSnapshot(ROLES.operator, caps))).toBe(false);
	});

	it("sop (reader-grade) is visible to an operator (everyone with org membership)", () => {
		expect(canSee(NAV_AREAS.sop, buildGatingSnapshot(ROLES.operator, []))).toBe(true);
	});

	it("agents (privileged admin area) is NOT visible to a builder", () => {
		expect(canSee(NAV_AREAS.agents, buildGatingSnapshot(ROLES.builder, []))).toBe(false);
		expect(canSee(NAV_AREAS.agents, buildGatingSnapshot(ROLES.admin, []))).toBe(true);
	});
});

describe("canSee -- BOTH axes (capability AND permission)", () => {
	it("compliance: reviewer sees it only when the compliance.pack capability is ON", () => {
		expect(canSee(NAV_AREAS.compliance, buildGatingSnapshot(ROLES.reviewer, [CAPABILITIES.compliancePack]))).toBe(true);
		expect(canSee(NAV_AREAS.compliance, buildGatingSnapshot(ROLES.reviewer, []))).toBe(false);
	});

	it("KEY INVARIANT: admin superset STILL respects the capability axis (off-for-org = off-for-everyone)", () => {
		// admin is in compliance's allowedRoles AND is the superset, but the capability is OFF -> hidden.
		expect(canSee(NAV_AREAS.compliance, buildGatingSnapshot(ROLES.admin, []))).toBe(false);
		// flip the capability on -> visible.
		expect(canSee(NAV_AREAS.compliance, buildGatingSnapshot(ROLES.admin, [CAPABILITIES.compliancePack]))).toBe(true);
	});

	it("compliance: an operator with the capability ON is STILL blocked (permission axis)", () => {
		expect(canSee(NAV_AREAS.compliance, buildGatingSnapshot(ROLES.operator, [CAPABILITIES.compliancePack]))).toBe(false);
	});

	it("integrations: admin sees it only when integrations.webhooks is ON", () => {
		expect(canSee(NAV_AREAS.integrations, buildGatingSnapshot(ROLES.admin, [CAPABILITIES.integrationsWebhooks]))).toBe(true);
		expect(canSee(NAV_AREAS.integrations, buildGatingSnapshot(ROLES.admin, []))).toBe(false);
	});
});
