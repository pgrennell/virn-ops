// packages/api/modules/listings/procedures/get.ts
//
// Single-listing fetch scoped to the active org. protectedOrgProcedure — read access
// for any org member. Returns NOT_FOUND for missing / soft-deleted / cross-org; uniform
// response prevents cross-org existence probing (same posture as agents.get + vendors.get).

import { ORPCError } from "@orpc/server";
import { getListingForOrg } from "@virn/database";
import { z } from "zod";

import { protectedOrgProcedure } from "../../../orpc/procedures";

export const get = protectedOrgProcedure
	.route({
		method: "GET",
		path: "/listings/{id}",
		tags: ["Listings"],
		summary: "Get a single listing by id",
		description:
			"Returns the listing row scoped to the active org. NOT_FOUND if missing, soft-deleted, or in another org — uniform response prevents cross-org existence probing.",
	})
	.input(
		z.object({
			id: z.string().min(1),
		}),
	)
	.handler(async ({ context, input }) => {
		const listing = await getListingForOrg(context.organization.id, input.id);
		if (!listing) {
			throw new ORPCError("NOT_FOUND", { message: "Listing not found." });
		}
		return listing;
	});
