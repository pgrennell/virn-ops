// packages/api/modules/entitysets/procedures/delete.ts
//
// Hard delete an entity set. Member rows cascade (entity_set_member.entity_set_id has
// ON DELETE CASCADE). Workflows whose `entity_set_ids` array references this set will
// keep the dangling id in the array -- callers should consider this a soft tombstone and
// filter dangling ids at read time. (We don't backfill across all workflows here to keep
// delete cheap; a future cleanup job can sweep stale ids.)

import { ORPCError } from "@orpc/server";
import { deleteEntitySet } from "@virn/database";
import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";

export const remove = adminOrgProcedure
	.route({
		method: "DELETE",
		path: "/entity-sets/{id}",
		tags: ["EntitySets"],
		summary: "Delete an entity set (admin/owner only). Cascades members.",
	})
	.input(z.object({ id: z.string().min(1) }))
	.handler(async ({ context, input }) => {
		const result = await deleteEntitySet({
			organizationId: context.organization.id,
			entitySetId: input.id,
		});
		if (!result.deleted) {
			throw new ORPCError("NOT_FOUND", {
				message: "Entity set not found in this organization (or already deleted).",
			});
		}
		return { deleted: true as const };
	});
