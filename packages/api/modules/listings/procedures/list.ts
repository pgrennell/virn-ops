// packages/api/modules/listings/procedures/list.ts
//
// List non-soft-deleted listings in the active org. protectedOrgProcedure — any org
// member can read (operators need this for run launching, picker UIs, the /library/
// listings index). Mutations are admin/owner only — see other procedures in this dir.

import { listListingsForOrg } from "@virn/database";

import { protectedOrgProcedure } from "../../../orpc/procedures";

export const list = protectedOrgProcedure
	.route({
		method: "GET",
		path: "/listings",
		tags: ["Listings"],
		summary: "List listings in the active organization",
		description:
			"Returns one row per non-soft-deleted listing, alphabetical by name. Shape: id, name, description, propertyType, address (jsonb), externalListingId, createdBy. Read access for any org member; mutations are admin/owner only.",
	})
	.handler(async ({ context }) => {
		return await listListingsForOrg(context.organization.id);
	});
