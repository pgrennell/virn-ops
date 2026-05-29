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
	getWorkflowForOrg: vi.fn(),
	getLatestPublishedWorkflowVersion: vi.fn(),
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
import {
	getLatestPublishedWorkflowVersion,
	getOrganizationMembership,
	getWorkflowForOrg,
	listEntitySetsForOrg,
} from "@virn/database";

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

describe("agents.authorWorkflow -- templateHintId validation", () => {
	beforeEach(() => {
		vi.mocked(auth.api.getSession).mockResolvedValue(makeSession() as never);
		vi.mocked(getOrganizationMembership).mockResolvedValue(makeMembership() as never);
	});

	it("forwards a valid templateHintId to the lib", async () => {
		vi.mocked(getWorkflowForOrg).mockResolvedValue({ id: "wf_template" } as never);
		vi.mocked(getLatestPublishedWorkflowVersion).mockResolvedValue({
			id: "ver_template_v3",
		} as never);

		await call(
			authorWorkflowProc,
			{ prompt: "STR turnover for studios", templateHintId: "wf_template" },
			ctx,
		);

		expect(authorWorkflow).toHaveBeenCalledTimes(1);
		const libInput = vi.mocked(authorWorkflow).mock.calls[0][1];
		expect(libInput.templateHintId).toBe("wf_template");
	});

	it("rejects a cross-org / unknown templateHintId with TEMPLATE_HINT_NOT_FOUND", async () => {
		vi.mocked(getWorkflowForOrg).mockResolvedValue(null);

		await expect(
			call(
				authorWorkflowProc,
				{ prompt: "STR turnover for studios", templateHintId: "wf_other_org" },
				ctx,
			),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
			data: { code: "AI_AUTHORING_TEMPLATE_HINT_NOT_FOUND" },
		});

		expect(authorWorkflow).not.toHaveBeenCalled();
	});

	it("rejects an unpublished templateHintId with TEMPLATE_HINT_NO_PUBLISHED_VERSION", async () => {
		vi.mocked(getWorkflowForOrg).mockResolvedValue({ id: "wf_draft_only" } as never);
		vi.mocked(getLatestPublishedWorkflowVersion).mockResolvedValue(null);

		await expect(
			call(
				authorWorkflowProc,
				{ prompt: "STR turnover for studios", templateHintId: "wf_draft_only" },
				ctx,
			),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
			data: { code: "AI_AUTHORING_TEMPLATE_HINT_NO_PUBLISHED_VERSION" },
		});

		expect(authorWorkflow).not.toHaveBeenCalled();
	});

	it("does not call the template-resolution queries when templateHintId is absent", async () => {
		await call(
			authorWorkflowProc,
			{ prompt: "STR turnover for studios" },
			ctx,
		);
		expect(getWorkflowForOrg).not.toHaveBeenCalled();
		expect(getLatestPublishedWorkflowVersion).not.toHaveBeenCalled();
	});
});

describe("agents.authorWorkflow -- templateMode validation (slice C)", () => {
	beforeEach(() => {
		vi.mocked(auth.api.getSession).mockResolvedValue(makeSession() as never);
		vi.mocked(getOrganizationMembership).mockResolvedValue(makeMembership() as never);
	});

	it("rejects templateMode='adapt' without templateHintId", async () => {
		await expect(
			call(
				authorWorkflowProc,
				{
					prompt: "STR turnover for studios",
					templateMode: "adapt",
				},
				ctx,
			),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
			data: { code: "AI_AUTHORING_TEMPLATE_MODE_REQUIRES_HINT" },
		});

		expect(authorWorkflow).not.toHaveBeenCalled();
		// And the template-resolution queries should not have been hit -- the
		// mode-without-hint guard runs before the hint validation.
		expect(getWorkflowForOrg).not.toHaveBeenCalled();
	});

	it("allows templateMode='reference' without templateHintId (no-op)", async () => {
		// `reference` without a hint is benign: the lib has no template to
		// reference, so the mode signal is ignored. We accept the input rather
		// than complain because the dialog might send the default mode value
		// even when the user hasn't picked a template.
		await call(
			authorWorkflowProc,
			{
				prompt: "STR turnover for studios",
				templateMode: "reference",
			},
			ctx,
		);

		expect(authorWorkflow).toHaveBeenCalledTimes(1);
		const libInput = vi.mocked(authorWorkflow).mock.calls[0][1];
		expect(libInput.templateHintId).toBeNull();
		expect(libInput.templateMode).toBe("reference");
	});

	it("forwards templateMode='adapt' with a valid templateHintId", async () => {
		vi.mocked(getWorkflowForOrg).mockResolvedValue({ id: "wf_template" } as never);
		vi.mocked(getLatestPublishedWorkflowVersion).mockResolvedValue({
			id: "ver_template_v3",
		} as never);

		await call(
			authorWorkflowProc,
			{
				prompt: "STR turnover, skip the kitchen check",
				templateHintId: "wf_template",
				templateMode: "adapt",
			},
			ctx,
		);

		const libInput = vi.mocked(authorWorkflow).mock.calls[0][1];
		expect(libInput.templateHintId).toBe("wf_template");
		expect(libInput.templateMode).toBe("adapt");
	});
});
