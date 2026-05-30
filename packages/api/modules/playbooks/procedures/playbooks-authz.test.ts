// Procedure-level authz-gate tests for the Playbooks surface (Phase 18a).
//
// Closes the deferred Scenario F from the Phase 18 verification: the non-admin
// "read-but-not-write" posture is enforced server-side by `adminOrgProcedure`,
// not in the UI. Driving a seeded non-admin through a real browser session is
// non-deterministic (no active better-auth org), so the negative-authz assertion
// lives here as a contract test instead. Mirrors datasets.test.ts: mock
// @virn/auth + @virn/database, then `call()` each procedure and assert the gate.
//
// Step deep-copy / refusal-code behavior of the lib layer is covered separately
// in ../lib/publish.test.ts -- this file is purely the auth gate.

import { call } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@virn/auth", () => ({
	auth: { api: { getSession: vi.fn() } },
}));

vi.mock("@virn/database", () => ({
	getOrganizationMembership: vi.fn(),
	listPlaybooksForOrg: vi.fn(),
	// The lib modules the procedures import reference these symbols at module
	// top-level (`void createPlaybookQuery` etc.), so the factory must define
	// them or vitest throws on evaluation. They're never called in these tests.
	createPlaybook: vi.fn(),
	getOrganizationById: vi.fn(),
	getPlaybookForOrg: vi.fn(),
	writeAuditAndActivity: vi.fn(),
}));

import { auth } from "@virn/auth";
import { getOrganizationMembership, listPlaybooksForOrg } from "@virn/database";

import { createPlaybookProc } from "./create-playbook";
import { createPlaybookStepProc } from "./create-step";
import { discardPlaybookDraftProc } from "./discard-draft";
import { editPublishedPlaybookProc } from "./edit-published";
import { listPlaybooksProc } from "./list-playbooks";
import { publishPlaybookVersionProc } from "./publish-version";
import { setPlaybookActiveProc } from "./set-playbook-active";

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

// Every mutating playbook procedure is an adminOrgProcedure. Each entry is a
// minimally-valid input so the AUTH gate is what rejects, not zod.
const MUTATIONS: Array<{ name: string; run: () => Promise<unknown> }> = [
	{ name: "create", run: () => call(createPlaybookProc, { name: "Cadence" }, ctx) },
	{
		name: "publishVersion",
		run: () => call(publishPlaybookVersionProc, { versionId: "ver_1" }, ctx),
	},
	{
		name: "editPublished",
		run: () => call(editPublishedPlaybookProc, { playbookId: "pb_1" }, ctx),
	},
	{
		name: "discardDraft",
		run: () => call(discardPlaybookDraftProc, { playbookId: "pb_1" }, ctx),
	},
	{
		name: "setActive",
		run: () => call(setPlaybookActiveProc, { playbookId: "pb_1", isActive: true }, ctx),
	},
	{
		name: "createStep",
		run: () =>
			call(
				createPlaybookStepProc,
				{ playbookVersionId: "ver_1", position: 0, type: "wait_for_duration", config: {} },
				ctx,
			),
	},
];

describe("playbooks procedures -- auth gate", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(auth.api.getSession).mockResolvedValue(makeSession() as never);
		vi.mocked(getOrganizationMembership).mockResolvedValue(makeMembership() as never);
	});

	it("create throws UNAUTHORIZED with no session", async () => {
		vi.mocked(auth.api.getSession).mockResolvedValueOnce(null);
		await expect(call(createPlaybookProc, { name: "Cadence" }, ctx)).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		});
	});

	for (const m of MUTATIONS) {
		it(`${m.name} throws FORBIDDEN for plain members`, async () => {
			vi.mocked(getOrganizationMembership).mockResolvedValueOnce(makeMembership("member") as never);
			await expect(m.run()).rejects.toMatchObject({ code: "FORBIDDEN" });
			// The DB write must never be reached once the gate rejects.
			expect(listPlaybooksForOrg).not.toHaveBeenCalled();
		});
	}

	it("list works for plain members (read access)", async () => {
		vi.mocked(getOrganizationMembership).mockResolvedValueOnce(makeMembership("member") as never);
		vi.mocked(listPlaybooksForOrg).mockResolvedValueOnce([]);
		await expect(call(listPlaybooksProc, {}, ctx)).resolves.toEqual([]);
	});
});
