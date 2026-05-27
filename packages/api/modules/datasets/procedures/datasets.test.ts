// packages/api/modules/datasets/procedures/datasets.test.ts
//
// Procedure-level tests for the data set CRUD surface (Phase 9a, S-02). Mirrors the
// agent/vendor test pattern: auth gates + happy paths. @virn/database mocked.

import { call } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@virn/auth", () => ({
	auth: { api: { getSession: vi.fn() } },
}));

vi.mock("@virn/database", () => ({
	getOrganizationMembership: vi.fn(),
	listDataSetsForOrg: vi.fn(),
	getDataSetForOrg: vi.fn(),
	getDataSetByKey: vi.fn(),
	createDataSet: vi.fn(),
	updateDataSet: vi.fn(),
	archiveDataSet: vi.fn(),
	createDataSetRecord: vi.fn(),
	updateDataSetRecord: vi.fn(),
	deleteDataSetRecord: vi.fn(),
	writeAuditAndActivity: vi.fn(),
}));

import { auth } from "@virn/auth";
import {
	archiveDataSet,
	createDataSet,
	createDataSetRecord,
	deleteDataSetRecord,
	getDataSetByKey,
	getDataSetForOrg,
	getOrganizationMembership,
	listDataSetsForOrg,
	updateDataSet,
	updateDataSetRecord,
	writeAuditAndActivity,
} from "@virn/database";

import { archive } from "./archive";
import { create } from "./create";
import { createRecord } from "./create-record";
import { deleteRecord } from "./delete-record";
import { get } from "./get";
import { getByKey } from "./get-by-key";
import { list } from "./list";
import { update } from "./update";
import { updateRecord } from "./update-record";

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

function makeMembership(role: "owner" | "admin" | "member" = "admin") {
	return { organization: { id: "org-1", name: "Org", slug: "org" }, role };
}

function makeDataSetDetail() {
	return {
		id: "ds_1",
		key: "room-types",
		name: "Room types",
		description: null,
		status: "active" as const,
		recordCount: 0,
		createdAt: new Date(),
		updatedAt: new Date(),
		records: [],
	};
}

function makeRecord() {
	return {
		id: "rec_1",
		label: "Studio",
		value: { sqft: 400 },
		createdAt: new Date(),
		updatedAt: new Date(),
	};
}

describe("data sets -- auth gate", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(auth.api.getSession).mockResolvedValue(makeSession() as never);
		vi.mocked(getOrganizationMembership).mockResolvedValue(makeMembership() as never);
	});

	it("list throws UNAUTHORIZED with no session", async () => {
		vi.mocked(auth.api.getSession).mockResolvedValueOnce(null);
		await expect(call(list, {}, ctx)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
	});

	it("create throws FORBIDDEN for plain members", async () => {
		vi.mocked(getOrganizationMembership).mockResolvedValueOnce(makeMembership("member") as never);
		await expect(
			call(create, { key: "k", name: "n" }, ctx),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});

	it("update throws FORBIDDEN for plain members", async () => {
		vi.mocked(getOrganizationMembership).mockResolvedValueOnce(makeMembership("member") as never);
		await expect(
			call(update, { id: "ds_1", name: "x" }, ctx),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});

	it("archive throws FORBIDDEN for plain members", async () => {
		vi.mocked(getOrganizationMembership).mockResolvedValueOnce(makeMembership("member") as never);
		await expect(
			call(archive, { id: "ds_1" }, ctx),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});

	it("createRecord throws FORBIDDEN for plain members", async () => {
		vi.mocked(getOrganizationMembership).mockResolvedValueOnce(makeMembership("member") as never);
		await expect(
			call(createRecord, { dataSetId: "ds_1", label: "Studio" }, ctx),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});

	it("list + get + getByKey work for plain members (read access)", async () => {
		vi.mocked(getOrganizationMembership).mockResolvedValue(makeMembership("member") as never);
		vi.mocked(listDataSetsForOrg).mockResolvedValueOnce([]);
		await expect(call(list, {}, ctx)).resolves.toEqual([]);

		vi.mocked(getDataSetForOrg).mockResolvedValueOnce(makeDataSetDetail() as never);
		await expect(call(get, { id: "ds_1" }, ctx)).resolves.toMatchObject({ id: "ds_1" });

		vi.mocked(getDataSetByKey).mockResolvedValueOnce(makeDataSetDetail() as never);
		await expect(call(getByKey, { key: "room-types" }, ctx)).resolves.toMatchObject({
			key: "room-types",
		});
	});
});

describe("data sets -- happy paths", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(auth.api.getSession).mockResolvedValue(makeSession() as never);
		vi.mocked(getOrganizationMembership).mockResolvedValue(makeMembership() as never);
	});

	it("create returns the new data set + audit-logs data_set.created", async () => {
		const row = makeDataSetDetail();
		vi.mocked(createDataSet).mockResolvedValueOnce(row as never);

		const res = await call(create, { key: "room-types", name: "Room types" }, ctx);
		expect(res.id).toBe("ds_1");
		expect(writeAuditAndActivity).toHaveBeenCalledWith(
			expect.objectContaining({ action: "data_set.created", entityId: "ds_1" }),
		);
	});

	it("create maps UNIQUE constraint violation to CONFLICT", async () => {
		vi.mocked(createDataSet).mockRejectedValueOnce(
			new Error('duplicate key value violates unique constraint "uq_data_set_org_key"'),
		);
		await expect(
			call(create, { key: "room-types", name: "x" }, ctx),
		).rejects.toMatchObject({ code: "CONFLICT" });
	});

	it("create rejects keys that don't match the [a-z][a-z0-9-]* shape", async () => {
		// `vi.mocked(createDataSet).mockResolvedValue(...)` not needed -- zod refuses first.
		await expect(
			call(create, { key: "Room Types", name: "x" }, ctx),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		await expect(
			call(create, { key: "0bad-start", name: "x" }, ctx),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});

	it("update returns the updated row + audit-logs data_set.updated", async () => {
		const updated = { ...makeDataSetDetail(), name: "Room categories" };
		vi.mocked(updateDataSet).mockResolvedValueOnce(updated as never);

		const res = await call(update, { id: "ds_1", name: "Room categories" }, ctx);
		expect(res.name).toBe("Room categories");
		expect(writeAuditAndActivity).toHaveBeenCalledWith(
			expect.objectContaining({ action: "data_set.updated", entityId: "ds_1" }),
		);
	});

	it("update throws NOT_FOUND when the data set is missing", async () => {
		vi.mocked(updateDataSet).mockResolvedValueOnce(null);
		await expect(
			call(update, { id: "missing", name: "x" }, ctx),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("archive returns archived:true + audit-logs data_set.archived", async () => {
		vi.mocked(archiveDataSet).mockResolvedValueOnce({ archived: true });
		const res = await call(archive, { id: "ds_1" }, ctx);
		expect(res).toEqual({ archived: true });
		expect(writeAuditAndActivity).toHaveBeenCalledWith(
			expect.objectContaining({ action: "data_set.archived", entityId: "ds_1" }),
		);
	});

	it("archive throws NOT_FOUND when the data set is already archived / missing", async () => {
		vi.mocked(archiveDataSet).mockResolvedValueOnce({ archived: false });
		await expect(
			call(archive, { id: "missing" }, ctx),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("createRecord returns the record + audit-logs data_set_record.created", async () => {
		const rec = makeRecord();
		vi.mocked(createDataSetRecord).mockResolvedValueOnce(rec as never);

		const res = await call(
			createRecord,
			{ dataSetId: "ds_1", label: "Studio", value: { sqft: 400 } },
			ctx,
		);
		expect(res.id).toBe("rec_1");
		expect(writeAuditAndActivity).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "data_set_record.created",
				entityId: "ds_1",
			}),
		);
	});

	it("createRecord throws NOT_FOUND when parent data set doesn't exist", async () => {
		vi.mocked(createDataSetRecord).mockResolvedValueOnce(null);
		await expect(
			call(createRecord, { dataSetId: "missing", label: "x" }, ctx),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("updateRecord returns the updated record + audit-logs data_set_record.updated", async () => {
		const updated = { ...makeRecord(), label: "Studio Loft" };
		vi.mocked(updateDataSetRecord).mockResolvedValueOnce(updated as never);

		const res = await call(
			updateRecord,
			{ dataSetId: "ds_1", recordId: "rec_1", label: "Studio Loft" },
			ctx,
		);
		expect(res.label).toBe("Studio Loft");
		expect(writeAuditAndActivity).toHaveBeenCalledWith(
			expect.objectContaining({ action: "data_set_record.updated", entityId: "ds_1" }),
		);
	});

	it("deleteRecord returns deleted:true + audit-logs data_set_record.deleted", async () => {
		vi.mocked(deleteDataSetRecord).mockResolvedValueOnce({ deleted: true });
		const res = await call(deleteRecord, { dataSetId: "ds_1", recordId: "rec_1" }, ctx);
		expect(res).toEqual({ deleted: true });
		expect(writeAuditAndActivity).toHaveBeenCalledWith(
			expect.objectContaining({ action: "data_set_record.deleted", entityId: "ds_1" }),
		);
	});

	it("deleteRecord throws NOT_FOUND when the record is missing / already deleted", async () => {
		vi.mocked(deleteDataSetRecord).mockResolvedValueOnce({ deleted: false });
		await expect(
			call(deleteRecord, { dataSetId: "ds_1", recordId: "missing" }, ctx),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});
