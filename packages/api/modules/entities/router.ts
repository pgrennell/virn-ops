// packages/api/modules/entities/router.ts
//
// Phase 9.5 (R4 lift) -- the entities oRPC router. v1.5 surfaces a single
// procedure (listSchemasForAI) that feeds the Workflow Builder's Template
// Variables sidebar. The router shape leaves room for future entity-CRUD
// procedures as Layer-1 full configurable entity model lands post-v1.

import { listSchemasForAIProc } from "./procedures/list-schemas-for-ai";

export const entitiesRouter = {
	listSchemasForAI: listSchemasForAIProc,
};
