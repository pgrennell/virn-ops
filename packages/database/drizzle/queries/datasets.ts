// packages/database/drizzle/queries/datasets.ts
//
// Data sets (BUILD_PLAN.md Phase 9, STRATEGY S-02). Promoted from "schema reserved /
// deferred" in Batch 7. Org-scoped named lists that `lookup` fields point at by
// stable `key`.
//
// v1 record convention (per BUILD_PLAN Phase 9):
//   - Each `data_set_record.values` is a jsonb object of shape { label: string,
//     value?: unknown }.
//   - `label` is the user-visible name and the typeahead match target.
//   - `value` is optional structured data the workflow may consume later (merge
//     variables, conditions -- both deferred). For v1 it's just round-tripped.
//   - `data_set_field` rows are NOT used in v1 -- the convention is the schema.
//     When the multi-field record builder ships post-v1, existing single-field
//     records remain valid (the {label, value} shape is a subset).
//
// Idempotency: `uq_data_set_org_key` enforces "one data set per (org, key)".
// Record-level uniqueness (e.g., one record per (data_set, label)) is NOT enforced
// in v1 -- callers may legitimately want duplicate labels; the picker disambiguates
// by record id.

import { and, asc, eq, isNull } from "drizzle-orm";

import { db } from "../client";
import { dataSet, dataSetRecord } from "../schema/postgres";

// ---------------------------------------------------------------------------
// Data set CRUD
// ---------------------------------------------------------------------------

export interface DataSetListRow {
	id: string;
	key: string;
	name: string;
	description: string | null;
	status: "active" | "inactive" | "archived";
	recordCount: number;
	createdAt: Date;
	updatedAt: Date;
}

/** List non-archived data sets in the org, oldest first. Includes a denormalized
 * `recordCount` so the list UI can render counts without a follow-up query per row. */
export async function listDataSetsForOrg(organizationId: string): Promise<DataSetListRow[]> {
	const rows = await db.query.dataSet.findMany({
		where: (ds, { and: a, eq: e, ne }) =>
			a(e(ds.organizationId, organizationId), ne(ds.status, "archived")),
		orderBy: (ds, { asc: ascOp }) => [ascOp(ds.createdAt)],
		with: {
			records: {
				columns: { id: true, deletedAt: true },
			},
		},
	});
	return rows.map((r) => ({
		id: r.id,
		key: r.key,
		name: r.name,
		description: r.description,
		status: r.status,
		recordCount: (r.records ?? []).filter((rec) => rec.deletedAt === null).length,
		createdAt: r.createdAt,
		updatedAt: r.updatedAt,
	}));
}

export interface DataSetRecordRow {
	id: string;
	label: string;
	value: unknown;
	createdAt: Date;
	updatedAt: Date;
}

export interface DataSetDetailRow extends DataSetListRow {
	records: DataSetRecordRow[];
}

/** Extract the v1-convention label + value from a record's `values` jsonb. */
function projectRecord(r: {
	id: string;
	values: Record<string, unknown> | unknown;
	createdAt: Date;
	updatedAt: Date;
}): DataSetRecordRow {
	const v =
		r.values && typeof r.values === "object"
			? (r.values as Record<string, unknown>)
			: {};
	return {
		id: r.id,
		label: typeof v.label === "string" ? v.label : "",
		value: v.value,
		createdAt: r.createdAt,
		updatedAt: r.updatedAt,
	};
}

/** Fetch a single data set scoped to the org, including all non-soft-deleted records.
 * Returns null if missing, archived, or cross-org. */
export async function getDataSetForOrg(
	organizationId: string,
	dataSetId: string,
): Promise<DataSetDetailRow | null> {
	const r = await db.query.dataSet.findFirst({
		where: (ds, { and: a, eq: e, ne }) =>
			a(
				e(ds.id, dataSetId),
				e(ds.organizationId, organizationId),
				ne(ds.status, "archived"),
			),
		with: {
			records: {
				where: (rec, { isNull: n }) => n(rec.deletedAt),
				orderBy: (rec, { asc: ascOp }) => [ascOp(rec.createdAt)],
			},
		},
	});
	if (!r) return null;
	const records = (r.records ?? []).map(projectRecord);
	return {
		id: r.id,
		key: r.key,
		name: r.name,
		description: r.description,
		status: r.status,
		recordCount: records.length,
		createdAt: r.createdAt,
		updatedAt: r.updatedAt,
		records,
	};
}

/** Fetch by stable key (used by the run engine to resolve a lookup field's reference). */
export async function getDataSetByKey(
	organizationId: string,
	key: string,
): Promise<DataSetDetailRow | null> {
	const r = await db.query.dataSet.findFirst({
		where: (ds, { and: a, eq: e, ne }) =>
			a(
				e(ds.organizationId, organizationId),
				e(ds.key, key),
				ne(ds.status, "archived"),
			),
		with: {
			records: {
				where: (rec, { isNull: n }) => n(rec.deletedAt),
				orderBy: (rec, { asc: ascOp }) => [ascOp(rec.createdAt)],
			},
		},
	});
	if (!r) return null;
	const records = (r.records ?? []).map(projectRecord);
	return {
		id: r.id,
		key: r.key,
		name: r.name,
		description: r.description,
		status: r.status,
		recordCount: records.length,
		createdAt: r.createdAt,
		updatedAt: r.updatedAt,
		records,
	};
}

export interface CreateDataSetInput {
	organizationId: string;
	key: string;
	name: string;
	description?: string | null;
}

export async function createDataSet(input: CreateDataSetInput): Promise<DataSetDetailRow> {
	const [row] = await db
		.insert(dataSet)
		.values({
			organizationId: input.organizationId,
			key: input.key,
			name: input.name,
			description: input.description ?? null,
		})
		.returning({ id: dataSet.id });
	const detail = await getDataSetForOrg(input.organizationId, row.id);
	if (!detail) {
		throw new Error("Data set created but immediately not findable -- concurrent delete?");
	}
	return detail;
}

export interface UpdateDataSetInput {
	organizationId: string;
	dataSetId: string;
	key?: string;
	name?: string;
	description?: string | null;
	status?: "active" | "inactive" | "archived";
}

export async function updateDataSet(input: UpdateDataSetInput): Promise<DataSetDetailRow | null> {
	const patch: Record<string, unknown> = { updatedAt: new Date() };
	if (input.key !== undefined) patch.key = input.key;
	if (input.name !== undefined) patch.name = input.name;
	if (input.description !== undefined) patch.description = input.description;
	if (input.status !== undefined) patch.status = input.status;

	const result = await db
		.update(dataSet)
		.set(patch)
		.where(and(eq(dataSet.id, input.dataSetId), eq(dataSet.organizationId, input.organizationId)))
		.returning({ id: dataSet.id });
	if (result.length === 0) return null;
	return await getDataSetForOrg(input.organizationId, input.dataSetId);
}

/** Archive a data set (sets status='archived'). Lookup fields that reference it should
 * surface an "archived data set" warning in the builder; existing run records continue
 * to display the (still-readable) record labels via the run snapshot. */
export async function archiveDataSet(input: {
	organizationId: string;
	dataSetId: string;
}): Promise<{ archived: boolean }> {
	const result = await db
		.update(dataSet)
		.set({ status: "archived", updatedAt: new Date() })
		.where(
			and(
				eq(dataSet.id, input.dataSetId),
				eq(dataSet.organizationId, input.organizationId),
			),
		)
		.returning({ id: dataSet.id });
	return { archived: result.length > 0 };
}

// ---------------------------------------------------------------------------
// Data set records (v1: { label, value? } convention)
// ---------------------------------------------------------------------------

/** Verify the data set exists in the given org and isn't archived. Parent-ownership
 * check before any record mutation. */
async function dataSetBelongsToOrg(organizationId: string, dataSetId: string): Promise<boolean> {
	const r = await db.query.dataSet.findFirst({
		where: (ds, { and: a, eq: e, ne }) =>
			a(
				e(ds.id, dataSetId),
				e(ds.organizationId, organizationId),
				ne(ds.status, "archived"),
			),
		columns: { id: true },
	});
	return r !== undefined && r !== null;
}

export interface CreateDataSetRecordInput {
	organizationId: string;
	dataSetId: string;
	label: string;
	value?: unknown;
}

export async function createDataSetRecord(
	input: CreateDataSetRecordInput,
): Promise<DataSetRecordRow | null> {
	const parentExists = await dataSetBelongsToOrg(input.organizationId, input.dataSetId);
	if (!parentExists) return null;

	const values: Record<string, unknown> = { label: input.label };
	if (input.value !== undefined) values.value = input.value;

	const [row] = await db
		.insert(dataSetRecord)
		.values({ dataSetId: input.dataSetId, values })
		.returning();
	return projectRecord(row);
}

export interface UpdateDataSetRecordInput {
	organizationId: string;
	dataSetId: string;
	recordId: string;
	label?: string;
	value?: unknown;
}

export async function updateDataSetRecord(
	input: UpdateDataSetRecordInput,
): Promise<DataSetRecordRow | null> {
	const parentExists = await dataSetBelongsToOrg(input.organizationId, input.dataSetId);
	if (!parentExists) return null;

	// Read the current values, patch in place, write back. Avoids losing keys the v1
	// convention doesn't know about (forward-compatible with multi-field records when
	// they ship).
	const current = await db.query.dataSetRecord.findFirst({
		where: (r, { and: a, eq: e, isNull: n }) =>
			a(e(r.id, input.recordId), e(r.dataSetId, input.dataSetId), n(r.deletedAt)),
	});
	if (!current) return null;

	const merged: Record<string, unknown> = {
		...(current.values as Record<string, unknown>),
	};
	if (input.label !== undefined) merged.label = input.label;
	if (input.value !== undefined) merged.value = input.value;

	const [row] = await db
		.update(dataSetRecord)
		.set({ values: merged, updatedAt: new Date() })
		.where(eq(dataSetRecord.id, input.recordId))
		.returning();
	if (!row) return null;
	return projectRecord(row);
}

/** Soft-delete a record (set deletedAt). Run field_values that reference this record
 * id remain readable -- but the record won't appear in picker queries for future
 * runs. */
export async function deleteDataSetRecord(input: {
	organizationId: string;
	dataSetId: string;
	recordId: string;
}): Promise<{ deleted: boolean }> {
	const parentExists = await dataSetBelongsToOrg(input.organizationId, input.dataSetId);
	if (!parentExists) return { deleted: false };

	const result = await db
		.update(dataSetRecord)
		.set({ deletedAt: new Date(), updatedAt: new Date() })
		.where(
			and(
				eq(dataSetRecord.id, input.recordId),
				eq(dataSetRecord.dataSetId, input.dataSetId),
				isNull(dataSetRecord.deletedAt),
			),
		)
		.returning({ id: dataSetRecord.id });
	return { deleted: result.length > 0 };
}

/** Validate that a record id belongs to the given data set + org + isn't soft-deleted.
 * Used by setFieldValue to refuse lookups that don't resolve. */
export async function isDataSetRecordValidForOrg(input: {
	organizationId: string;
	dataSetId: string;
	recordId: string;
}): Promise<boolean> {
	const parentExists = await dataSetBelongsToOrg(input.organizationId, input.dataSetId);
	if (!parentExists) return false;
	const r = await db.query.dataSetRecord.findFirst({
		where: (rec, { and: a, eq: e, isNull: n }) =>
			a(
				e(rec.id, input.recordId),
				e(rec.dataSetId, input.dataSetId),
				n(rec.deletedAt),
			),
		columns: { id: true },
	});
	return r !== undefined && r !== null;
}

// Re-export the columnar helpers for unused-import cleanups in tooling.
void asc;
