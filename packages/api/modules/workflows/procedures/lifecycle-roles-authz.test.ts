// Workflows procedure hardening (W3) -- auth gate on workflow lifecycle + role
// management. create-workflow, archive-workflow, and the three role mutations are
// adminOrgProcedure; list-workflow-roles is protectedOrgProcedure (member-readable).
// (update-workflow is already covered by workflow-scope.test.ts -- skipped here.)
// Mirrors structure-authz.test.ts.

import { call } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@virn/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));

vi.mock("@virn/database", () => ({
	getOrganizationMembership: vi.fn(),
	listWorkflowRolesForOrg: vi.fn(),
}));

vi.mock("../lib/workflow", () => ({ createWorkflow: vi.fn(), archiveWorkflowOp: vi.fn() }));

vi.mock("../lib/roles", () => ({
	createWorkflowRole: vi.fn(),
	updateWorkflowRoleOp: vi.fn(),
	deleteWorkflowRoleOp: vi.fn(),
}));

import { auth } from "@virn/auth";
import { getOrganizationMembership, listWorkflowRolesForOrg } from "@virn/database";

import { WorkflowEngineError } from "../lib/errors";
import { deleteWorkflowRoleOp } from "../lib/roles";
import { archiveWorkflowOp } from "../lib/workflow";
import { archiveWorkflowProc } from "./archive-workflow";
import { createWorkflowProc } from "./create-workflow";
import { createWorkflowRoleProc } from "./create-workflow-role";
import { deleteWorkflowRoleProc } from "./delete-workflow-role";
import { listWorkflowRolesProc } from "./list-workflow-roles";
import { updateWorkflowRoleProc } from "./update-workflow-role";

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

const adminProcs = [
	{ name: "createWorkflow", run: () => call(createWorkflowProc, { title: "WF" }, ctx) },
	{ name: "archiveWorkflow", run: () => call(archiveWorkflowProc, { workflowId: "wf_1" }, ctx) },
	{ name: "createWorkflowRole", run: () => call(createWorkflowRoleProc, { name: "Inspector" }, ctx) },
	{ name: "updateWorkflowRole", run: () => call(updateWorkflowRoleProc, { roleId: "role_1" }, ctx) },
	{ name: "deleteWorkflowRole", run: () => call(deleteWorkflowRoleProc, { roleId: "role_1" }, ctx) },
];

describe("workflows lifecycle + roles -- admin-only mutations", () => {
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

describe("workflows.listWorkflowRoles -- member-readable", () => {
	it("is allowed for a plain member + forwards the org id", async () => {
		vi.mocked(getOrganizationMembership).mockResolvedValueOnce(makeMembership("member") as never);
		vi.mocked(listWorkflowRolesForOrg).mockResolvedValueOnce([] as never);
		await expect(call(listWorkflowRolesProc, {}, ctx)).resolves.toEqual([]);
		expect(listWorkflowRolesForOrg).toHaveBeenCalledWith("org-1");
	});

	it("throws UNAUTHORIZED with no session", async () => {
		vi.mocked(auth.api.getSession).mockResolvedValueOnce(null);
		await expect(call(listWorkflowRolesProc, {}, ctx)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
	});
});

describe("workflows lifecycle + roles -- representative refusals", () => {
	it("archiveWorkflow maps WORKFLOW_NOT_FOUND -> NOT_FOUND", async () => {
		vi.mocked(archiveWorkflowOp).mockRejectedValueOnce(
			new WorkflowEngineError("WORKFLOW_NOT_FOUND", "gone"),
		);
		await expect(
			call(archiveWorkflowProc, { workflowId: "missing" }, ctx),
		).rejects.toMatchObject({ code: "NOT_FOUND", data: { code: "WORKFLOW_NOT_FOUND" } });
	});

	it("deleteWorkflowRole maps WORKFLOW_ROLE_NOT_FOUND -> NOT_FOUND", async () => {
		vi.mocked(deleteWorkflowRoleOp).mockRejectedValueOnce(
			new WorkflowEngineError("WORKFLOW_ROLE_NOT_FOUND", "gone"),
		);
		await expect(
			call(deleteWorkflowRoleProc, { roleId: "missing" }, ctx),
		).rejects.toMatchObject({ code: "NOT_FOUND", data: { code: "WORKFLOW_ROLE_NOT_FOUND" } });
	});
});
