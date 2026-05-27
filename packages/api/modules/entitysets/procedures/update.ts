// packages/api/modules/entitysets/procedures/update.ts
//
// Patch name / color / description on an entity set. `entityType` is intentionally NOT
// patchable -- changing the type orphans existing members. Returns NOT_FOUND if the set
// doesn't exist (or is cross-org).

import { ORPCError } from "@orpc/server";
import { updateEntitySet } from "@virn/database";
import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";

export const update = adminOrgProcedure
	.route({
		method: "PATCH",
		path: "/entity-sets/{id}",
		tags: ["EntitySets"],
		summary: "Update an entity set's name / color / description (admin/owner only)",
	})
	.input(
		z.object({
			id: z.string().min(1),
			name: z.string().min(1).max(120).optional(),
			color: z.string().max(40).nullish(),
			description: z.string().max(2000).nullish(),
		}),
	)
	.handler(async ({ context, input }) => {
		try {
			const row = await updateEntitySet({
				organizationId: context.organization.id,
				entitySetId: input.id,
				name: input.name,
				color: input.color === undefined ? undefined : input.color,
				description: input.description === undefined ? undefined : input.description,
			});
			if (!row) {
				throw new ORPCError("NOT_FOUND", {
					message: "Entity set not found in this organization.",
				});
			}
			return row;
		} catch (e) {
			if (
				e instanceof Error &&
				/uq_entity_set_org_type_name|duplicate key/i.test(e.message)
			) {
				throw new ORPCError("CONFLICT", {
					message: `Another entity set already uses that name for this type.`,
				});
			}
			throw e;
		}
	});
