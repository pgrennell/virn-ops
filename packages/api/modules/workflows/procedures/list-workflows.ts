import { listWorkflowsForOrg } from "@virn/database";
import { z } from "zod";

import { protectedOrgProcedure } from "../../../orpc/procedures";

export const listWorkflowsProc = protectedOrgProcedure
	.route({
		method: "GET",
		path: "/workflows",
		tags: ["Workflows"],
		summary: "List workflows in the active organization",
		description:
			"Returns one row per workflow with hasDraft + latestPublishedVersionNumber pre-computed. Consumed by the Library and the Builder index. Soft-deleted (archived) workflows are excluded unless `includeArchived` is set.",
	})
	.input(
		z.object({
			includeArchived: z.boolean().optional(),
			limit: z.number().int().min(1).max(500).optional(),
			offset: z.number().int().min(0).optional(),
		}),
	)
	.handler(async ({ input, context }) => {
		return await listWorkflowsForOrg({
			organizationId: context.organization.id,
			includeArchived: input.includeArchived,
			limit: input.limit,
			offset: input.offset,
		});
	});
