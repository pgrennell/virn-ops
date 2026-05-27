// packages/api/modules/entitysets/procedures/list-members.ts
//
// List the (entityType, entityId, createdAt) tuples currently in a given set. The entity
// detail (name etc.) is intentionally NOT joined here -- callers that want display data
// resolve via the EntityAdapter on the client (or hit `listings.get` etc. directly).
// Keeps the membership endpoint cheap and type-agnostic.

import { listMembersForEntitySet } from "@virn/database";
import { z } from "zod";

import { protectedOrgProcedure } from "../../../orpc/procedures";

export const listMembers = protectedOrgProcedure
	.route({
		method: "GET",
		path: "/entity-sets/{entitySetId}/members",
		tags: ["EntitySets"],
		summary: "List members of an entity set",
	})
	.input(z.object({ entitySetId: z.string().min(1) }))
	.handler(async ({ context, input }) => {
		return await listMembersForEntitySet({
			organizationId: context.organization.id,
			entitySetId: input.entitySetId,
		});
	});
