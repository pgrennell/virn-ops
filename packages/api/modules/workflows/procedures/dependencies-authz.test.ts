// Workflows procedure hardening (W2) -- auth gate on step-dependency + reorder
// mutations. add-step-dependency, remove-step-dependency, reorder-steps are all
// adminOrgProcedure delegating to ../lib/structure via workflowEngineCall.
// Mirrors structure-authz.test.ts.

import { call } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@virn/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));

vi.mock("@virn/database", () => ({ getOrganizationMembership: vi.fn() }));

vi.mock("../lib/structure", () => ({
	addStepDependency: vi.fn(),
	removeStepDependency: vi.fn(),
	reorderStepsOp: vi.fn(),
}));

import { auth } from "@virn/auth";
import { getOrganizationMembership } from "@virn/database";

import { WorkflowEngineError } from "../lib/errors";
import { addStepDependency, reorderStepsOp } from "../lib/structure";
import { addStepDependencyProc } from "./add-step-dependency";
import { removeStepDependencyProc } from "./remove-step-dependency";
import { reorderStepsProc } from "./reorder-steps";

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
	{ name: "addStepDependency", run: () => call(addStepDependencyProc, { stepId: "s1", dependsOnStepId: "s2" }, ctx) },
	{ name: "removeStepDependency", run: () => call(removeStepDependencyProc, { stepId: "s1", dependsOnStepId: "s2" }, ctx) },
	{ name: "reorderSteps", run: () => call(reorderStepsProc, { workflowVersionId: "ver_1", ordering: [{ stepId: "s1", position: 0 }] }, ctx) },
];

describe("workflows step-dependency + reorder -- admin-only mutations", () => {
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

describe("workflows step-dependency + reorder -- representative refusals", () => {
	it("addStepDependency maps DEPENDENCY_SELF_REFERENCE -> BAD_REQUEST", async () => {
		vi.mocked(addStepDependency).mockRejectedValueOnce(
			new WorkflowEngineError("DEPENDENCY_SELF_REFERENCE", "a step cannot depend on itself"),
		);
		await expect(
			call(addStepDependencyProc, { stepId: "s1", dependsOnStepId: "s1" }, ctx),
		).rejects.toMatchObject({ code: "BAD_REQUEST", data: { code: "DEPENDENCY_SELF_REFERENCE" } });
	});

	it("reorderSteps maps STEP_VERSION_MISMATCH -> BAD_REQUEST", async () => {
		vi.mocked(reorderStepsOp).mockRejectedValueOnce(
			new WorkflowEngineError("STEP_VERSION_MISMATCH", "step not in this version"),
		);
		await expect(
			call(reorderStepsProc, { workflowVersionId: "ver_1", ordering: [{ stepId: "s_other", position: 0 }] }, ctx),
		).rejects.toMatchObject({ code: "BAD_REQUEST", data: { code: "STEP_VERSION_MISMATCH" } });
	});
});
