// Workflows procedure hardening (W4) -- auth gate on the publish/draft lifecycle.
// review-state.test.ts ALREADY covers submit-for-review, approve-review,
// send-back-to-draft, and list-for-review (the Phase 9.5g review-state machine), so
// this file only adds the three genuinely-uncovered versioning procedures:
// publish-version, discard-draft, edit-published -- all adminOrgProcedure delegating
// to ../lib/publish via workflowEngineCall. Mirrors structure-authz.test.ts.

import { call } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@virn/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));

vi.mock("@virn/database", () => ({ getOrganizationMembership: vi.fn() }));

vi.mock("../lib/publish", () => ({
	publishVersion: vi.fn(),
	discardDraft: vi.fn(),
	editPublished: vi.fn(),
}));

import { auth } from "@virn/auth";
import { getOrganizationMembership } from "@virn/database";

import { WorkflowEngineError } from "../lib/errors";
import { discardDraft, publishVersion } from "../lib/publish";
import { discardDraftProc } from "./discard-draft";
import { editPublishedProc } from "./edit-published";
import { publishVersionProc } from "./publish-version";

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
	{ name: "publishVersion", run: () => call(publishVersionProc, { versionId: "ver_1" }, ctx) },
	{ name: "discardDraft", run: () => call(discardDraftProc, { versionId: "ver_1" }, ctx) },
	{ name: "editPublished", run: () => call(editPublishedProc, { workflowId: "wf_1" }, ctx) },
];

describe("workflows versioning lifecycle -- admin-only mutations", () => {
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

describe("workflows versioning lifecycle -- representative refusals", () => {
	it("publishVersion maps APPROVAL_REQUIRED -> FORBIDDEN (governance publish gate)", async () => {
		vi.mocked(publishVersion).mockRejectedValueOnce(
			new WorkflowEngineError("APPROVAL_REQUIRED", "needs an approved review first"),
		);
		await expect(
			call(publishVersionProc, { versionId: "ver_1" }, ctx),
		).rejects.toMatchObject({ code: "FORBIDDEN", data: { code: "APPROVAL_REQUIRED" } });
	});

	it("discardDraft maps VERSION_NOT_DRAFT -> BAD_REQUEST", async () => {
		vi.mocked(discardDraft).mockRejectedValueOnce(
			new WorkflowEngineError("VERSION_NOT_DRAFT", "not a draft"),
		);
		await expect(
			call(discardDraftProc, { versionId: "ver_1" }, ctx),
		).rejects.toMatchObject({ code: "BAD_REQUEST", data: { code: "VERSION_NOT_DRAFT" } });
	});

	it("publishVersion returns the lib result on the happy path (admin)", async () => {
		vi.mocked(publishVersion).mockResolvedValueOnce({ versionId: "ver_1", versionNumber: 2 } as never);
		await expect(
			call(publishVersionProc, { versionId: "ver_1" }, ctx),
		).resolves.toMatchObject({ versionNumber: 2 });
	});
});
