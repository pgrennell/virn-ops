// packages/api/modules/vendors/procedures/get.ts
//
// Single-vendor fetch scoped to the active org, INCLUDING all contacts.
// protectedOrgProcedure (read access for any member, same as list). Returns NOT_FOUND
// for missing / soft-deleted / cross-org -- the uniform response prevents
// existence-probing across orgs.

import { ORPCError } from "@orpc/server";
import { getVendorForOrg } from "@virn/database";
import { z } from "zod";

import { protectedOrgProcedure } from "../../../orpc/procedures";

export const get = protectedOrgProcedure
	.route({
		method: "GET",
		path: "/vendors/{id}",
		tags: ["Vendors"],
		summary: "Get a single vendor by id (with contacts)",
		description:
			"Returns the vendor row + its contacts list, scoped to the active org. NOT_FOUND if missing, soft-deleted, or in another org -- uniform response prevents cross-org existence probing.",
	})
	.input(
		z.object({
			id: z.string().min(1),
		}),
	)
	.handler(async ({ context, input }) => {
		const vendor = await getVendorForOrg(context.organization.id, input.id);
		if (!vendor) {
			throw new ORPCError("NOT_FOUND", { message: "Vendor not found." });
		}
		return vendor;
	});
