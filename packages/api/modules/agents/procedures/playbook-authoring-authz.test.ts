// Phase 18c -- authz gate tests for the Playbook AI-authoring procedures. Both are
// adminOrgProcedure (paid model tokens + content writes), so a plain member is
// FORBIDDEN and an unauthenticated caller is UNAUTHORIZED. Mirrors datasets.test.ts.

import { call } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@virn/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));

vi.mock("@virn/ai", () => ({ VIRN_AI_MODEL: "claude-test", getAnthropicClient: vi.fn() }));

vi.mock("@virn/database", () => ({
	getOrganizationMembership: vi.fn(),
	listEntitySetsForOrg: vi.fn(),
	// The authoring + regenerate libs import these at module load; they're never
	// called on the FORBIDDEN/UNAUTHORIZED paths (the gate rejects before the handler).
	db: { transaction: vi.fn() },
	insertAuthoringPrompt: vi.fn(),
	insertPlaybookStep: vi.fn(),
	insertPlaybookWithDraft: vi.fn(),
	updatePlaybook: vi.fn(),
	writeAuditAndActivity: vi.fn(),
	getPlaybookForOrg: vi.fn(),
	getCurrentDraftPlaybookVersion: vi.fn(),
	listPlaybookStepsForVersion: vi.fn(),
	updatePlaybookStep: vi.fn(),
}));

import { auth } from "@virn/auth";
import { getOrganizationMembership } from "@virn/database";

import { authorPlaybookProc } from "./author-playbook";
import { regeneratePlaybookStepProc } from "./regenerate-playbook-step";

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

describe("playbook AI-authoring procedures -- auth gate", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(auth.api.getSession).mockResolvedValue(makeSession() as never);
		vi.mocked(getOrganizationMembership).mockResolvedValue(makeMembership() as never);
	});

	it("authorPlaybook throws UNAUTHORIZED with no session", async () => {
		vi.mocked(auth.api.getSession).mockResolvedValueOnce(null);
		await expect(
			call(authorPlaybookProc, { prompt: "build a post-stay cadence" }, ctx),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });
	});

	it("authorPlaybook throws FORBIDDEN for plain members", async () => {
		vi.mocked(getOrganizationMembership).mockResolvedValueOnce(makeMembership("member") as never);
		await expect(
			call(authorPlaybookProc, { prompt: "build a post-stay cadence" }, ctx),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});

	it("regeneratePlaybookStep throws FORBIDDEN for plain members", async () => {
		vi.mocked(getOrganizationMembership).mockResolvedValueOnce(makeMembership("member") as never);
		await expect(
			call(regeneratePlaybookStepProc, { playbookId: "pb-1", stepId: "s-1" }, ctx),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});

	it("regeneratePlaybookStep throws UNAUTHORIZED with no session", async () => {
		vi.mocked(auth.api.getSession).mockResolvedValueOnce(null);
		await expect(
			call(regeneratePlaybookStepProc, { playbookId: "pb-1", stepId: "s-1" }, ctx),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });
	});
});
