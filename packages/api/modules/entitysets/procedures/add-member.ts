// packages/api/modules/entitysets/procedures/add-member.ts
//
// Add a polymorphic membership to an entity set. Admin/owner only -- entity-set scope is
// administrative metadata. The query helper enforces (a) the set belongs to the org and
// (b) the (set.entityType, requested entityType) match. Idempotent: re-adding returns
// `{ added: false }`.

import { ORPCError } from "@orpc/server";
import { addEntitySetMember } from "@virn/database";
import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";
import { REGISTERED_ENTITY_TYPES, getAdapter } from "../../entities/adapters";

const ENTITY_TYPE_ENUM = z.enum(REGISTERED_ENTITY_TYPES as [string, ...string[]]);

export const addMember = adminOrgProcedure
	.route({
		method: "POST",
		path: "/entity-sets/{entitySetId}/members",
		tags: ["EntitySets"],
		summary: "Add an entity to a set (admin/owner only)",
	})
	.input(
		z.object({
			entitySetId: z.string().min(1),
			entityType: ENTITY_TYPE_ENUM,
			entityId: z.string().min(1),
		}),
	)
	.handler(async ({ context, input }) => {
		// Defense in depth: confirm the entity actually exists in the org via its adapter
		// BEFORE we try to insert a membership row. Without this an admin could create
		// dangling member rows pointing at deleted listings, or worse, at ids that belong
		// to other orgs (the query helper enforces set ownership but not entity ownership).
		const adapter = getAdapter(input.entityType);
		if (!adapter) {
			throw new ORPCError("BAD_REQUEST", {
				message: `No adapter registered for entity type "${input.entityType}".`,
			});
		}
		const entity = await adapter.getById(context.organization.id, input.entityId);
		if (!entity) {
			throw new ORPCError("NOT_FOUND", {
				message: `Entity not found in this organization: ${input.entityType}/${input.entityId}.`,
			});
		}

		const result = await addEntitySetMember({
			organizationId: context.organization.id,
			entitySetId: input.entitySetId,
			entityType: input.entityType as "listing",
			entityId: input.entityId,
		});
		if (!result.added) {
			// Could be: set doesn't exist in org, or type mismatch, or already a member.
			// We return a soft response (not an error) for the already-a-member case so the
			// UI can treat add-toggle as idempotent.
			return { added: false as const };
		}
		return { added: true as const };
	});
