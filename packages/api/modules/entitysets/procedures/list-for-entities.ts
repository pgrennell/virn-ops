// packages/api/modules/entitysets/procedures/list-for-entities.ts
//
// Batched reverse lookup: for a SET of entity ids of one type, return per-id set
// memberships. Used by list-style UIs that want to show set-chip badges next to each
// row (the listings index is the first consumer — Phase 9.5f). Returns an object map
// keyed by entityId; JSON-friendly substitute for the Map<string, ...> the query helper
// returns at the DB layer.

import { listEntitySetsForEntities } from "@virn/database";
import { z } from "zod";

import { protectedOrgProcedure } from "../../../orpc/procedures";
import { REGISTERED_ENTITY_TYPES } from "../../entities/adapters";

const ENTITY_TYPE_ENUM = z.enum(REGISTERED_ENTITY_TYPES as [string, ...string[]]);

export const listForEntities = protectedOrgProcedure
	.route({
		method: "POST",
		path: "/entity-sets/for-entities",
		tags: ["EntitySets"],
		summary: "Batched: list entity sets that contain each of a set of entities",
		description:
			"POST (despite being a read) because the entity-id list goes in the body — avoids query-string length limits on big batches. Returns `{ [entityId]: ChipRow[] }` so callers can render set-chip badges in list UIs without N round-trips.",
	})
	.input(
		z.object({
			entityType: ENTITY_TYPE_ENUM,
			// Cap at 200 -- listing indexes paginate at 100; we leave headroom for future
			// surfaces that batch more aggressively. Beyond 200, pagination is mandatory.
			entityIds: z.array(z.string().min(1)).max(200),
		}),
	)
	.handler(async ({ context, input }) => {
		if (input.entityIds.length === 0) {
			return {} as Record<
				string,
				Array<{ id: string; name: string; color: string | null }>
			>;
		}
		const byEntity = await listEntitySetsForEntities({
			organizationId: context.organization.id,
			entityType: input.entityType as "listing",
			entityIds: input.entityIds,
		});
		// Map -> plain object for JSON serialization.
		const out: Record<
			string,
			Array<{ id: string; name: string; color: string | null }>
		> = {};
		for (const [k, v] of byEntity.entries()) {
			out[k] = v;
		}
		return out;
	});
