// packages/api/modules/entitysets/procedures/entitysets.test.ts
//
// Procedure-level tests for the entity-set CRUD + membership surface (Phase 9.5 / D-034).
// Mirrors the data-set / vendor / agent test pattern: auth gates + happy paths.
// @virn/database mocked at module boundary.

import { call } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@virn/auth", () => ({
	auth: { api: { getSession: vi.fn() } },
}));

vi.mock("@virn/database", () => ({
	getOrganizationMembership: vi.fn(),
	listEntitySetsForOrg: vi.fn(),
	getEntitySetForOrg: vi.fn(),
	createEntitySet: vi.fn(),
	updateEntitySet: vi.fn(),
	deleteEntitySet: vi.fn(),
	addEntitySetMember: vi.fn(),
	removeEntitySetMember: vi.fn(),
	listMembersForEntitySet: vi.fn(),
	listEntitySetsForEntity: vi.fn(),
	listEntitySetsForEntities: vi.fn(),
	// EntityAdapter touches the underlying entity query (listings) on add-member.
	getListingForOrg: vi.fn(),
	listListingsForOrg: vi.fn(),
}));

import { auth } from "@virn/auth";
import {
	addEntitySetMember,
	createEntitySet,
	deleteEntitySet,
	getEntitySetForOrg,
	getListingForOrg,
	getOrganizationMembership,
	listEntitySetsForEntities,
	listEntitySetsForEntity,
	listEntitySetsForOrg,
	listMembersForEntitySet,
	removeEntitySetMember,
	updateEntitySet,
} from "@virn/database";

import { addMember } from "./add-member";
import { create } from "./create";
import { remove } from "./delete";
import { get } from "./get";
import { list } from "./list";
import { listForEntities } from "./list-for-entities";
import { listForEntity } from "./list-for-entity";
import { listMembers } from "./list-members";
import { removeMember } from "./remove-member";
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

function makeEntitySet(overrides: Partial<Record<string, unknown>> = {}) {
	return {
		id: "es_1",
		organizationId: "org-1",
		entityType: "listing" as const,
		name: "STR penthouses",
		color: "#ff00aa",
		description: null,
		memberCount: 0,
		createdAt: new Date(),
		updatedAt: new Date(),
		...overrides,
	};
}

function makeListing(overrides: Partial<Record<string, unknown>> = {}) {
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
		...overrides,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(auth.api.getSession).mockResolvedValue(makeSession() as never);
	vi.mocked(getOrganizationMembership).mockResolvedValue(makeMembership() as never);
});

// ---------------------------------------------------------------------------
// Auth gates
// ---------------------------------------------------------------------------

describe("entitySets -- auth gates", () => {
	it("list throws UNAUTHORIZED with no session", async () => {
		vi.mocked(auth.api.getSession).mockResolvedValueOnce(null);
		await expect(call(list, {}, ctx)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
	});

	it("create throws FORBIDDEN for plain members", async () => {
		vi.mocked(getOrganizationMembership).mockResolvedValueOnce(
			makeMembership("member") as never,
		);
		await expect(
			call(create, { entityType: "listing", name: "X" }, ctx),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});

	it("update throws FORBIDDEN for plain members", async () => {
		vi.mocked(getOrganizationMembership).mockResolvedValueOnce(
			makeMembership("member") as never,
		);
		await expect(call(update, { id: "es_1", name: "x" }, ctx)).rejects.toMatchObject({
			code: "FORBIDDEN",
		});
	});

	it("delete throws FORBIDDEN for plain members", async () => {
		vi.mocked(getOrganizationMembership).mockResolvedValueOnce(
			makeMembership("member") as never,
		);
		await expect(call(remove, { id: "es_1" }, ctx)).rejects.toMatchObject({
			code: "FORBIDDEN",
		});
	});

	it("addMember + removeMember throw FORBIDDEN for plain members", async () => {
		vi.mocked(getOrganizationMembership).mockResolvedValue(
			makeMembership("member") as never,
		);
		await expect(
			call(addMember, { entitySetId: "es_1", entityType: "listing", entityId: "lst_1" }, ctx),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		await expect(
			call(
				removeMember,
				{ entitySetId: "es_1", entityType: "listing", entityId: "lst_1" },
				ctx,
			),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});

	it("list + get + listMembers + listForEntity work for plain members (read access)", async () => {
		vi.mocked(getOrganizationMembership).mockResolvedValue(makeMembership("member") as never);
		vi.mocked(listEntitySetsForOrg).mockResolvedValueOnce([]);
		await expect(call(list, {}, ctx)).resolves.toEqual([]);

		vi.mocked(getEntitySetForOrg).mockResolvedValueOnce(makeEntitySet() as never);
		await expect(call(get, { id: "es_1" }, ctx)).resolves.toMatchObject({ id: "es_1" });

		vi.mocked(listMembersForEntitySet).mockResolvedValueOnce([]);
		await expect(call(listMembers, { entitySetId: "es_1" }, ctx)).resolves.toEqual([]);

		vi.mocked(listEntitySetsForEntity).mockResolvedValueOnce([]);
		await expect(
			call(listForEntity, { entityType: "listing", entityId: "lst_1" }, ctx),
		).resolves.toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// Happy paths
// ---------------------------------------------------------------------------

describe("entitySets -- happy paths", () => {
	it("list returns rows, optionally filtered by entityType", async () => {
		vi.mocked(listEntitySetsForOrg).mockResolvedValueOnce([
			makeEntitySet(),
			makeEntitySet({ id: "es_2", name: "Commercial suites" }),
		] as never);

		const result = await call(list, { entityType: "listing" }, ctx);
		expect(result).toHaveLength(2);
		expect(listEntitySetsForOrg).toHaveBeenCalledWith({
			organizationId: "org-1",
			entityType: "listing",
		});
	});

	it("get throws NOT_FOUND for missing / cross-org sets", async () => {
		vi.mocked(getEntitySetForOrg).mockResolvedValueOnce(null);
		await expect(call(get, { id: "es_missing" }, ctx)).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});

	it("create returns the new set", async () => {
		vi.mocked(createEntitySet).mockResolvedValueOnce(makeEntitySet() as never);
		const res = await call(
			create,
			{ entityType: "listing", name: "STR penthouses", color: "#ff00aa" },
			ctx,
		);
		expect(res.id).toBe("es_1");
		expect(createEntitySet).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: "org-1",
				entityType: "listing",
				name: "STR penthouses",
				color: "#ff00aa",
			}),
		);
	});

	it("create maps UNIQUE constraint violation to CONFLICT", async () => {
		vi.mocked(createEntitySet).mockRejectedValueOnce(
			new Error('duplicate key value violates unique constraint "uq_entity_set_org_type_name"'),
		);
		await expect(
			call(create, { entityType: "listing", name: "STR penthouses" }, ctx),
		).rejects.toMatchObject({ code: "CONFLICT" });
	});

	it("update returns the patched row + maps unique violation to CONFLICT", async () => {
		const updated = { ...makeEntitySet(), name: "STR luxury" };
		vi.mocked(updateEntitySet).mockResolvedValueOnce(updated as never);
		const res = await call(update, { id: "es_1", name: "STR luxury" }, ctx);
		expect(res.name).toBe("STR luxury");

		vi.mocked(updateEntitySet).mockRejectedValueOnce(
			new Error('duplicate key value violates unique constraint "uq_entity_set_org_type_name"'),
		);
		await expect(
			call(update, { id: "es_1", name: "STR penthouses" }, ctx),
		).rejects.toMatchObject({ code: "CONFLICT" });
	});

	it("update throws NOT_FOUND for missing / cross-org sets", async () => {
		vi.mocked(updateEntitySet).mockResolvedValueOnce(null);
		await expect(call(update, { id: "es_missing", name: "x" }, ctx)).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});

	it("delete returns deleted:true on success", async () => {
		vi.mocked(deleteEntitySet).mockResolvedValueOnce({ deleted: true });
		const res = await call(remove, { id: "es_1" }, ctx);
		expect(res).toEqual({ deleted: true });
	});

	it("delete throws NOT_FOUND when nothing was deleted", async () => {
		vi.mocked(deleteEntitySet).mockResolvedValueOnce({ deleted: false });
		await expect(call(remove, { id: "es_missing" }, ctx)).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});

	// -------------------------------------------------------------------------
	// Membership operations
	// -------------------------------------------------------------------------

	it("addMember verifies the target entity exists via the adapter before inserting", async () => {
		vi.mocked(getListingForOrg).mockResolvedValueOnce(makeListing() as never);
		vi.mocked(addEntitySetMember).mockResolvedValueOnce({ added: true });

		const res = await call(
			addMember,
			{ entitySetId: "es_1", entityType: "listing", entityId: "lst_1" },
			ctx,
		);
		expect(res).toEqual({ added: true });
		// Adapter was consulted to verify the listing exists in the org.
		expect(getListingForOrg).toHaveBeenCalledWith("org-1", "lst_1");
	});

	it("addMember throws NOT_FOUND when the target entity isn't in the org", async () => {
		vi.mocked(getListingForOrg).mockResolvedValueOnce(null);
		await expect(
			call(addMember, { entitySetId: "es_1", entityType: "listing", entityId: "lst_x" }, ctx),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		expect(addEntitySetMember).not.toHaveBeenCalled();
	});

	it("addMember returns added:false (idempotent) when the row already exists", async () => {
		vi.mocked(getListingForOrg).mockResolvedValueOnce(makeListing() as never);
		vi.mocked(addEntitySetMember).mockResolvedValueOnce({ added: false });

		const res = await call(
			addMember,
			{ entitySetId: "es_1", entityType: "listing", entityId: "lst_1" },
			ctx,
		);
		expect(res).toEqual({ added: false });
	});

	it("removeMember returns the underlying removed flag (idempotent)", async () => {
		vi.mocked(removeEntitySetMember).mockResolvedValueOnce({ removed: true });
		await expect(
			call(removeMember, { entitySetId: "es_1", entityType: "listing", entityId: "lst_1" }, ctx),
		).resolves.toEqual({ removed: true });

		vi.mocked(removeEntitySetMember).mockResolvedValueOnce({ removed: false });
		await expect(
			call(removeMember, { entitySetId: "es_1", entityType: "listing", entityId: "lst_gone" }, ctx),
		).resolves.toEqual({ removed: false });
	});

	it("listMembers returns the (entityType, entityId, createdAt) tuples", async () => {
		const rows = [
			{ entityType: "listing" as const, entityId: "lst_1", createdAt: new Date() },
			{ entityType: "listing" as const, entityId: "lst_2", createdAt: new Date() },
		];
		vi.mocked(listMembersForEntitySet).mockResolvedValueOnce(rows);
		const res = await call(listMembers, { entitySetId: "es_1" }, ctx);
		expect(res).toEqual(rows);
	});

	it("listForEntity returns the set chips for a given entity", async () => {
		const chips = [
			{ id: "es_1", name: "STR penthouses", color: "#ff00aa" },
			{ id: "es_2", name: "Class-A office", color: null },
		];
		vi.mocked(listEntitySetsForEntity).mockResolvedValueOnce(chips);
		const res = await call(
			listForEntity,
			{ entityType: "listing", entityId: "lst_1" },
			ctx,
		);
		expect(res).toEqual(chips);
	});

	// -------------------------------------------------------------------------
	// listForEntities -- batched reverse lookup (Phase 9.5f index chip strip)
	// -------------------------------------------------------------------------

	it("listForEntities returns {} for an empty entityIds list without hitting the DB", async () => {
		const res = await call(
			listForEntities,
			{ entityType: "listing", entityIds: [] },
			ctx,
		);
		expect(res).toEqual({});
		expect(listEntitySetsForEntities).not.toHaveBeenCalled();
	});

	it("listForEntities serializes the Map<entityId, ChipRow[]> as a JSON object", async () => {
		const map = new Map<
			string,
			Array<{ id: string; name: string; color: string | null }>
		>([
			[
				"lst_1",
				[
					{ id: "es_1", name: "STR penthouses", color: "#ff00aa" },
					{ id: "es_2", name: "Beachfront", color: null },
				],
			],
			["lst_2", [{ id: "es_2", name: "Beachfront", color: null }]],
		]);
		vi.mocked(listEntitySetsForEntities).mockResolvedValueOnce(map);

		const res = await call(
			listForEntities,
			{ entityType: "listing", entityIds: ["lst_1", "lst_2", "lst_3"] },
			ctx,
		);

		// JSON-friendly object shape (Map doesn't cross the oRPC wire).
		expect(res).toEqual({
			lst_1: [
				{ id: "es_1", name: "STR penthouses", color: "#ff00aa" },
				{ id: "es_2", name: "Beachfront", color: null },
			],
			lst_2: [{ id: "es_2", name: "Beachfront", color: null }],
		});
		// lst_3 had no memberships -- query returns no entry; result object omits the key.
		expect(res).not.toHaveProperty("lst_3");
	});

	it("listForEntities rejects batches larger than 200", async () => {
		const tooMany = Array.from({ length: 201 }, (_, i) => `lst_${i}`);
		await expect(
			call(listForEntities, { entityType: "listing", entityIds: tooMany }, ctx),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});

	it("listForEntities works for plain members (read access)", async () => {
		vi.mocked(getOrganizationMembership).mockResolvedValueOnce(
			makeMembership("member") as never,
		);
		vi.mocked(listEntitySetsForEntities).mockResolvedValueOnce(new Map());
		await expect(
			call(
				listForEntities,
				{ entityType: "listing", entityIds: ["lst_1"] },
				ctx,
			),
		).resolves.toEqual({});
	});
});
