// packages/api/modules/listings/procedures/soft-delete.ts
//
// Soft-delete a listing (sets deletedAt). adminOrgProcedure. Historical references in
// run kickoff metadata + (future) entity_set_member rows continue to resolve — the FK
// on entity_set_member is CASCADE to set membership only; runs hold the listing id as
// data, not as a FK. Idempotent.

import { ORPCError } from "@orpc/server";
import { softDeleteListing, writeAuditAndActivity } from "@virn/database";
import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";

export const softDelete = adminOrgProcedure
	.route({
		method: "DELETE",
		path: "/listings/{id}",
		tags: ["Listings"],
		summary: "Soft-delete a listing (admin/owner only)",
		description:
			"Sets deletedAt. Listing disappears from active listings and picker UIs; historical run + activity-feed references continue to resolve. Idempotent. Audit-logs 'listing.deleted'.",
	})
	.input(
		z.object({
			id: z.string().min(1),
		}),
	)
	.handler(async ({ context, input }) => {
		const result = await softDeleteListing({
			organizationId: context.organization.id,
			listingId: input.id,
		});
		if (!result.deleted) {
			// Doesn't exist, cross-org, or already soft-deleted — uniform NOT_FOUND.
			throw new ORPCError("NOT_FOUND", { message: "Listing not found." });
		}

		await writeAuditAndActivity({
			organizationId: context.organization.id,
			actorUserId: context.user.id,
			action: "listing.deleted",
			verb: "deleted",
			entityType: "listing",
			entityId: input.id,
		});

		return { deleted: true };
	});
