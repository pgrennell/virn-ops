// packages/api/modules/entitysets/procedures/list-for-entity.ts
//
// Reverse lookup: which entity sets does (entityType, entityId) belong to? The entity
// detail UI ("show me chip badges for this listing") and the workflow launcher
// ("intersect this entity's sets with each workflow's declared scope") both consume this.

import { listEntitySetsForEntity } from "@virn/database";
import { z } from "zod";

import { protectedOrgProcedure } from "../../../orpc/procedures";
import { REGISTERED_ENTITY_TYPES } from "../../entities/adapters";

const ENTITY_TYPE_ENUM = z.enum(REGISTERED_ENTITY_TYPES as [string, ...string[]]);

export const listForEntity = protectedOrgProcedure
	.route({
		method: "GET",
		path: "/entity-sets/for-entity/{entityType}/{entityId}",
		tags: ["EntitySets"],
		summary: "List entity sets that contain a given entity",
		description:
			"Reverse-lookup endpoint. Used by entity detail panels (chip badges) and by the workflow launcher (set intersection check).",
	})
	.input(
		z.object({
			entityType: ENTITY_TYPE_ENUM,
			entityId: z.string().min(1),
		}),
	)
	.handler(async ({ context, input }) => {
		return await listEntitySetsForEntity({
			organizationId: context.organization.id,
			entityType: input.entityType as "listing",
			entityId: input.entityId,
		});
	});
