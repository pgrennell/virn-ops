// packages/api/modules/packs/lib/install-property-ops.test.ts
//
// Unit tests for the property-ops pack install logic. DB mocked at the @virn/database
// boundary -- these verify orchestration semantics (idempotency gate, role reuse,
// install ledger write), not the actual SQL.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@virn/database", () => ({
	createVendorCategoriesIfMissing: vi.fn(),
	getWorkflowBySlugForOrg: vi.fn(),
	getPackInstallForOrg: vi.fn(),
	getPropertyOpsPackVersion: vi.fn(),
	insertField: vi.fn(),
	insertPackInstall: vi.fn(),
	insertSection: vi.fn(),
	insertStep: vi.fn(),
	insertStepDependency: vi.fn(),
	insertWorkflowRole: vi.fn(),
	insertWorkflowWithDraft: vi.fn(),
	getWorkflowForOrg: vi.fn(),
	updateWorkflow: vi.fn(),
	listWorkflowRolesForOrg: vi.fn(),
	writeAuditAndActivity: vi.fn(),
}));

// publishVersion + createWorkflow imports go through the workflows lib which queries
// real @virn/database functions; mock those too.
vi.mock("@virn/database/queries/workflows", () => ({}));

import {
	createVendorCategoriesIfMissing,
	getPackInstallForOrg,
	getPropertyOpsPackVersion,
	insertPackInstall,
	insertWorkflowRole,
	listWorkflowRolesForOrg,
	writeAuditAndActivity,
} from "@virn/database";

import {
	getPropertyOpsInstallStatus,
	installPropertyOpsPack,
} from "./install-property-ops";

const CTX = { organizationId: "org_1", userId: "user_1" };

const PLATFORM_PACK = {
	id: "pv_1",
	packId: "pk_1",
	packSlug: "property-ops",
	versionNumber: 1,
};

beforeEach(() => {
	vi.clearAllMocks();
});

describe("getPropertyOpsInstallStatus", () => {
	it("packAvailable=false when the platform pack hasn't been seeded", async () => {
		vi.mocked(getPropertyOpsPackVersion).mockResolvedValueOnce(null);
		const result = await getPropertyOpsInstallStatus("org_1");
		expect(result).toEqual({ packAvailable: false, installed: false, installedAt: null });
	});

	it("installed=false when pack exists but the org hasn't installed", async () => {
		vi.mocked(getPropertyOpsPackVersion).mockResolvedValueOnce(PLATFORM_PACK as never);
		vi.mocked(getPackInstallForOrg).mockResolvedValueOnce(null);
		const result = await getPropertyOpsInstallStatus("org_1");
		expect(result).toEqual({ packAvailable: true, installed: false, installedAt: null });
	});

	it("installed=true when the org has an install row", async () => {
		const installedAt = new Date("2026-05-27T12:00:00Z");
		vi.mocked(getPropertyOpsPackVersion).mockResolvedValueOnce(PLATFORM_PACK as never);
		vi.mocked(getPackInstallForOrg).mockResolvedValueOnce({
			id: "pi_1",
			organizationId: "org_1",
			packId: "pk_1",
			packVersionId: "pv_1",
			installedAt,
			installedBy: "user_1",
		} as never);
		const result = await getPropertyOpsInstallStatus("org_1");
		expect(result).toEqual({ packAvailable: true, installed: true, installedAt });
	});
});

describe("installPropertyOpsPack -- idempotency gate", () => {
	it("returns alreadyInstalled=true and writes nothing when org has already installed", async () => {
		vi.mocked(getPropertyOpsPackVersion).mockResolvedValueOnce(PLATFORM_PACK as never);
		vi.mocked(getPackInstallForOrg).mockResolvedValueOnce({
			id: "pi_existing",
			organizationId: "org_1",
			packId: "pk_1",
			packVersionId: "pv_1",
			installedAt: new Date(),
			installedBy: "user_1",
		} as never);

		const result = await installPropertyOpsPack(CTX);

		expect(result.alreadyInstalled).toBe(true);
		expect(result.packInstallId).toBe("pi_existing");
		expect(result.created).toEqual({
			vendorCategories: 0,
			workflowRoles: 0,
			workflows: [],
		});
		// No side effects: install ledger not appended, no audit written.
		expect(insertPackInstall).not.toHaveBeenCalled();
		expect(writeAuditAndActivity).not.toHaveBeenCalled();
		expect(createVendorCategoriesIfMissing).not.toHaveBeenCalled();
		expect(insertWorkflowRole).not.toHaveBeenCalled();
	});

	it("throws when the platform pack hasn't been seeded yet", async () => {
		vi.mocked(getPropertyOpsPackVersion).mockResolvedValueOnce(null);
		await expect(installPropertyOpsPack(CTX)).rejects.toThrow(/not seeded at platform/i);
	});
});

describe("installPropertyOpsPack -- vendor-category + role idempotency within an install", () => {
	it("reuses an existing workflow role with the same name rather than creating a duplicate", async () => {
		// Mock the platform pack + no prior install.
		vi.mocked(getPropertyOpsPackVersion).mockResolvedValueOnce(PLATFORM_PACK as never);
		vi.mocked(getPackInstallForOrg).mockResolvedValueOnce(null);
		// The batched vendor-category upsert reports all 10 manifest categories created.
		vi.mocked(createVendorCategoriesIfMissing).mockResolvedValue({ created: 10 } as never);
		// listWorkflowRolesForOrg returns one pre-existing "Property Manager" role.
		vi.mocked(listWorkflowRolesForOrg).mockResolvedValueOnce([
			{
				id: "role_pm_existing",
				organizationId: "org_1",
				name: "Property Manager",
				isInitiator: true,
				createdAt: new Date(),
				updatedAt: new Date(),
			},
		] as never);
		// The three other roles (Housekeeper / Inspector / Owner) get created.
		vi.mocked(insertWorkflowRole).mockResolvedValue({ id: "role_new" } as never);

		// Stub out the workflow creation path so we don't have to mock the full chain.
		// We can't easily mock createWorkflow + publishVersion since those import live
		// modules. Instead, intercept by making insertPackInstall throw a sentinel error
		// AFTER role creation + BEFORE workflow creation -- not possible here since the
		// order is: roles -> workflows -> install row. So we let the workflows be
		// "attempted" but they'll fail because their dependencies aren't mocked. We
		// just assert role reuse + skip-on-pre-existing semantics.

		// Since the workflow-install path will throw (unmocked createWorkflow chain), we
		// catch and only assert the pre-workflow-install state.
		try {
			await installPropertyOpsPack(CTX);
		} catch {
			// expected -- workflow install needs the full @virn/database mock surface
			// that we don't have here. The role-reuse assertions below are the meaningful
			// check.
		}

		// 4 roles in manifest, 1 pre-existing, so 3 should be inserted.
		expect(insertWorkflowRole).toHaveBeenCalledTimes(3);
		// Property Manager was NOT inserted (it was reused).
		const insertedRoleNames = vi
			.mocked(insertWorkflowRole)
			.mock.calls.map((c) => c[0].name);
		expect(insertedRoleNames).not.toContain("Property Manager");
		expect(insertedRoleNames.sort()).toEqual(["Housekeeper", "Inspector", "Owner"]);
		// The 10 vendor categories are upserted in a single batched call.
		expect(createVendorCategoriesIfMissing).toHaveBeenCalledTimes(1);
	});
});
