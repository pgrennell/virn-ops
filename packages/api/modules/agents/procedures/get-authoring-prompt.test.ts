// get-authoring-prompt.test.ts
//
// Procedure-level tests for agents.getAuthoringPrompt (Phase 12 follow-up).
// Verifies:
//   - Cross-org access refuses with NOT_FOUND (same uniform response the
//     rest of the org-scoped read surface uses)
//   - Missing/unknown ids refuse with NOT_FOUND
//   - Happy path returns the row trimmed to the response shape (no
//     responseJson leak)

import { call } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@virn/auth", () => ({
	auth: { api: { getSession: vi.fn() } },
}));

vi.mock("@virn/database", () => ({
	getOrganizationMembership: vi.fn(),
	getAuthoringPromptForOrg: vi.fn(),
}));

import { auth } from "@virn/auth";
import { getAuthoringPromptForOrg, getOrganizationMembership } from "@virn/database";

import { getAuthoringPromptProc } from "./get-authoring-prompt";

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

function makeMembership(role: "owner" | "admin" | "member" = "member") {
	return {
		organization: { id: "org-1", name: "Org", slug: "org" },
		role,
	};
}

const FROZEN_DATE = new Date("2026-05-29T15:00:00Z");

function makeRow() {
	return {
		id: "ap_1",
		organizationId: "org-1",
		userId: "user-1",
		prompt: "build a turnover checklist",
		sourceText: null,
		responseJson: { sections: [], steps: [], fields: [] },
		entitySchemaSnapshot: { listing: { fields: [] } },
		model: "claude-sonnet-4-6",
		createdAt: FROZEN_DATE,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("agents.getAuthoringPrompt -- auth + cross-org isolation", () => {
	it("refuses unauthenticated calls with UNAUTHORIZED", async () => {
		vi.mocked(auth.api.getSession).mockResolvedValue(null);
		await expect(
			call(getAuthoringPromptProc, { promptId: "ap_1" }, ctx),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });
		expect(getAuthoringPromptForOrg).not.toHaveBeenCalled();
	});

	it("refuses cross-org ids with NOT_FOUND (uniform with not-exists)", async () => {
		vi.mocked(auth.api.getSession).mockResolvedValue(makeSession() as never);
		vi.mocked(getOrganizationMembership).mockResolvedValue(makeMembership() as never);
		// Cross-org: getAuthoringPromptForOrg already filters by orgId so a row
		// in another org returns null. The procedure converts that to NOT_FOUND.
		vi.mocked(getAuthoringPromptForOrg).mockResolvedValue(null);
		await expect(
			call(getAuthoringPromptProc, { promptId: "ap_in_other_org" }, ctx),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("refuses unknown ids with NOT_FOUND", async () => {
		vi.mocked(auth.api.getSession).mockResolvedValue(makeSession() as never);
		vi.mocked(getOrganizationMembership).mockResolvedValue(makeMembership() as never);
		vi.mocked(getAuthoringPromptForOrg).mockResolvedValue(null);
		await expect(
			call(getAuthoringPromptProc, { promptId: "ap_does_not_exist" }, ctx),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

describe("agents.getAuthoringPrompt -- response shape", () => {
	it("returns the trimmed row (no responseJson) when owned by the caller's org", async () => {
		vi.mocked(auth.api.getSession).mockResolvedValue(makeSession() as never);
		vi.mocked(getOrganizationMembership).mockResolvedValue(makeMembership() as never);
		vi.mocked(getAuthoringPromptForOrg).mockResolvedValue(makeRow() as never);

		const result = await call(
			getAuthoringPromptProc,
			{ promptId: "ap_1" },
			ctx,
		);

		expect(result).toEqual({
			id: "ap_1",
			prompt: "build a turnover checklist",
			sourceText: null,
			entitySchemaSnapshot: { listing: { fields: [] } },
			model: "claude-sonnet-4-6",
			createdAt: FROZEN_DATE,
		});
		// responseJson is intentionally stripped -- the canvas renders the
		// structured response, the dialog doesn't need the raw JSON. Pinning
		// the absence here so a future careless edit can't regress this.
		expect((result as Record<string, unknown>).responseJson).toBeUndefined();
	});

	it("forwards the org id to the query helper (cross-org isolation depends on it)", async () => {
		vi.mocked(auth.api.getSession).mockResolvedValue(makeSession() as never);
		vi.mocked(getOrganizationMembership).mockResolvedValue(makeMembership() as never);
		vi.mocked(getAuthoringPromptForOrg).mockResolvedValue(makeRow() as never);

		await call(getAuthoringPromptProc, { promptId: "ap_1" }, ctx);

		expect(getAuthoringPromptForOrg).toHaveBeenCalledWith("org-1", "ap_1");
	});
});
