// author-workflow.test.ts
//
// Procedure-level auth-gate test for agents.authorWorkflow (Phase 12.1). Verifies the
// adminOrgProcedure stack refuses non-admin / no-session / no-org calls before any
// lib code runs. Happy path is covered by ../../workflows/lib/ai-authoring/authoring.test.ts.

import { call } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@virn/auth", () => ({
	auth: { api: { getSession: vi.fn() } },
}));

vi.mock("@virn/database", () => ({
	getOrganizationMembership: vi.fn(),
	listEntitySetsForOrg: vi.fn(async () => []),
}));

// Stub the lib import to prevent the SDK module from being pulled into the test graph.
vi.mock("../../workflows/lib/ai-authoring/authoring", () => ({
	authorWorkflow: vi.fn(async () => ({
		workflowId: "wf_1",
		draftVersionId: "ver_1",
		authoringPromptId: "ap_1",
		title: "Stubbed",
		stepCount: 1,
		fieldCount: 0,
	})),
}));

import { auth } from "@virn/auth";
import { getOrganizationMembership, listEntitySetsForOrg } from "@virn/database";

import { authorWorkflow } from "../../workflows/lib/ai-authoring/authoring";
import { authorWorkflowProc } from "./author-workflow";

const ctx = { context: { headers: new Headers() } };

function makeSession(opts: { activeOrganizationId?: string | null } = {}) {
	const activeOrganizationId =
		"activeOrganizationId" in opts ? opts.activeOrganizationId : "org-1";
	return {
		session: {
			id: "session-1",
			userId: "user-1",
			token: "tok",
			expiresAt: new Date(),
			activeOrganizationId,
		},
		user: { id: "user-1", email: "u@example.com", name: "U", emailVerified: true },
	};
}

function makeMembership(role: "owner" | "admin" | "member" = "admin") {
	return {
		organization: { id: "org-1", name: "Org", slug: "org" },
		role,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("agents.authorWorkflow -- auth gate", () => {
	it("refuses unauthenticated calls with UNAUTHORIZED", async () => {
		vi.mocked(auth.api.getSession).mockResolvedValue(null);
		await expect(
			call(authorWorkflowProc, { prompt: "build me a workflow yes please" }, ctx),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });
		expect(authorWorkflow).not.toHaveBeenCalled();
	});

	it("refuses sessions without an active org with FORBIDDEN", async () => {
		vi.mocked(auth.api.getSession).mockResolvedValue(
			makeSession({ activeOrganizationId: null }) as never,
		);
		await expect(
			call(authorWorkflowProc, { prompt: "build me a workflow yes please" }, ctx),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		expect(authorWorkflow).not.toHaveBeenCalled();
	});

	it("refuses non-admin org members with FORBIDDEN", async () => {
		vi.mocked(auth.api.getSession).mockResolvedValue(makeSession() as never);
		vi.mocked(getOrganizationMembership).mockResolvedValue(
			makeMembership("member") as never,
		);
		await expect(
			call(authorWorkflowProc, { prompt: "build me a workflow yes please" }, ctx),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		expect(authorWorkflow).not.toHaveBeenCalled();
	});

	it("admins reach the lib with org + user context", async () => {
		vi.mocked(auth.api.getSession).mockResolvedValue(makeSession() as never);
		vi.mocked(getOrganizationMembership).mockResolvedValue(makeMembership() as never);

		const result = await call(
			authorWorkflowProc,
			{ prompt: "build me a workflow yes please" },
			ctx,
		);
		expect(result.workflowId).toBe("wf_1");
		expect(authorWorkflow).toHaveBeenCalledTimes(1);
		const ctxArg = vi.mocked(authorWorkflow).mock.calls[0][0];
		expect(ctxArg.organizationId).toBe("org-1");
		expect(ctxArg.userId).toBe("user-1");
		const inputArg = vi.mocked(authorWorkflow).mock.calls[0][1];
		expect(inputArg.prompt).toBe("build me a workflow yes please");
		expect(inputArg.sourceText).toBeNull();
	});

	it("forwards sourceText through to the lib", async () => {
		vi.mocked(auth.api.getSession).mockResolvedValue(makeSession() as never);
		vi.mocked(getOrganizationMembership).mockResolvedValue(makeMembership("owner") as never);
		await call(
			authorWorkflowProc,
			{ prompt: "build it pls now", sourceText: "Existing SOP content..." },
			ctx,
		);
		expect(vi.mocked(authorWorkflow).mock.calls[0][1].sourceText).toBe(
			"Existing SOP content...",
		);
	});
});

describe("agents.authorWorkflow -- input validation", () => {
	beforeEach(() => {
		vi.mocked(auth.api.getSession).mockResolvedValue(makeSession() as never);
		vi.mocked(getOrganizationMembership).mockResolvedValue(makeMembership() as never);
	});

	it("rejects prompts shorter than 8 chars", async () => {
		await expect(call(authorWorkflowProc, { prompt: "short" }, ctx)).rejects.toThrow();
		expect(authorWorkflow).not.toHaveBeenCalled();
	});

	it("rejects prompts longer than 8000 chars", async () => {
		const huge = "a".repeat(8001);
		await expect(call(authorWorkflowProc, { prompt: huge }, ctx)).rejects.toThrow();
		expect(authorWorkflow).not.toHaveBeenCalled();
	});
});

describe("agents.authorWorkflow -- entitySetHints validation", () => {
	beforeEach(() => {
		vi.mocked(auth.api.getSession).mockResolvedValue(makeSession() as never);
		vi.mocked(getOrganizationMembership).mockResolvedValue(makeMembership() as never);
	});

	it("forwards valid hints to the lib", async () => {
		vi.mocked(listEntitySetsForOrg).mockResolvedValue([
			// Cast through unknown -- the test only reads `id`; we don't need to
			// reconstruct the full EntitySetRow shape here.
			{ id: "set_str" } as unknown,
			{ id: "set_pent" } as unknown,
		] as never);

		await call(
			authorWorkflowProc,
			{ prompt: "build me a workflow yes please", entitySetHints: ["set_str"] },
			ctx,
		);

		expect(authorWorkflow).toHaveBeenCalledTimes(1);
		const libInput = vi.mocked(authorWorkflow).mock.calls[0][1];
		expect(libInput.entitySetHints).toEqual(["set_str"]);
	});

	it("rejects unknown ids with BAD_REQUEST before calling the lib", async () => {
		vi.mocked(listEntitySetsForOrg).mockResolvedValue([
			{ id: "set_str" } as unknown,
		] as never);

		await expect(
			call(
				authorWorkflowProc,
				{
					prompt: "build me a workflow yes please",
					entitySetHints: ["set_str", "set_fake", "set_other_fake"],
				},
				ctx,
			),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
			data: {
				code: "AI_AUTHORING_INVALID_ENTITY_SET_HINTS",
				unknownIds: ["set_fake", "set_other_fake"],
			},
		});

		expect(authorWorkflow).not.toHaveBeenCalled();
	});

	it("does not call listEntitySetsForOrg when hints is empty / absent", async () => {
		await call(
			authorWorkflowProc,
			{ prompt: "build me a workflow yes please" },
			ctx,
		);
		expect(listEntitySetsForOrg).not.toHaveBeenCalled();
	});
});
