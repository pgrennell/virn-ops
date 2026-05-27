// packages/database/drizzle/queries/vendors.ts
//
// Definition-layer DB helpers for org-scoped vendors (ADR-007 + D-023). Vendor identity
// lives here (long-lived, with multiple contacts); per-run binding is
// `participant.kind='vendor'` + `vendorId` + `vendorContactId` (runs.ts schema).
//
// Vendor authn happens via the existing per-run tokenized-link mechanism (no
// credentialHash like agents — vendor contacts get a tokenized run-portal link the same
// way guests do). Per ADR-007 / D-023: the participant CHECK requires BOTH vendorId AND
// vendorContactId, so a vendor without at least one contact can't be assigned to a run.
//
// Categories + per-vendor capability grants + the cross-product linkedPmVendorId
// surfacing are deliberately deferred to follow-up passes — v1 vendor CRUD focuses on
// the core entity + contacts so launcher integration (next chunk) has something to
// pick from.

import { and, eq, isNull } from "drizzle-orm";

import { db } from "../client";
import { vendor, vendorContact } from "../schema/postgres";

// ---------------------------------------------------------------------------
// Vendor CRUD
// ---------------------------------------------------------------------------

/** Operational state of a vendor (mirrors the pgEnum in schema/vendors.ts). */
export type VendorStatus =
	| "active"
	| "preferred"
	| "approved"
	| "under_review"
	| "probation"
	| "blacklisted";

export interface VendorContactRow {
	id: string;
	name: string;
	email: string;
	phone: string | null;
	role: string | null;
	isPrimary: boolean;
	isActive: boolean;
	createdAt: Date;
	updatedAt: Date;
}

export interface VendorListRow {
	id: string;
	name: string;
	description: string | null;
	categoryId: string | null;
	status: VendorStatus;
	isActive: boolean;
	linkedPmVendorId: string | null;
	createdByUserId: string | null;
	createdByUserName: string | null;
	contactCount: number;
	primaryContactName: string | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface VendorDetailRow extends VendorListRow {
	contacts: VendorContactRow[];
}

/** List non-soft-deleted vendors in the org, oldest first. Includes a denormalized
 * `contactCount` + `primaryContactName` so the list UI can display "X contacts" + the
 * primary contact's name without a follow-up query per row.
 *
 * Used by the admin vendor-management UI and (post-this-chunk) by the launcher's
 * vendor picker, which composes an `isActive=true ∧ contactCount>0 ∧ status!=blacklisted`
 * filter on top. */
export async function listVendorsForOrg(organizationId: string): Promise<VendorListRow[]> {
	const rows = await db.query.vendor.findMany({
		where: (v, { and: andOp, eq: eqOp, isNull: isNullOp }) =>
			andOp(eqOp(v.organizationId, organizationId), isNullOp(v.deletedAt)),
		orderBy: (v, { asc: ascOp }) => [ascOp(v.createdAt)],
		with: {
			createdBy: { columns: { id: true, name: true } },
			contacts: {
				columns: {
					id: true,
					name: true,
					isPrimary: true,
					isActive: true,
				},
			},
		},
	});
	return rows.map((r) => {
		const contacts = r.contacts ?? [];
		const primary = contacts.find((c) => c.isPrimary && c.isActive) ?? null;
		return {
			id: r.id,
			name: r.name,
			description: r.description,
			categoryId: r.categoryId,
			status: r.status as VendorStatus,
			isActive: r.isActive,
			linkedPmVendorId: r.linkedPmVendorId,
			createdByUserId: r.createdByUserId,
			createdByUserName: r.createdBy?.name ?? null,
			contactCount: contacts.length,
			primaryContactName: primary?.name ?? null,
			createdAt: r.createdAt,
			updatedAt: r.updatedAt,
		};
	});
}

/** Fetch a single vendor scoped to the org, including all contacts. Returns null if
 * not found, soft-deleted, or cross-org. */
export async function getVendorForOrg(
	organizationId: string,
	vendorId: string,
): Promise<VendorDetailRow | null> {
	const r = await db.query.vendor.findFirst({
		where: (v, { and: andOp, eq: eqOp, isNull: isNullOp }) =>
			andOp(
				eqOp(v.id, vendorId),
				eqOp(v.organizationId, organizationId),
				isNullOp(v.deletedAt),
			),
		with: {
			createdBy: { columns: { id: true, name: true } },
			contacts: true,
		},
	});
	if (!r) return null;
	const contacts: VendorContactRow[] = (r.contacts ?? []).map((c) => ({
		id: c.id,
		name: c.name,
		email: c.email,
		phone: c.phone,
		role: c.role,
		isPrimary: c.isPrimary,
		isActive: c.isActive,
		createdAt: c.createdAt,
		updatedAt: c.updatedAt,
	}));
	const primary = contacts.find((c) => c.isPrimary && c.isActive) ?? null;
	return {
		id: r.id,
		name: r.name,
		description: r.description,
		categoryId: r.categoryId,
		status: r.status as VendorStatus,
		isActive: r.isActive,
		linkedPmVendorId: r.linkedPmVendorId,
		createdByUserId: r.createdByUserId,
		createdByUserName: r.createdBy?.name ?? null,
		contactCount: contacts.length,
		primaryContactName: primary?.name ?? null,
		createdAt: r.createdAt,
		updatedAt: r.updatedAt,
		contacts,
	};
}

export interface CreateVendorInput {
	organizationId: string;
	name: string;
	description?: string | null;
	categoryId?: string | null;
	status?: VendorStatus;
	createdByUserId: string;
}

export async function createVendor(input: CreateVendorInput): Promise<VendorDetailRow> {
	const [row] = await db
		.insert(vendor)
		.values({
			organizationId: input.organizationId,
			name: input.name,
			description: input.description ?? null,
			categoryId: input.categoryId ?? null,
			status: input.status ?? "active",
			createdByUserId: input.createdByUserId,
		})
		.returning({ id: vendor.id });

	const detail = await getVendorForOrg(input.organizationId, row.id);
	if (!detail) {
		// Defensive: createVendor in the same tx as the SELECT — if this happens the row
		// was concurrently deleted by another writer, which is not a real path in v1.
		throw new Error("Vendor created but immediately not findable — concurrent delete?");
	}
	return detail;
}

export interface UpdateVendorInput {
	organizationId: string;
	vendorId: string;
	name?: string;
	description?: string | null;
	categoryId?: string | null;
	status?: VendorStatus;
	isActive?: boolean;
}

/** Patch a vendor's mutable fields. Returns null if the vendor doesn't exist (or isn't
 * in this org / is soft-deleted), otherwise the updated row with contacts. */
export async function updateVendor(input: UpdateVendorInput): Promise<VendorDetailRow | null> {
	const patch: Record<string, unknown> = { updatedAt: new Date() };
	if (input.name !== undefined) patch.name = input.name;
	if (input.description !== undefined) patch.description = input.description;
	if (input.categoryId !== undefined) patch.categoryId = input.categoryId;
	if (input.status !== undefined) patch.status = input.status;
	if (input.isActive !== undefined) patch.isActive = input.isActive;

	const result = await db
		.update(vendor)
		.set(patch)
		.where(
			and(
				eq(vendor.id, input.vendorId),
				eq(vendor.organizationId, input.organizationId),
				isNull(vendor.deletedAt),
			),
		)
		.returning({ id: vendor.id });
	if (result.length === 0) return null;
	return await getVendorForOrg(input.organizationId, input.vendorId);
}

/** Soft-delete a vendor (sets deletedAt + isActive=false). Historical `participant`
 * rows pointing at the vendor are preserved via the ON DELETE RESTRICT FK — past
 * activity entries still show "Acme Pest Control (Mike) completed Step 3". New vendor
 * selection in the launcher fails after delete. Idempotent. */
export async function softDeleteVendor(input: {
	organizationId: string;
	vendorId: string;
}): Promise<{ deleted: boolean }> {
	const now = new Date();
	const result = await db
		.update(vendor)
		.set({ deletedAt: now, updatedAt: now, isActive: false })
		.where(
			and(
				eq(vendor.id, input.vendorId),
				eq(vendor.organizationId, input.organizationId),
				isNull(vendor.deletedAt),
			),
		)
		.returning({ id: vendor.id });
	return { deleted: result.length > 0 };
}

// ---------------------------------------------------------------------------
// Vendor contact CRUD
//
// Contacts are a 1:N children of vendor. Per ADR-007 + D-023, the participant CHECK
// requires (vendorId, vendorContactId) both populated — so contacts are functionally
// required before a vendor can be assigned to a run.
//
// "At most one primary contact per vendor" is a service-layer invariant: when a write
// sets isPrimary=true, this layer unsets isPrimary on the other contacts of the same
// vendor in a transaction. The DB doesn't enforce this with a partial unique index in
// v1 (could be added later if needed).
// ---------------------------------------------------------------------------

/** Verify that a vendor exists in the org (and isn't soft-deleted). Used by the contact
 * procedures to enforce parent ownership before any contact mutation lands. */
async function vendorBelongsToOrg(organizationId: string, vendorId: string): Promise<boolean> {
	const r = await db.query.vendor.findFirst({
		where: (v, { and: andOp, eq: eqOp, isNull: isNullOp }) =>
			andOp(
				eqOp(v.id, vendorId),
				eqOp(v.organizationId, organizationId),
				isNullOp(v.deletedAt),
			),
		columns: { id: true },
	});
	return r !== undefined && r !== null;
}

export interface CreateVendorContactInput {
	organizationId: string;
	vendorId: string;
	name: string;
	email: string;
	phone?: string | null;
	role?: string | null;
	isPrimary?: boolean;
}

/** Create a new contact for a vendor. If `isPrimary=true`, all other contacts of the
 * same vendor are demoted to `isPrimary=false` in the same transaction (at-most-one
 * primary invariant). Returns null if the parent vendor doesn't exist / is soft-deleted
 * / is in another org. */
export async function createVendorContact(
	input: CreateVendorContactInput,
): Promise<VendorContactRow | null> {
	const parentExists = await vendorBelongsToOrg(input.organizationId, input.vendorId);
	if (!parentExists) return null;

	const isPrimary = input.isPrimary ?? false;

	return await db.transaction(async (tx) => {
		if (isPrimary) {
			await tx
				.update(vendorContact)
				.set({ isPrimary: false, updatedAt: new Date() })
				.where(eq(vendorContact.vendorId, input.vendorId));
		}
		const [row] = await tx
			.insert(vendorContact)
			.values({
				vendorId: input.vendorId,
				name: input.name,
				email: input.email,
				phone: input.phone ?? null,
				role: input.role ?? null,
				isPrimary,
			})
			.returning();
		return {
			id: row.id,
			name: row.name,
			email: row.email,
			phone: row.phone,
			role: row.role,
			isPrimary: row.isPrimary,
			isActive: row.isActive,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
		};
	});
}

export interface UpdateVendorContactInput {
	organizationId: string;
	vendorId: string;
	contactId: string;
	name?: string;
	email?: string;
	phone?: string | null;
	role?: string | null;
	isPrimary?: boolean;
	isActive?: boolean;
}

/** Patch a contact's mutable fields. If `isPrimary` flips to `true`, all other contacts
 * of the same vendor are demoted in the same transaction. Returns null if the parent
 * vendor doesn't exist or the contact doesn't belong to it. */
export async function updateVendorContact(
	input: UpdateVendorContactInput,
): Promise<VendorContactRow | null> {
	const parentExists = await vendorBelongsToOrg(input.organizationId, input.vendorId);
	if (!parentExists) return null;

	const patch: Record<string, unknown> = { updatedAt: new Date() };
	if (input.name !== undefined) patch.name = input.name;
	if (input.email !== undefined) patch.email = input.email;
	if (input.phone !== undefined) patch.phone = input.phone;
	if (input.role !== undefined) patch.role = input.role;
	if (input.isPrimary !== undefined) patch.isPrimary = input.isPrimary;
	if (input.isActive !== undefined) patch.isActive = input.isActive;

	return await db.transaction(async (tx) => {
		if (input.isPrimary === true) {
			// Demote all other contacts of the same vendor first.
			await tx
				.update(vendorContact)
				.set({ isPrimary: false, updatedAt: new Date() })
				.where(eq(vendorContact.vendorId, input.vendorId));
		}
		const result = await tx
			.update(vendorContact)
			.set(patch)
			.where(
				and(eq(vendorContact.id, input.contactId), eq(vendorContact.vendorId, input.vendorId)),
			)
			.returning();
		if (result.length === 0) return null;
		const row = result[0];
		return {
			id: row.id,
			name: row.name,
			email: row.email,
			phone: row.phone,
			role: row.role,
			isPrimary: row.isPrimary,
			isActive: row.isActive,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
		};
	});
}
