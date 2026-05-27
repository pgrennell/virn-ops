// packages/api/modules/entitysets/procedures/list.ts
//
// List entity sets in the active org. Any member can read; only admins mutate (see
// create/update/delete). Optional `entityType` narrows to one polymorphic kind (in v1.5
// the only registered value is `'listing'`).

import { listEntitySetsForOrg } from "@virn/database";
import { z } from "zod";

import { protectedOrgProcedure } from "../../../orpc/procedures";

export const list = protectedOrgProcedure
	.route({
		method: "GET",
		path: "/entity-sets",
		tags: ["EntitySets"],
		summary: "List entity sets in the active organization",
		description:
			"Returns all entity sets in the org, optionally narrowed by entity type. Includes a memberCount on each for picker UIs that want to show 'STR penthouses (12 listings)'.",
	})
	.input(
		z
			.object({
				entityType: z.enum(["listing"]).optional(),
			})
			.optional(),
	)
	.handler(async ({ context, input }) => {
		return await listEntitySetsForOrg({
			organizationId: context.organization.id,
			entityType: input?.entityType,
		});
	});
