// Coverage hardening -- the listings module (org-scoped property-listing entity
// CRUD) had ZERO test coverage. Listings feed run-launcher pickers + entity-set
// membership, so mutations are adminOrgProcedure (member FORBIDDEN) and reads are
// protectedOrgProcedure (member allowed). Mirrors vendors.test.ts: auth gates +
// the uniform NOT_FOUND (cross-org / soft-deleted) refusals + a create happy path.

import { call } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@virn/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));

vi.mock("@virn/database", () => ({
	getOrganizationMembership: vi.fn(),
	listListingsForOrg: vi.fn(),
	getListingForOrg: vi.fn(),
	createListing: vi.fn(),
	updateListing: vi.fn(),
	softDeleteListing: vi.fn(),
	writeAuditAndActivity: vi.fn(),
}));

import { auth } from "@virn/auth";
import {
	createListing,
	getListingForOrg,
	getOrganizationMembership,
	listListingsForOrg,
	softDeleteListing,
	updateListing,
	writeAuditAndActivity,
} from "@virn/database";

import { create } from "./create";
import { get } from "./get";
import { list } from "./list";
import { softDelete } from "./soft-delete";
import { update } from "./update";

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

function makeListing() {
	return {
		id: "lst_1",
		name: "Unit 3B",
		description: null,
		propertyType: "str",
		address: null,
		externalListingId: null,
		createdByUserId: "user-1",
		createdByUserName: "U",
		createdAt: new Date(),
		updatedAt: new Date(),
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(auth.api.getSession).mockResolvedValue(makeSession() as never);
	vi.mocked(getOrganizationMembership).mockResolvedValue(makeMembership() as never);
});

describe("listings -- auth gate", () => {
	it("list throws UNAUTHORIZED with no session", async () => {
		vi.mocked(auth.api.getSession).mockResolvedValueOnce(null);
		await expect(call(list, {}, ctx)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
	});

	const adminProcs = [
		{ name: "create", run: () => call(create, { name: "Unit 3B" }, ctx) },
		{ name: "update", run: () => call(update, { id: "lst_1", name: "x" }, ctx) },
		{ name: "softDelete", run: () => call(softDelete, { id: "lst_1" }, ctx) },
	];

	for (const p of adminProcs) {
		it(`${p.name} throws FORBIDDEN for a plain member`, async () => {
			vi.mocked(getOrganizationMembership).mockResolvedValueOnce(makeMembership("member") as never);
			await expect(p.run()).rejects.toMatchObject({ code: "FORBIDDEN" });
		});
	}

	it("list + get work for plain members (read access)", async () => {
		vi.mocked(getOrganizationMembership).mockResolvedValue(makeMembership("member") as never);
		vi.mocked(listListingsForOrg).mockResolvedValueOnce([] as never);
		await expect(call(list, {}, ctx)).resolves.toEqual([]);

		vi.mocked(getListingForOrg).mockResolvedValueOnce(makeListing() as never);
		await expect(call(get, { id: "lst_1" }, ctx)).resolves.toMatchObject({ id: "lst_1" });
	});
});

describe("listings -- happy paths + refusals", () => {
	it("create returns the new listing + audit-logs listing.created", async () => {
		vi.mocked(createListing).mockResolvedValueOnce(makeListing() as never);
		const res = await call(create, { name: "Unit 3B" }, ctx);
		expect(res).toMatchObject({ id: "lst_1" });
		expect(createListing).toHaveBeenCalledWith(
			expect.objectContaining({ organizationId: "org-1", name: "Unit 3B", createdByUserId: "user-1" }),
		);
		expect(writeAuditAndActivity).toHaveBeenCalledWith(
			expect.objectContaining({ action: "listing.created", entityId: "lst_1" }),
		);
	});

	it("get throws NOT_FOUND for a missing / cross-org / soft-deleted listing", async () => {
		vi.mocked(getListingForOrg).mockResolvedValueOnce(null as never);
		await expect(call(get, { id: "missing" }, ctx)).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("update returns the updated row", async () => {
		vi.mocked(updateListing).mockResolvedValueOnce({ ...makeListing(), name: "Renamed" } as never);
		const res = await call(update, { id: "lst_1", name: "Renamed" }, ctx);
		expect(res).toMatchObject({ name: "Renamed" });
	});

	it("update throws NOT_FOUND when the listing is missing", async () => {
		vi.mocked(updateListing).mockResolvedValueOnce(null as never);
		await expect(call(update, { id: "missing", name: "x" }, ctx)).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("softDelete returns deleted:true on success", async () => {
		vi.mocked(softDeleteListing).mockResolvedValueOnce({ deleted: true } as never);
		await expect(call(softDelete, { id: "lst_1" }, ctx)).resolves.toEqual({ deleted: true });
	});

	it("softDelete throws NOT_FOUND when nothing was deleted (missing / already deleted)", async () => {
		vi.mocked(softDeleteListing).mockResolvedValueOnce({ deleted: false } as never);
		await expect(call(softDelete, { id: "missing" }, ctx)).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});
