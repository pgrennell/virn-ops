// vendors.test.ts
//
// Procedure-level tests for the vendor CRUD surface (Phase 8 follow-on, ADR-007 +
// D-023). Mirrors the agent test pattern: auth gates (UNAUTHORIZED, FORBIDDEN-without-
// org, FORBIDDEN-non-admin) + happy path for each procedure. Database is mocked at the
// @virn/database boundary -- these are unit tests, not end-to-end.

import { call } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@virn/auth", () => ({
	auth: {
		api: { getSession: vi.fn() },
	},
}));

vi.mock("@virn/database", () => ({
	getOrganizationMembership: vi.fn(),
	listVendorsForOrg: vi.fn(),
	getVendorForOrg: vi.fn(),
	createVendor: vi.fn(),
	updateVendor: vi.fn(),
	softDeleteVendor: vi.fn(),
	createVendorContact: vi.fn(),
	updateVendorContact: vi.fn(),
	writeAuditAndActivity: vi.fn(),
	// Phase 11a step 3c part 2 -- vendor.upserted outbox enqueue. Default to
	// "no consumers registered -> empty result"; the chokepoint tests assert
	// the call shape rather than the resulting outbox rows (which the helper's
	// own integration tests cover).
	enqueueCrossProductEventForVendor: vi.fn(async () => []),
}));

import { auth } from "@virn/auth";
import {
	createVendor,
	createVendorContact,
	enqueueCrossProductEventForVendor,
	getOrganizationMembership,
	getVendorForOrg,
	listVendorsForOrg,
	softDeleteVendor,
	updateVendor,
	updateVendorContact,
	writeAuditAndActivity,
} from "@virn/database";

import { create } from "./create";
import { createContact } from "./create-contact";
import { get } from "./get";
import { list } from "./list";
import { softDelete } from "./soft-delete";
import { update } from "./update";
import { updateContact } from "./update-contact";

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
	return {
		organization: { id: "org-1", name: "Org", slug: "org" },
		role,
	};
}

function makeVendorDetail() {
	return {
		id: "v-1",
		name: "Acme Pest Control",
		description: null,
		categoryId: null,
		status: "active" as const,
		isActive: true,
		linkedPmVendorId: null,
		createdByUserId: "user-1",
		createdByUserName: "U",
		contactCount: 0,
		primaryContactName: null,
		createdAt: new Date(),
		updatedAt: new Date(),
		contacts: [],
	};
}

function makeContactRow() {
	return {
		id: "vc-1",
		name: "Mike Smith",
		email: "mike@acme.example",
		phone: null,
		role: null,
		isPrimary: true,
		isActive: true,
		createdAt: new Date(),
		updatedAt: new Date(),
	};
}

describe("vendors procedures -- auth gate", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(auth.api.getSession).mockResolvedValue(makeSession() as never);
		vi.mocked(getOrganizationMembership).mockResolvedValue(makeMembership() as never);
	});

	it("list throws UNAUTHORIZED when there is no session", async () => {
		vi.mocked(auth.api.getSession).mockResolvedValueOnce(null);
		await expect(call(list, {}, ctx)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
	});

	it("list throws FORBIDDEN when there is no active organization", async () => {
		vi.mocked(auth.api.getSession).mockResolvedValueOnce(
			makeSession({ activeOrganizationId: null }) as never,
		);
		await expect(call(list, {}, ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
	});

	it("create throws FORBIDDEN when caller is a plain member", async () => {
		vi.mocked(getOrganizationMembership).mockResolvedValueOnce(makeMembership("member") as never);
		await expect(
			call(create, { name: "Acme Pest Control" }, ctx),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});

	it("update throws FORBIDDEN when caller is a plain member", async () => {
		vi.mocked(getOrganizationMembership).mockResolvedValueOnce(makeMembership("member") as never);
		await expect(
			call(update, { id: "v-1", name: "x" }, ctx),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});

	it("softDelete throws FORBIDDEN when caller is a plain member", async () => {
		vi.mocked(getOrganizationMembership).mockResolvedValueOnce(makeMembership("member") as never);
		await expect(
			call(softDelete, { id: "v-1" }, ctx),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});

	it("createContact throws FORBIDDEN when caller is a plain member", async () => {
		vi.mocked(getOrganizationMembership).mockResolvedValueOnce(makeMembership("member") as never);
		await expect(
			call(
				createContact,
				{ vendorId: "v-1", name: "Mike", email: "mike@acme.example" },
				ctx,
			),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});

	it("updateContact throws FORBIDDEN when caller is a plain member", async () => {
		vi.mocked(getOrganizationMembership).mockResolvedValueOnce(makeMembership("member") as never);
		await expect(
			call(updateContact, { vendorId: "v-1", contactId: "vc-1", name: "x" }, ctx),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});

	it("list works for plain members (read access)", async () => {
		vi.mocked(getOrganizationMembership).mockResolvedValueOnce(makeMembership("member") as never);
		vi.mocked(listVendorsForOrg).mockResolvedValueOnce([]);
		await expect(call(list, {}, ctx)).resolves.toEqual([]);
	});

	it("get works for plain members (read access)", async () => {
		vi.mocked(getOrganizationMembership).mockResolvedValueOnce(makeMembership("member") as never);
		const row = makeVendorDetail();
		vi.mocked(getVendorForOrg).mockResolvedValueOnce(row as never);
		await expect(call(get, { id: "v-1" }, ctx)).resolves.toEqual(row);
	});
});

describe("vendors procedures -- happy paths", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(auth.api.getSession).mockResolvedValue(makeSession() as never);
		vi.mocked(getOrganizationMembership).mockResolvedValue(makeMembership() as never);
	});

	it("create returns the new vendor + audit-logs vendor.created", async () => {
		const row = makeVendorDetail();
		vi.mocked(createVendor).mockResolvedValueOnce(row as never);

		const res = await call(create, { name: "Acme Pest Control" }, ctx);

		expect(res.id).toBe("v-1");
		expect(res.name).toBe("Acme Pest Control");
		expect(writeAuditAndActivity).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "vendor.created",
				entityType: "vendor",
				entityId: "v-1",
			}),
		);
	});

	it("create maps UNIQUE constraint violation to CONFLICT", async () => {
		vi.mocked(createVendor).mockRejectedValueOnce(
			new Error('duplicate key value violates unique constraint "uq_vendor_org_name"'),
		);
		await expect(
			call(create, { name: "Acme Pest Control" }, ctx),
		).rejects.toMatchObject({ code: "CONFLICT" });
	});

	it("update returns the updated row + audit-logs vendor.updated", async () => {
		const updated = { ...makeVendorDetail(), name: "Acme Pest", description: "Renamed" };
		vi.mocked(updateVendor).mockResolvedValueOnce(updated as never);

		const res = await call(update, { id: "v-1", name: "Acme Pest" }, ctx);

		expect(res.name).toBe("Acme Pest");
		expect(writeAuditAndActivity).toHaveBeenCalledWith(
			expect.objectContaining({ action: "vendor.updated", entityId: "v-1" }),
		);
	});

	it("update throws NOT_FOUND when the vendor doesn't exist", async () => {
		vi.mocked(updateVendor).mockResolvedValueOnce(null);
		await expect(
			call(update, { id: "missing", name: "x" }, ctx),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	// Phase 11a step 3c part 2 -- cross-product outbox enqueue. Both the
	// create and update chokepoints fan out a `vendor.upserted` event after
	// the audit write; the helper itself is mocked here, the fan-out logic is
	// covered by its own integration test against a real DB.
	it("create enqueues a vendor.upserted cross-product event", async () => {
		const row = makeVendorDetail();
		vi.mocked(createVendor).mockResolvedValueOnce(row as never);

		await call(create, { name: "Acme Pest Control" }, ctx);

		expect(enqueueCrossProductEventForVendor).toHaveBeenCalledWith(
			expect.objectContaining({
				vendorId: "v-1",
				eventType: "vendor.upserted",
			}),
		);
	});

	it("update enqueues a vendor.upserted cross-product event", async () => {
		const updated = { ...makeVendorDetail(), name: "Acme Pest", description: "Renamed" };
		vi.mocked(updateVendor).mockResolvedValueOnce(updated as never);

		await call(update, { id: "v-1", name: "Acme Pest" }, ctx);

		expect(enqueueCrossProductEventForVendor).toHaveBeenCalledWith(
			expect.objectContaining({
				vendorId: "v-1",
				eventType: "vendor.upserted",
			}),
		);
	});

	it("update does not enqueue when the vendor isn't found (NOT_FOUND short-circuit)", async () => {
		vi.mocked(updateVendor).mockResolvedValueOnce(null);
		await expect(
			call(update, { id: "missing", name: "x" }, ctx),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		expect(enqueueCrossProductEventForVendor).not.toHaveBeenCalled();
	});

	it("softDelete returns deleted:true + audit-logs vendor.deleted", async () => {
		vi.mocked(softDeleteVendor).mockResolvedValueOnce({ deleted: true });

		const res = await call(softDelete, { id: "v-1" }, ctx);

		expect(res).toEqual({ deleted: true });
		expect(writeAuditAndActivity).toHaveBeenCalledWith(
			expect.objectContaining({ action: "vendor.deleted", entityId: "v-1" }),
		);
	});

	it("softDelete throws NOT_FOUND when the vendor doesn't exist (or already deleted)", async () => {
		vi.mocked(softDeleteVendor).mockResolvedValueOnce({ deleted: false });
		await expect(
			call(softDelete, { id: "missing" }, ctx),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("createContact returns the contact + audit-logs vendor_contact.created", async () => {
		const row = makeContactRow();
		vi.mocked(createVendorContact).mockResolvedValueOnce(row as never);

		const res = await call(
			createContact,
			{ vendorId: "v-1", name: "Mike Smith", email: "mike@acme.example", isPrimary: true },
			ctx,
		);

		expect(res.id).toBe("vc-1");
		expect(res.email).toBe("mike@acme.example");
		expect(writeAuditAndActivity).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "vendor_contact.created",
				entityType: "vendor",
				entityId: "v-1",
			}),
		);
	});

	it("createContact throws NOT_FOUND when the parent vendor doesn't exist", async () => {
		vi.mocked(createVendorContact).mockResolvedValueOnce(null);
		await expect(
			call(
				createContact,
				{ vendorId: "missing", name: "Mike", email: "mike@acme.example" },
				ctx,
			),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("updateContact returns the updated contact + audit-logs vendor_contact.updated", async () => {
		const updated = { ...makeContactRow(), name: "Michael Smith" };
		vi.mocked(updateVendorContact).mockResolvedValueOnce(updated as never);

		const res = await call(
			updateContact,
			{ vendorId: "v-1", contactId: "vc-1", name: "Michael Smith" },
			ctx,
		);

		expect(res.name).toBe("Michael Smith");
		expect(writeAuditAndActivity).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "vendor_contact.updated",
				entityId: "v-1",
			}),
		);
	});

	it("updateContact throws NOT_FOUND when contact is missing", async () => {
		vi.mocked(updateVendorContact).mockResolvedValueOnce(null);
		await expect(
			call(
				updateContact,
				{ vendorId: "v-1", contactId: "missing", name: "x" },
				ctx,
			),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});
