// packages/api/modules/vendors/procedures/create-contact.ts
//
// Add a contact to an existing vendor. adminOrgProcedure -- contact list shapes who
// can be assigned to vendor-fulfilled steps in runs (per ADR-007 + D-023:
// participant.vendorContactId is required, and the tokenized run portal is scoped to
// the specific contact).

import { ORPCError } from "@orpc/server";
import { createVendorContact, writeAuditAndActivity } from "@virn/database";
import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";

export const createContact = adminOrgProcedure
	.route({
		method: "POST",
		path: "/vendors/{vendorId}/contacts",
		tags: ["Vendors"],
		summary: "Add a contact to a vendor (admin/owner only)",
		description:
			"Creates a contact under the vendor. If isPrimary=true, demotes any other primary contact of the same vendor in the same transaction (at-most-one-primary invariant). Audit-logs 'vendor_contact.created'.",
	})
	.input(
		z.object({
			vendorId: z.string().min(1),
			name: z.string().min(1).max(160),
			email: z.string().email(),
			phone: z.string().max(80).nullish(),
			role: z.string().max(120).nullish(),
			isPrimary: z.boolean().optional(),
		}),
	)
	.handler(async ({ context, input }) => {
		const result = await createVendorContact({
			organizationId: context.organization.id,
			vendorId: input.vendorId,
			name: input.name,
			email: input.email,
			phone: input.phone ?? null,
			role: input.role ?? null,
			isPrimary: input.isPrimary,
		});
		if (!result) {
			throw new ORPCError("NOT_FOUND", { message: "Vendor not found." });
		}

		await writeAuditAndActivity({
			organizationId: context.organization.id,
			actorUserId: context.user.id,
			action: "vendor_contact.created",
			verb: "added contact to",
			entityType: "vendor",
			entityId: input.vendorId,
			changes: {
				contactId: result.id,
				name: result.name,
				email: result.email,
				isPrimary: result.isPrimary,
			},
			activityData: { contactName: result.name },
		});

		return result;
	});
