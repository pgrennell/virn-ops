// packages/database/drizzle/queries/listings.ts
//
// Definition-layer DB helpers for `listing` — the first first-class runnable property
// entity (D-034 / PRD_WORKFLOW_SOP_BUILDER.md §6.1, schema in schema/listings.ts).
// Mirror of the vendor/agent CRUD pattern (queries/vendors.ts, queries/agents.ts):
// org-scoped, soft-delete-aware, joins `createdBy` user for display.

import { and, eq, isNull } from "drizzle-orm";

import { db } from "../client";
import { listing } from "../schema/postgres";

// Loose typing for `address` jsonb — exact shape TBD by dogfood customers. Common keys
// expected: street, city, region, postal, country. Service layer treats as opaque.
export type ListingAddress = Record<string, unknown> | null;

export interface ListingListRow {
	id: string;
	name: string;
	description: string | null;
	propertyType: string | null;
	address: ListingAddress;
	externalListingId: string | null;
	createdByUserId: string | null;
	createdByUserName: string | null;
	createdAt: Date;
	updatedAt: Date;
}

/** List non-soft-deleted listings in the org, alphabetical by name. Used by the
 * listings index UI and by the launcher's listing picker. Future Layer-2 work will
 * compose entity-set filtering on top of this read shape. */
export async function listListingsForOrg(
	organizationId: string,
): Promise<ListingListRow[]> {
	const rows = await db.query.listing.findMany({
		where: (l, { and: andOp, eq: eqOp, isNull: isNullOp }) =>
			andOp(eqOp(l.organizationId, organizationId), isNullOp(l.deletedAt)),
		orderBy: (l, { asc: ascOp }) => [ascOp(l.name)],
		with: { createdBy: { columns: { id: true, name: true } } },
	});
	return rows.map((r) => ({
		id: r.id,
		name: r.name,
		description: r.description,
		propertyType: r.propertyType,
		address: (r.address ?? null) as ListingAddress,
		externalListingId: r.externalListingId,
		createdByUserId: r.createdByUserId,
		createdByUserName: r.createdBy?.name ?? null,
		createdAt: r.createdAt,
		updatedAt: r.updatedAt,
	}));
}

/** Fetch a single listing scoped to the org. Returns null if not found, soft-deleted,
 * or cross-org — uniform response prevents cross-org existence probing. */
export async function getListingForOrg(
	organizationId: string,
	listingId: string,
): Promise<ListingListRow | null> {
	const r = await db.query.listing.findFirst({
		where: (l, { and: andOp, eq: eqOp, isNull: isNullOp }) =>
			andOp(
				eqOp(l.id, listingId),
				eqOp(l.organizationId, organizationId),
				isNullOp(l.deletedAt),
			),
		with: { createdBy: { columns: { id: true, name: true } } },
	});
	if (!r) return null;
	return {
		id: r.id,
		name: r.name,
		description: r.description,
		propertyType: r.propertyType,
		address: (r.address ?? null) as ListingAddress,
		externalListingId: r.externalListingId,
		createdByUserId: r.createdByUserId,
		createdByUserName: r.createdBy?.name ?? null,
		createdAt: r.createdAt,
		updatedAt: r.updatedAt,
	};
}

export interface CreateListingInput {
	organizationId: string;
	name: string;
	description?: string | null;
	propertyType?: string | null;
	address?: ListingAddress;
	externalListingId?: string | null;
	createdByUserId: string;
}

export async function createListing(
	input: CreateListingInput,
): Promise<ListingListRow> {
	const [row] = await db
		.insert(listing)
		.values({
			organizationId: input.organizationId,
			name: input.name,
			description: input.description ?? null,
			propertyType: input.propertyType ?? null,
			address: input.address ?? null,
			externalListingId: input.externalListingId ?? null,
			createdByUserId: input.createdByUserId,
		})
		.returning({ id: listing.id });
	// Round-trip through getListingForOrg to keep the read shape (with createdBy join)
	// in one place. The created row is freshly committed; the fetch is cheap.
	const fetched = await getListingForOrg(input.organizationId, row.id);
	if (!fetched) {
		throw new Error("createListing: row vanished between insert and fetch");
	}
	return fetched;
}

export interface UpdateListingInput {
	organizationId: string;
	listingId: string;
	name?: string;
	description?: string | null;
	propertyType?: string | null;
	address?: ListingAddress;
	externalListingId?: string | null;
}

/** Patch a listing's mutable fields. Returns null if the listing doesn't exist, is
 * cross-org, or is soft-deleted. */
export async function updateListing(
	input: UpdateListingInput,
): Promise<ListingListRow | null> {
	const patch: Record<string, unknown> = { updatedAt: new Date() };
	if (input.name !== undefined) patch.name = input.name;
	if (input.description !== undefined) patch.description = input.description;
	if (input.propertyType !== undefined) patch.propertyType = input.propertyType;
	if (input.address !== undefined) patch.address = input.address;
	if (input.externalListingId !== undefined)
		patch.externalListingId = input.externalListingId;

	const result = await db
		.update(listing)
		.set(patch)
		.where(
			and(
				eq(listing.id, input.listingId),
				eq(listing.organizationId, input.organizationId),
				isNull(listing.deletedAt),
			),
		)
		.returning({ id: listing.id });
	if (result.length === 0) return null;
	return await getListingForOrg(input.organizationId, input.listingId);
}

/** Soft-delete a listing (sets deletedAt). Historical references to the listing in run
 * kickoff metadata + entity_set_member rows continue to resolve (FK is ON DELETE CASCADE
 * to set membership only; runs hold the listing id as data, not as a FK). Idempotent. */
export async function softDeleteListing(input: {
	organizationId: string;
	listingId: string;
}): Promise<{ deleted: boolean }> {
	const result = await db
		.update(listing)
		.set({ deletedAt: new Date(), updatedAt: new Date() })
		.where(
			and(
				eq(listing.id, input.listingId),
				eq(listing.organizationId, input.organizationId),
				isNull(listing.deletedAt),
			),
		)
		.returning({ id: listing.id });
	return { deleted: result.length > 0 };
}
