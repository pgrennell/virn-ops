// Coverage hardening -- procedure-level auth gate for the config surface (the
// capability + settings registry). This is a security boundary: capability
// overrides gate features org-wide, so the five mutating procedures
// (setCapabilityEnabled / clearCapability / setSetting / clearSetting /
// applyProfile) are adminOrgProcedure -- a plain member must be FORBIDDEN. The two
// read procedures (listCapabilities / listSettings) are protectedOrgProcedure --
// any member may read the effective config. Unauthenticated -> UNAUTHORIZED
// everywhere. Mirrors suggestions-authz.test.ts.

import { call } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@virn/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));

vi.mock("@virn/database", () => ({
	getOrganizationMembership: vi.fn(),
	getEffectiveCapabilities: vi.fn(),
	setOrganizationCapabilityOverride: vi.fn(),
	clearOrganizationCapabilityOverride: vi.fn(),
	getEffectiveSettings: vi.fn(),
	setOrganizationSettingOverride: vi.fn(),
	clearOrganizationSettingOverride: vi.fn(),
	applyEnablementProfile: vi.fn(),
}));

import { auth } from "@virn/auth";
import {
	getEffectiveCapabilities,
	getEffectiveSettings,
	getOrganizationMembership,
} from "@virn/database";

import { applyProfile } from "./apply-profile";
import { clearCapability } from "./clear-capability";
import { clearSetting } from "./clear-setting";
import { listCapabilities } from "./list-capabilities";
import { listSettings } from "./list-settings";
import { setCapabilityEnabled } from "./set-capability-enabled";
import { setSetting } from "./set-setting";

const ctx = { context: { headers: new Headers() } };

function makeSession() {
	return {
		session: {
			id: "session-1",
			userId: "user-1",
			token: "tok",
			expiresAt: new Date(),
			activeOrganizationId: "org-1",
		},
		user: { id: "user-1", email: "u@example.com", name: "U", emailVerified: true },
	};
}

function makeMembership(role: "owner" | "admin" | "member" = "admin") {
	return { organization: { id: "org-1", name: "Org", slug: "org" }, role };
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(auth.api.getSession).mockResolvedValue(makeSession() as never);
	vi.mocked(getOrganizationMembership).mockResolvedValue(makeMembership() as never);
});

describe("config procedures -- admin-only mutations (capability/settings boundary)", () => {
	const adminProcs = [
		{ name: "setCapabilityEnabled", run: () => call(setCapabilityEnabled, { capabilityKey: "governance.approvals", enabled: true }, ctx) },
		{ name: "clearCapability", run: () => call(clearCapability, { capabilityKey: "governance.approvals" }, ctx) },
		{ name: "setSetting", run: () => call(setSetting, { settingKey: "some.key", value: true }, ctx) },
		{ name: "clearSetting", run: () => call(clearSetting, { settingKey: "some.key" }, ctx) },
		{ name: "applyProfile", run: () => call(applyProfile, { profile: "checklist" as const }, ctx) },
	];

	for (const p of adminProcs) {
		it(`${p.name} throws FORBIDDEN for a plain member`, async () => {
			vi.mocked(getOrganizationMembership).mockResolvedValueOnce(makeMembership("member") as never);
			await expect(p.run()).rejects.toMatchObject({ code: "FORBIDDEN" });
		});

		it(`${p.name} throws UNAUTHORIZED with no session`, async () => {
			vi.mocked(auth.api.getSession).mockResolvedValueOnce(null);
			await expect(p.run()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
		});
	}
});

describe("config procedures -- member-readable effective config", () => {
	it("listCapabilities is allowed for a plain member", async () => {
		vi.mocked(getOrganizationMembership).mockResolvedValueOnce(makeMembership("member") as never);
		vi.mocked(getEffectiveCapabilities).mockResolvedValueOnce([] as never);
		await expect(call(listCapabilities, {}, ctx)).resolves.toEqual([]);
	});

	it("listSettings is allowed for a plain member", async () => {
		vi.mocked(getOrganizationMembership).mockResolvedValueOnce(makeMembership("member") as never);
		vi.mocked(getEffectiveSettings).mockResolvedValueOnce([] as never);
		await expect(call(listSettings, {}, ctx)).resolves.toEqual([]);
	});

	it("listCapabilities throws UNAUTHORIZED with no session", async () => {
		vi.mocked(auth.api.getSession).mockResolvedValueOnce(null);
		await expect(call(listCapabilities, {}, ctx)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
	});

	it("listSettings throws UNAUTHORIZED with no session", async () => {
		vi.mocked(auth.api.getSession).mockResolvedValueOnce(null);
		await expect(call(listSettings, {}, ctx)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
	});
});
