// Governance hardening -- procedure-level auth gate for the suggestions surface.
// submit is protectedOrgProcedure (any member may suggest); list + decide are
// adminOrgProcedure (the triage surface is admin-only). Unauthenticated ->
// UNAUTHORIZED everywhere. Mirrors approvals-authz.test.ts.

import { call } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@virn/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));

vi.mock("@virn/database", () => ({
	getOrganizationMembership: vi.fn(),
	// suggestion lib pulls these at module load.
	getSuggestionForOrg: vi.fn(),
	getWorkflowForOrg: vi.fn(),
	insertSuggestion: vi.fn(),
	isCapabilityEnabledForOrg: vi.fn(),
	listSuggestionsForOrg: vi.fn(),
	updateSuggestionStatus: vi.fn(),
	writeAuditAndActivity: vi.fn(),
}));

import { auth } from "@virn/auth";
import {
	getOrganizationMembership,
	getWorkflowForOrg,
	insertSuggestion,
	isCapabilityEnabledForOrg,
	writeAuditAndActivity,
} from "@virn/database";

import { decideSuggestionProc } from "./decide-suggestion";
import { listSuggestionsProc } from "./list-suggestions";
import { submitSuggestionProc } from "./submit-suggestion";

const reqCtx = { context: { headers: new Headers() } };

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

describe("suggestions procedures -- admin-only triage", () => {
	const adminProcs = [
		{ name: "decide", run: () => call(decideSuggestionProc, { suggestionId: "sug_1", status: "accepted" as const }, reqCtx) },
		{ name: "list", run: () => call(listSuggestionsProc, {}, reqCtx) },
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

describe("suggestions.submit -- member-allowed", () => {
	it("is allowed for a plain member", async () => {
		vi.mocked(getOrganizationMembership).mockResolvedValueOnce(makeMembership("member") as never);
		vi.mocked(getWorkflowForOrg).mockResolvedValueOnce({ id: "wf_1" } as never);
		vi.mocked(isCapabilityEnabledForOrg).mockResolvedValueOnce(true);
		vi.mocked(insertSuggestion).mockResolvedValueOnce({ id: "sug_1", createdAt: new Date() } as never);
		vi.mocked(writeAuditAndActivity).mockResolvedValue(undefined as never);

		const res = await call(submitSuggestionProc, { workflowId: "wf_1", body: "Add a stop-task." }, reqCtx);
		expect(res).toMatchObject({ id: "sug_1" });
	});

	it("throws UNAUTHORIZED with no session", async () => {
		vi.mocked(auth.api.getSession).mockResolvedValueOnce(null);
		await expect(
			call(submitSuggestionProc, { workflowId: "wf_1", body: "x" }, reqCtx),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });
	});
});
