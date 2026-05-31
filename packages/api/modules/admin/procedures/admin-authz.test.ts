// Coverage hardening -- platform-admin gate on the admin module. These three
// procedures (findOrganization / listOrganizations / listUsers) expose CROSS-ORG
// data (every org, every user), so they must sit behind adminProcedure -- the
// PLATFORM-admin gate (session.user.role === "admin"), NOT the per-org admin gate.
// A regular user (even an org admin/owner) must be FORBIDDEN; no session ->
// UNAUTHORIZED. This pins the boundary so a mis-tiering can't silently expose the
// whole platform's data. The adminProcedure base itself is unit-tested in
// orpc/procedures.test.ts; this confirms each admin-module procedure uses it.

import { call } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@virn/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));

vi.mock("@virn/database", () => ({
	getOrganizationById: vi.fn(),
	countAllOrganizations: vi.fn(),
	getOrganizations: vi.fn(),
	countAllUsers: vi.fn(),
	getUsers: vi.fn(),
}));

import { auth } from "@virn/auth";
import { countAllUsers, getUsers } from "@virn/database";

import { findOrganization } from "./find-organization";
import { listOrganizations } from "./list-organizations";
import { listUsers } from "./list-users";

const ctx = { context: { headers: new Headers() } };

function platformAdminSession() {
	return {
		user: { id: "admin-1", role: "admin", email: "a@example.com", name: "A", emailVerified: true },
		session: { id: "session-1", userId: "admin-1", token: "tok", expiresAt: new Date() },
	};
}

function regularUserSession() {
	return {
		user: { id: "user-1", role: "user", email: "u@example.com", name: "U", emailVerified: true },
		session: { id: "session-2", userId: "user-1", token: "tok", expiresAt: new Date() },
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(auth.api.getSession).mockResolvedValue(platformAdminSession() as never);
});

describe("admin procedures -- platform-admin gate", () => {
	const procs = [
		{ name: "findOrganization", run: () => call(findOrganization, { id: "org-1" }, ctx) },
		{ name: "listOrganizations", run: () => call(listOrganizations, {}, ctx) },
		{ name: "listUsers", run: () => call(listUsers, {}, ctx) },
	];

	for (const p of procs) {
		it(`${p.name} throws FORBIDDEN for a non-platform-admin (regular user)`, async () => {
			vi.mocked(auth.api.getSession).mockResolvedValueOnce(regularUserSession() as never);
			await expect(p.run()).rejects.toMatchObject({ code: "FORBIDDEN" });
		});

		it(`${p.name} throws UNAUTHORIZED with no session`, async () => {
			vi.mocked(auth.api.getSession).mockResolvedValueOnce(null);
			await expect(p.run()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
		});
	}

	it("listUsers is allowed for a platform admin (gate is not over-restrictive)", async () => {
		vi.mocked(countAllUsers).mockResolvedValueOnce(0 as never);
		vi.mocked(getUsers).mockResolvedValueOnce([] as never);
		await expect(call(listUsers, {}, ctx)).resolves.toBeDefined();
	});
});
