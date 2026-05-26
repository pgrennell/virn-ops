import { listActiveRunsWithProgress } from "@virn/database";
import { z } from "zod";

import { protectedOrgProcedure } from "../../../orpc/procedures";

export const listActiveRunsProc = protectedOrgProcedure
	.route({
		method: "GET",
		path: "/runs/active",
		tags: ["Runs"],
		summary: "List active runs in the org with per-run completion progress",
		description:
			"Single GROUP BY query: one row per active run, with totalSteps and completedSteps aggregated from run_step. Powers the Home dashboard's right-rail Active runs column. Ordered most-recently-started first.",
	})
	.input(
		z.object({
			limit: z.number().int().min(1).max(50).optional(),
			offset: z.number().int().min(0).optional(),
		}),
	)
	.handler(async ({ input, context }) => {
		return await listActiveRunsWithProgress({
			organizationId: context.organization.id,
			limit: input.limit,
			offset: input.offset,
		});
	});
