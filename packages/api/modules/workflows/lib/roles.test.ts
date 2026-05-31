// Workflows lib hardening -- workflow-role CRUD (org-level roles). The procedure-level
// gate is covered by lifecycle-roles-authz.test.ts; this pins the LIB logic it doesn't
// see: the update no-op short-circuit (no DB write / no audit when nothing changed),
// the selective changes-diff, and the audit attribution shapes. Mocks @virn/database.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@virn/database", () => ({
	insertWorkflowRole: vi.fn(),
	updateWorkflowRole: vi.fn(),
	deleteWorkflowRole: vi.fn(),
	writeAuditAndActivity: vi.fn(),
}));

import {
	deleteWorkflowRole,
	insertWorkflowRole,
	updateWorkflowRole,
	writeAuditAndActivity,
} from "@virn/database";

import { createWorkflowRole, deleteWorkflowRoleOp, updateWorkflowRoleOp } from "./roles";

const ctx = { organizationId: "org-1", userId: "user-1" };

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(writeAuditAndActivity).mockResolvedValue(undefined);
});

describe("createWorkflowRole", () => {
	it("inserts the role + audits workflow_role.created (isInitiator defaults to false in the audit)", async () => {
		vi.mocked(insertWorkflowRole).mockResolvedValueOnce({ id: "role_1" } as never);

		const res = await createWorkflowRole(ctx, { name: "Inspector" });

		expect(res).toEqual({ id: "role_1" });
		expect(insertWorkflowRole).toHaveBeenCalledWith({
			organizationId: "org-1",
			name: "Inspector",
			isInitiator: undefined,
		});
		expect(writeAuditAndActivity).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "workflow_role.created",
				entityType: "role",
				entityId: "role_1",
				changes: { name: "Inspector", isInitiator: false },
			}),
		);
	});

	it("threads isInitiator=true into the insert + audit", async () => {
		vi.mocked(insertWorkflowRole).mockResolvedValueOnce({ id: "role_2" } as never);
		await createWorkflowRole(ctx, { name: "Initiator", isInitiator: true });
		expect(insertWorkflowRole).toHaveBeenCalledWith(expect.objectContaining({ isInitiator: true }));
		expect(writeAuditAndActivity).toHaveBeenCalledWith(
			expect.objectContaining({ changes: { name: "Initiator", isInitiator: true } }),
		);
	});
});

describe("updateWorkflowRoleOp", () => {
	it("is a NO-OP when no fields are provided (no DB write, no audit)", async () => {
		await updateWorkflowRoleOp(ctx, { roleId: "role_1" });
		expect(updateWorkflowRole).not.toHaveBeenCalled();
		expect(writeAuditAndActivity).not.toHaveBeenCalled();
	});

	it("updates + audits only the name when only name is provided", async () => {
		vi.mocked(updateWorkflowRole).mockResolvedValueOnce(undefined as never);
		await updateWorkflowRoleOp(ctx, { roleId: "role_1", name: "Renamed" });
		expect(updateWorkflowRole).toHaveBeenCalledWith(
			expect.objectContaining({ organizationId: "org-1", roleId: "role_1", name: "Renamed" }),
		);
		expect(writeAuditAndActivity).toHaveBeenCalledWith(
			expect.objectContaining({ action: "workflow_role.updated", changes: { name: "Renamed" } }),
		);
	});

	it("includes only isInitiator in the changes diff when only isInitiator is provided", async () => {
		vi.mocked(updateWorkflowRole).mockResolvedValueOnce(undefined as never);
		await updateWorkflowRoleOp(ctx, { roleId: "role_1", isInitiator: false });
		expect(writeAuditAndActivity).toHaveBeenCalledWith(
			expect.objectContaining({ changes: { isInitiator: false } }),
		);
	});

	it("includes both fields when both are provided", async () => {
		vi.mocked(updateWorkflowRole).mockResolvedValueOnce(undefined as never);
		await updateWorkflowRoleOp(ctx, { roleId: "role_1", name: "X", isInitiator: true });
		expect(writeAuditAndActivity).toHaveBeenCalledWith(
			expect.objectContaining({ changes: { name: "X", isInitiator: true } }),
		);
	});
});

describe("deleteWorkflowRoleOp", () => {
	it("deletes the role + audits workflow_role.deleted (no refusal -- org cleanup)", async () => {
		vi.mocked(deleteWorkflowRole).mockResolvedValueOnce(undefined as never);
		await deleteWorkflowRoleOp(ctx, { roleId: "role_1" });
		expect(deleteWorkflowRole).toHaveBeenCalledWith({ organizationId: "org-1", roleId: "role_1" });
		expect(writeAuditAndActivity).toHaveBeenCalledWith(
			expect.objectContaining({ action: "workflow_role.deleted", entityId: "role_1" }),
		);
	});
});
