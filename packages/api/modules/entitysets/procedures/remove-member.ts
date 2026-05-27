// packages/api/modules/entitysets/procedures/remove-member.ts
//
// Remove a polymorphic membership. Idempotent: removing an already-gone member returns
// `{ removed: false }` without erroring.

import { removeEntitySetMember } from "@virn/database";
import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";
import { REGISTERED_ENTITY_TYPES } from "../../entities/adapters";

const ENTITY_TYPE_ENUM = z.enum(REGISTERED_ENTITY_TYPES as [string, ...string[]]);

export const removeMember = adminOrgProcedure
	.route({
		method: "DELETE",
		path: "/entity-sets/{entitySetId}/members/{entityType}/{entityId}",
		tags: ["EntitySets"],
		summary: "Remove an entity from a set (admin/owner only)",
	})
	.input(
		z.object({
			entitySetId: z.string().min(1),
			entityType: ENTITY_TYPE_ENUM,
			entityId: z.string().min(1),
		}),
	)
	.handler(async ({ context, input }) => {
		const result = await removeEntitySetMember({
			organizationId: context.organization.id,
			entitySetId: input.entitySetId,
			entityType: input.entityType as "listing",
			entityId: input.entityId,
		});
		return { removed: result.removed };
	});
