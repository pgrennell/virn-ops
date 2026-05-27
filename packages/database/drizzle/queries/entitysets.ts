// packages/database/drizzle/queries/entitysets.ts
//
// Definition-layer DB helpers for `entity_set` + `entity_set_member` (PRD_WORKFLOW_SOP_
// BUILDER.md §6.1, §8.1 / D-034). Mirror of the vendor/listing/agent CRUD shape: org-
// scoped, joins for display, uniform null-on-cross-org to prevent existence probing.
//
// Entity sets are HARD deleted (no soft-delete column on the schema): the table is small,
// membership rows cascade, and there's no need to preserve "previously-existed entity
// set" history for audit (entity_set is metadata, not runtime state). If/when an audit
// concern emerges, add `deletedAt` later — schema is forward-compatible.

import { and, asc, eq, inArray } from "drizzle-orm";

import { db } from "../client";
import { entitySet, entitySetMember } from "../schema/postgres";

// Match the enum values from schema/_shared.ts. We use the broad shared `entity_type` for
// future-proofing (post-v1 packs add values); the application currently restricts inserts
// to `'listing'` via the EntityAdapter registry.
export type EntitySetEntityType = "listing"; // narrow in v1.5 even though the column accepts more

export interface EntitySetRow {
	id: string;
	organizationId: string;
	entityType: EntitySetEntityType;
	name: string;
	color: string | null;
	description: string | null;
	memberCount: number;
	createdAt: Date;
	updatedAt: Date;
}

/** List entity sets in the org. Optionally narrow by `entityType` for picker UIs that
 * only surface one type ("which listing-sets does this workflow run for?"). */
export async function listEntitySetsForOrg(input: {
	organizationId: string;
	entityType?: EntitySetEntityType;
}): Promise<EntitySetRow[]> {
	const rows = await db.query.entitySet.findMany({
		where: (s, { and: andOp, eq: eqOp }) => {
			const conds = [eqOp(s.organizationId, input.organizationId)];
			if (input.entityType) conds.push(eqOp(s.entityType, input.entityType));
			return andOp(...conds);
		},
		orderBy: (s, { asc: ascOp }) => [ascOp(s.entityType), ascOp(s.name)],
		with: { members: { columns: { entityId: true } } },
	});
	return rows.map((r) => ({
		id: r.id,
		organizationId: r.organizationId,
		entityType: r.entityType as EntitySetEntityType,
		name: r.name,
		color: r.color,
		description: r.description,
		memberCount: r.members.length,
		createdAt: r.createdAt,
		updatedAt: r.updatedAt,
	}));
}

/** Fetch a single entity set scoped to the org. Returns null if missing or cross-org. */
export async function getEntitySetForOrg(input: {
	organizationId: string;
	entitySetId: string;
}): Promise<EntitySetRow | null> {
	const r = await db.query.entitySet.findFirst({
		where: (s, { and: andOp, eq: eqOp }) =>
			andOp(eqOp(s.id, input.entitySetId), eqOp(s.organizationId, input.organizationId)),
		with: { members: { columns: { entityId: true } } },
	});
	if (!r) return null;
	return {
		id: r.id,
		organizationId: r.organizationId,
		entityType: r.entityType as EntitySetEntityType,
		name: r.name,
		color: r.color,
		description: r.description,
		memberCount: r.members.length,
		createdAt: r.createdAt,
		updatedAt: r.updatedAt,
	};
}

export interface CreateEntitySetInput {
	organizationId: string;
	entityType: EntitySetEntityType;
	name: string;
	color?: string | null;
	description?: string | null;
}

/** Insert a new entity set. Throws on (org, type, name) collision per the uq_ index --
 * callers should catch and map to a CONFLICT response. */
export async function createEntitySet(input: CreateEntitySetInput): Promise<EntitySetRow> {
	const [row] = await db
		.insert(entitySet)
		.values({
			organizationId: input.organizationId,
			entityType: input.entityType,
			name: input.name,
			color: input.color ?? null,
			description: input.description ?? null,
		})
		.returning();
	return {
		id: row.id,
		organizationId: row.organizationId,
		entityType: row.entityType as EntitySetEntityType,
		name: row.name,
		color: row.color,
		description: row.description,
		memberCount: 0,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

export interface UpdateEntitySetInput {
	organizationId: string;
	entitySetId: string;
	name?: string;
	color?: string | null;
	description?: string | null;
}

/** Patch mutable fields. `entityType` is intentionally NOT patchable -- changing the type
 * of an existing set would orphan its members. Returns null if missing or cross-org. */
export async function updateEntitySet(
	input: UpdateEntitySetInput,
): Promise<EntitySetRow | null> {
	const patch: Record<string, unknown> = { updatedAt: new Date() };
	if (input.name !== undefined) patch.name = input.name;
	if (input.color !== undefined) patch.color = input.color;
	if (input.description !== undefined) patch.description = input.description;

	const result = await db
		.update(entitySet)
		.set(patch)
		.where(
			and(
				eq(entitySet.id, input.entitySetId),
				eq(entitySet.organizationId, input.organizationId),
			),
		)
		.returning({ id: entitySet.id });
	if (result.length === 0) return null;
	return await getEntitySetForOrg(input);
}

/** Hard delete (cascades entity_set_member rows). Returns whether anything was deleted --
 * callers use this for "already gone" idempotency. */
export async function deleteEntitySet(input: {
	organizationId: string;
	entitySetId: string;
}): Promise<{ deleted: boolean }> {
	const result = await db
		.delete(entitySet)
		.where(
			and(
				eq(entitySet.id, input.entitySetId),
				eq(entitySet.organizationId, input.organizationId),
			),
		)
		.returning({ id: entitySet.id });
	return { deleted: result.length > 0 };
}

// ---------------------------------------------------------------------------
// Membership operations
// ---------------------------------------------------------------------------

export interface MemberInput {
	organizationId: string;
	entitySetId: string;
	entityType: EntitySetEntityType;
	entityId: string;
}

/** Add a polymorphic membership. Idempotent: re-adding the same (set, type, id) is a
 * no-op (caught by PK violation, mapped to `{ added: false }` for the caller). */
export async function addEntitySetMember(
	input: MemberInput,
): Promise<{ added: boolean }> {
	// Verify the entity_set belongs to the org BEFORE writing the member row -- without
	// this check a caller could write members into someone else's entity_set by guessing
	// the id. The set's own org-scope check on the FK is not sufficient since FKs don't
	// enforce ours-vs-theirs by org.
	const set = await db.query.entitySet.findFirst({
		where: (s, { and: andOp, eq: eqOp }) =>
			andOp(
				eqOp(s.id, input.entitySetId),
				eqOp(s.organizationId, input.organizationId),
			),
		columns: { id: true, entityType: true },
	});
	if (!set) return { added: false };
	// Type must match the set's declared entity_type -- a 'listing'-typed set can't hold
	// 'vendor' members. Defense in depth (the procedure layer also validates).
	if (set.entityType !== input.entityType) return { added: false };

	try {
		await db.insert(entitySetMember).values({
			entitySetId: input.entitySetId,
			entityType: input.entityType,
			entityId: input.entityId,
		});
		return { added: true };
	} catch (e) {
		// PK violation = already a member; idempotent success-ish.
		if (e instanceof Error && /duplicate key|unique constraint/i.test(e.message)) {
			return { added: false };
		}
		throw e;
	}
}

/** Remove a polymorphic membership. Returns whether anything was deleted. */
export async function removeEntitySetMember(
	input: MemberInput,
): Promise<{ removed: boolean }> {
	// Same org-scoping guard as addEntitySetMember.
	const set = await db.query.entitySet.findFirst({
		where: (s, { and: andOp, eq: eqOp }) =>
			andOp(
				eqOp(s.id, input.entitySetId),
				eqOp(s.organizationId, input.organizationId),
			),
		columns: { id: true },
	});
	if (!set) return { removed: false };

	const result = await db
		.delete(entitySetMember)
		.where(
			and(
				eq(entitySetMember.entitySetId, input.entitySetId),
				eq(entitySetMember.entityType, input.entityType),
				eq(entitySetMember.entityId, input.entityId),
			),
		)
		.returning({ entityId: entitySetMember.entityId });
	return { removed: result.length > 0 };
}

/** List the entity_ids of every member of a given set. Used by the entity_set detail
 * view (chip list) and by the launcher's "show me workflows scoped to set X." Org-scoping
 * is enforced by first verifying the set belongs to the org. */
export async function listMembersForEntitySet(input: {
	organizationId: string;
	entitySetId: string;
}): Promise<Array<{ entityType: EntitySetEntityType; entityId: string; createdAt: Date }>> {
	const set = await db.query.entitySet.findFirst({
		where: (s, { and: andOp, eq: eqOp }) =>
			andOp(
				eqOp(s.id, input.entitySetId),
				eqOp(s.organizationId, input.organizationId),
			),
		columns: { id: true },
	});
	if (!set) return [];
	const rows = await db
		.select({
			entityType: entitySetMember.entityType,
			entityId: entitySetMember.entityId,
			createdAt: entitySetMember.createdAt,
		})
		.from(entitySetMember)
		.where(eq(entitySetMember.entitySetId, input.entitySetId))
		.orderBy(asc(entitySetMember.createdAt));
	return rows.map((r) => ({
		entityType: r.entityType as EntitySetEntityType,
		entityId: r.entityId,
		createdAt: r.createdAt,
	}));
}

/** Reverse lookup: which entity sets does (entityType, entityId) belong to? The workflow
 * launcher uses this to intersect the target entity's set memberships with each candidate
 * workflow's declared `entity_set_ids` scope.
 *
 * Org-scoping note: we DON'T verify the entity itself belongs to the org here -- the
 * caller is expected to have already authorized access to (entityType, entityId).
 * We do scope the entity_set rows by org via the JOIN so cross-org sets can't surface. */
export async function listEntitySetsForEntity(input: {
	organizationId: string;
	entityType: EntitySetEntityType;
	entityId: string;
}): Promise<Array<{ id: string; name: string; color: string | null }>> {
	const rows = await db
		.select({
			id: entitySet.id,
			name: entitySet.name,
			color: entitySet.color,
		})
		.from(entitySetMember)
		.innerJoin(entitySet, eq(entitySet.id, entitySetMember.entitySetId))
		.where(
			and(
				eq(entitySet.organizationId, input.organizationId),
				eq(entitySetMember.entityType, input.entityType),
				eq(entitySetMember.entityId, input.entityId),
			),
		)
		.orderBy(asc(entitySet.name));
	return rows;
}

/** Batched reverse lookup: for a SET of entity ids of one type, return per-id set
 * memberships. The most common picker query: "show me each listing in this org with its
 * set chips." Returns a Map keyed by entityId for cheap O(1) lookup at the caller. */
export async function listEntitySetsForEntities(input: {
	organizationId: string;
	entityType: EntitySetEntityType;
	entityIds: string[];
}): Promise<Map<string, Array<{ id: string; name: string; color: string | null }>>> {
	if (input.entityIds.length === 0) return new Map();
	const rows = await db
		.select({
			entityId: entitySetMember.entityId,
			id: entitySet.id,
			name: entitySet.name,
			color: entitySet.color,
		})
		.from(entitySetMember)
		.innerJoin(entitySet, eq(entitySet.id, entitySetMember.entitySetId))
		.where(
			and(
				eq(entitySet.organizationId, input.organizationId),
				eq(entitySetMember.entityType, input.entityType),
				inArray(entitySetMember.entityId, input.entityIds),
			),
		)
		.orderBy(asc(entitySet.name));
	const byEntity = new Map<
		string,
		Array<{ id: string; name: string; color: string | null }>
	>();
	for (const r of rows) {
		const list = byEntity.get(r.entityId) ?? [];
		list.push({ id: r.id, name: r.name, color: r.color });
		byEntity.set(r.entityId, list);
	}
	return byEntity;
}
