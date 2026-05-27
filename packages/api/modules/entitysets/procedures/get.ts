// packages/api/modules/entitysets/procedures/get.ts
//
// Fetch a single entity set by id. Returns NOT_FOUND uniformly for cross-org / missing
// (no existence probing).

import { ORPCError } from "@orpc/server";
import { getEntitySetForOrg } from "@virn/database";
import { z } from "zod";

import { protectedOrgProcedure } from "../../../orpc/procedures";

export const get = protectedOrgProcedure
	.route({
		method: "GET",
		path: "/entity-sets/{id}",
		tags: ["EntitySets"],
		summary: "Get an entity set by id",
	})
	.input(z.object({ id: z.string().min(1) }))
	.handler(async ({ context, input }) => {
		const row = await getEntitySetForOrg({
			organizationId: context.organization.id,
			entitySetId: input.id,
		});
		if (!row) {
			throw new ORPCError("NOT_FOUND", { message: "Entity set not found in this organization." });
		}
		return row;
	});
