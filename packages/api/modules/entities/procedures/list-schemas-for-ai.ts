// packages/api/modules/entities/procedures/list-schemas-for-ai.ts
//
// Phase 9.5 (R4 lift) -- expose the EntityAdapter registry's schemaForAI() output
// to the client so the Workflow Builder's Template Variables sidebar can render
// the token list. The same schemas feed the Phase 12 AI authoring system prompt
// (see packages/api/modules/agents/...); this procedure surfaces them for the
// UI without re-implementing the catalog.
//
// Returns a flat shape that's easy for the client to map directly into token
// chips: one entry per (entity_type, field_key), with display label + dataType
// + nullable + description so the sidebar can render rich token chips with
// hover tooltips.
//
// Open to any org member (read-only catalog data). No org-scoping needed --
// the catalog is the same for every tenant in v1.5 (Layer-1 full configurable
// entity model is post-v1 per D-034). When Layer-1 ships, this procedure
// will fetch per-org schemas through the adapter registry's per-tenant
// dispatch -- no callers change shape.

import { adapters, REGISTERED_ENTITY_TYPES } from "../adapters";
import { protectedOrgProcedure } from "../../../orpc/procedures";

export const listSchemasForAIProc = protectedOrgProcedure
	.route({
		method: "GET",
		path: "/entities/schemas-for-ai",
		tags: ["Entities"],
		summary:
			"List entity schemas for AI authoring + Template Variables sidebar (R4)",
		description:
			"Returns the EntityAdapter registry's schemaForAI() output for every registered entity type. v1.5 has one registered adapter ('listing'); future packs surface here automatically when their adapters land. Read-only catalog; not org-scoped because the schemas are platform-shared in v1.5.",
	})
	.handler(async () => {
		const schemas = REGISTERED_ENTITY_TYPES.map((type) =>
			adapters[type].schemaForAI(),
		);
		return { schemas };
	});
