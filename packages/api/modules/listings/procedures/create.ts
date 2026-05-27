// packages/api/modules/listings/procedures/create.ts
//
// Create an org-scoped listing. adminOrgProcedure — listings show up in run launcher
// pickers and entity-set membership rolls (Phase 9.5 days 3–5), so we gate mutations
// on admin/owner to match the vendor/agent pattern. Loosen later if dogfood shows
// this is friction.

import { ORPCError } from "@orpc/server";
import { createListing, writeAuditAndActivity } from "@virn/database";
import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";

export const create = adminOrgProcedure
	.route({
		method: "POST",
		path: "/listings",
		tags: ["Listings"],
		summary: "Create a listing (admin/owner only)",
		description:
			"Creates an org-scoped listing — a single unit the org manages (vacation rental, leased apartment, commercial suite, multifamily unit). propertyType is free text in v1.5 (cohort membership via entity_set is the canonical categorization). address is opaque jsonb. externalListingId is for cross-system sync (Hospitable, Guesty, OwnerRez, AppFolio, etc.) and is unique per (org, source) when set. Audit-logs 'listing.created'.",
	})
	.input(
		z.object({
			name: z.string().min(1).max(200),
			description: z.string().max(2000).nullish(),
			propertyType: z.string().max(60).nullish(),
			address: z.record(z.string(), z.unknown()).nullish(),
			externalListingId: z.string().max(200).nullish(),
		}),
	)
	.handler(async ({ context, input }) => {
		try {
			const result = await createListing({
				organizationId: context.organization.id,
				name: input.name,
				description: input.description ?? null,
				propertyType: input.propertyType ?? null,
				address: input.address ?? null,
				externalListingId: input.externalListingId ?? null,
				createdByUserId: context.user.id,
			});

			await writeAuditAndActivity({
				organizationId: context.organization.id,
				actorUserId: context.user.id,
				action: "listing.created",
				verb: "created",
				entityType: "listing",
				entityId: result.id,
				changes: {
					name: result.name,
					description: result.description,
					propertyType: result.propertyType,
					externalListingId: result.externalListingId,
				},
				activityData: { listingName: result.name },
			});

			return result;
		} catch (e) {
			// Partial UNIQUE index on (organizationId, externalListingId) when populated.
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
