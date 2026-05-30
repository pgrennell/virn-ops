// Phase 14 -- the org-level Lightweight Monitor (S-06) data source.
//
// Generalized over listActiveRuns (the active-only Home dashboard reader): adds
// status filter, optional workflow filter, "needs attention" bucket, sort, and a
// total count so the /runs page can paginate. Org-scoped via protectedOrgProcedure.
//
// The "needs attention" filter is computed in SQL (overdue OR has-blocked-step
// subquery) so the count agrees with the rendered page -- a JS post-filter would
// drift from the totalCount used for pagination.

import { listRunsWithProgress } from "@virn/database";
import { z } from "zod";

import { protectedOrgProcedure } from "../../../orpc/procedures";

const runStatusSchema = z.enum(["active", "completed", "archived"]);
const runSortSchema = z.enum([
	"started_desc",
	"started_asc",
	"due_asc",
	"due_desc",
	"completed_desc",
]);

export const listRunsProc = protectedOrgProcedure
	.route({
		method: "GET",
		path: "/runs/list",
		tags: ["Runs"],
		summary: "List runs in the org with filter, sort, and per-run progress",
		description:
			"Phase 14 monitor reader. Filters: workflowId, statuses[], needsAttention (active + (overdue OR blocked)). Sort: started/due/completed asc/desc. Returns rows + totalCount for pagination. Active-only Home dashboard still uses /runs/active (listActiveRuns).",
	})
	.input(
		z
			.object({
				workflowId: z.string().min(1).optional(),
				statuses: z.array(runStatusSchema).min(1).optional(),
				needsAttention: z.boolean().optional(),
				entityType: z.literal("listing").optional(),
				entityId: z.string().min(1).optional(),
				sort: runSortSchema.optional(),
				limit: z.number().int().min(1).max(100).optional(),
				offset: z.number().int().min(0).optional(),
			})
			.refine(
				(v) => (v.entityType ? !!v.entityId : !v.entityId),
				{ message: "entityType and entityId must be provided together" },
			),
	)
	.handler(async ({ input, context }) => {
		return await listRunsWithProgress({
			organizationId: context.organization.id,
			workflowId: input.workflowId,
			statuses: input.statuses,
			needsAttention: input.needsAttention,
			entityType: input.entityType,
			entityId: input.entityId,
			sort: input.sort,
			limit: input.limit,
			offset: input.offset,
		});
	});
