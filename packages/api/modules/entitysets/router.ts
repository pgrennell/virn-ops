// packages/api/modules/entitysets/router.ts
//
// Entity-set router (PRD_WORKFLOW_SOP_BUILDER.md §6.1, §8.3 / D-034). Reads are open to
// any org member; writes are admin/owner. The polymorphic membership table is the bridge
// between Layer-1 entity definitions (listings today; more later) and the Layer-2
// workflow engine.

import { addMember } from "./procedures/add-member";
import { create } from "./procedures/create";
import { remove } from "./procedures/delete";
import { get } from "./procedures/get";
import { list } from "./procedures/list";
import { listForEntities } from "./procedures/list-for-entities";
import { listForEntity } from "./procedures/list-for-entity";
import { listMembers } from "./procedures/list-members";
import { removeMember } from "./procedures/remove-member";
import { update } from "./procedures/update";

export const entitysetsRouter = {
	list,
	get,
	create,
	update,
	// `remove` not `delete` (reserved word in some bundlers).
	delete: remove,
	addMember,
	removeMember,
	listMembers,
	listForEntity,
	listForEntities, // batched reverse lookup -- Phase 9.5f index-row chip rendering
};
