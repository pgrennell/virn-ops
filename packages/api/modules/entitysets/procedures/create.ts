// packages/api/modules/entitysets/procedures/create.ts
//
// Create an entity set. Admin/owner only -- entity sets are workflow-scoping metadata,
// not runtime state, so they live with the admin surface (mirrors data sets, vendor
// categories). UNIQUE (org, type, name) is enforced at the DB level; we catch the
// constraint violation and map to CONFLICT.

import { ORPCError } from "@orpc/server";
import { createEntitySet } from "@virn/database";
import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";
import { REGISTERED_ENTITY_TYPES } from "../../entities/adapters";

// Build the Zod enum dynamically from the EntityAdapter registry so adding a new entity
// type (post-v1) doesn't require touching every procedure -- one change, registry → all
// procedures.
const ENTITY_TYPE_ENUM = z.enum(REGISTERED_ENTITY_TYPES as [string, ...string[]]);

export const create = adminOrgProcedure
	.route({
		method: "POST",
		path: "/entity-sets",
		tags: ["EntitySets"],
		summary: "Create an entity set (admin/owner only)",
	})
	.input(
		z.object({
			entityType: ENTITY_TYPE_ENUM,
			name: z.string().min(1).max(120),
			color: z.string().max(40).nullish(),
			description: z.string().max(2000).nullish(),
		}),
	)
	.handler(async ({ context, input }) => {
		try {
			return await createEntitySet({
				organizationId: context.organization.id,
				entityType: input.entityType as "listing",
				name: input.name,
				color: input.color ?? null,
				description: input.description ?? null,
			});
		} catch (e) {
			if (
				e instanceof Error &&
				/uq_entity_set_org_type_name|duplicate key/i.test(e.message)
			) {
				throw new ORPCError("CONFLICT", {
					message: `An entity set named "${input.name}" already exists for this type in this organization.`,
				});
			}
			throw e;
		}
	});
