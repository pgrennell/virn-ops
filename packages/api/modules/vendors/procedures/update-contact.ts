// packages/api/modules/vendors/procedures/update-contact.ts
//
// Patch a contact's mutable fields. adminOrgProcedure. Supports name / email / phone /
// role / isPrimary / isActive. When isPrimary flips to true, other contacts of the
// same vendor are demoted in the same transaction (service-layer invariant: at most
// one primary contact per vendor). isActive=false is the soft-disable path -- the
// contact stays in the DB for historical participant joins but is filtered out of
// future picker selections.

import { ORPCError } from "@orpc/server";
import { updateVendorContact, writeAuditAndActivity } from "@virn/database";
import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";

export const updateContact = adminOrgProcedure
	.route({
		method: "PATCH",
		path: "/vendors/{vendorId}/contacts/{contactId}",
		tags: ["Vendors"],
		summary: "Update a vendor contact (admin/owner only)",
		description:
			"Patches name, email, phone, role, isPrimary, or isActive. Audit-logs 'vendor_contact.updated'.",
	})
	.input(
		z.object({
			vendorId: z.string().min(1),
			contactId: z.string().min(1),
			name: z.string().min(1).max(160).optional(),
			email: z.string().email().optional(),
			phone: z.string().max(80).nullish(),
			role: z.string().max(120).nullish(),
			isPrimary: z.boolean().optional(),
			isActive: z.boolean().optional(),
		}),
	)
	.handler(async ({ context, input }) => {
		const { vendorId, contactId, ...patch } = input;
		const result = await updateVendorContact({
			organizationId: context.organization.id,
			vendorId,
			contactId,
			name: patch.name,
			email: patch.email,
			phone: patch.phone ?? undefined,
			role: patch.role ?? undefined,
			isPrimary: patch.isPrimary,
			isActive: patch.isActive,
		});
		if (!result) {
			throw new ORPCError("NOT_FOUND", { message: "Vendor or contact not found." });
		}

		await writeAuditAndActivity({
			organizationId: context.organization.id,
			actorUserId: context.user.id,
			action: "vendor_contact.updated",
			verb: "updated contact for",
			entityType: "vendor",
			entityId: vendorId,
			changes: { contactId, ...patch },
			activityData: { contactName: result.name },
		});

		return result;
	});
