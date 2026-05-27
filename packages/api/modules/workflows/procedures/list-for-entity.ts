// packages/api/modules/workflows/procedures/list-for-entity.ts
//
// Phase 9.5e — entity-context workflow listing (PRD §6.2). Filters published, active
// workflows by the set-intersection rule: `workflow.entity_set_ids = '{}' OR
// workflow.entity_set_ids ∩ entity.entity_set_ids ≠ ∅`. The launcher's per-entity picker
// consumes this; workflow-first launches keep going through workflows.list with a
// mismatch warning rendered client-side.
//
// Org-scoping note: protectedOrgProcedure verifies the caller is an org member. The query
// helper enforces (a) workflows belong to the active org and (b) entity_set memberships
// are scoped to the same org via the JOIN on entity_set.organization_id (implicit through
// the FK chain entity_set_member -> entity_set -> organization). Callers are expected to
// have already authorized access to (entityType, entityId).

import { listWorkflowsForEntity } from "@virn/database";
import { z } from "zod";

import { protectedOrgProcedure } from "../../../orpc/procedures";
import { REGISTERED_ENTITY_TYPES } from "../../entities/adapters";

const ENTITY_TYPE_ENUM = z.enum(REGISTERED_ENTITY_TYPES as [string, ...string[]]);

export const listForEntityProc = protectedOrgProcedure
	.route({
		method: "GET",
		path: "/workflows/for-entity/{entityType}/{entityId}",
		tags: ["Workflows"],
		summary: "List workflows applicable to a specific entity (entity-set scoped)",
		description:
			"Returns published, active workflows whose declared `entitySetIds` is empty (applies-to-all) OR intersects the target entity's set memberships. An entity with no set memberships only sees unscoped workflows. Used by entity-context launcher pickers (e.g. the 'Launch a workflow' menu on a listing detail page).",
	})
	.input(
		z.object({
			entityType: ENTITY_TYPE_ENUM,
			entityId: z.string().min(1),
			limit: z.number().int().min(1).max(200).optional(),
			offset: z.number().int().min(0).optional(),
		}),
	)
	.handler(async ({ input, context }) => {
		return await listWorkflowsForEntity({
			organizationId: context.organization.id,
			entityType: input.entityType as "listing",
			entityId: input.entityId,
			limit: input.limit,
			offset: input.offset,
		});
	});
