// packages/api/modules/listings/procedures/update.ts
//
// Patch a listing's mutable fields. adminOrgProcedure for consistency with create.ts —
// listings show up in run launcher pickers and entity-set membership, so we gate writes
// on admin/owner to match the vendor/agent pattern.

import { ORPCError } from "@orpc/server";
import { updateListing, writeAuditAndActivity } from "@virn/database";
import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";

export const update = adminOrgProcedure
	.route({
		method: "PATCH",
		path: "/listings/{id}",
		tags: ["Listings"],
		summary: "Update a listing (admin/owner only)",
		description:
			"Patches name, description, propertyType, address, or externalListingId. Audit-logs 'listing.updated'.",
	})
	.input(
		z.object({
			id: z.string().min(1),
			name: z.string().min(1).max(200).optional(),
			description: z.string().max(2000).nullish(),
			propertyType: z.string().max(60).nullish(),
			address: z.record(z.string(), z.unknown()).nullish(),
			externalListingId: z.string().max(200).nullish(),
		}),
	)
	.handler(async ({ context, input }) => {
		const { id, ...patch } = input;
		try {
			const updated = await updateListing({
				organizationId: context.organization.id,
				listingId: id,
				name: patch.name,
				description: patch.description ?? undefined,
				propertyType: patch.propertyType ?? undefined,
				address: patch.address ?? undefined,
				externalListingId: patch.externalListingId ?? undefined,
			});
			if (!updated) {
				throw new ORPCError("NOT_FOUND", { message: "Listing not found." });
			}

			await writeAuditAndActivity({
				organizationId: context.organization.id,
				actorUserId: context.user.id,
				action: "listing.updated",
				verb: "updated",
				entityType: "listing",
				entityId: id,
				changes: patch,
				activityData: { listingName: updated.name },
			});

			return updated;
		} catch (e) {
			if (
				e instanceof Error &&
				/uq_listing_org_external_id|duplicate key/i.test(e.message)
			) {
				throw new ORPCError("CONFLICT", {
					message: `A listing with externalListingId "${input.externalListingId}" already exists in this organization.`,
				});
			}
			throw e;
		}
	});
