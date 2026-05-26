import { listAssignedTasksForUser } from "@virn/database";
import { z } from "zod";

import { protectedOrgProcedure } from "../../../orpc/procedures";

export const listMyTasksProc = protectedOrgProcedure
	.route({
		method: "GET",
		path: "/runs/my-tasks",
		tags: ["Runs"],
		summary: "List run steps assigned to the current user",
		description:
			"Direct assignment only -- role -> participant fanout was already materialized at launch time. Returns the data needed to render My Work + Home rows: run + workflow titles, status, due, blocked flag.",
	})
	.input(
		z.object({
			status: z.enum(["pending", "completed"]).optional(),
			dueBefore: z.coerce.date().optional(),
			limit: z.number().int().min(1).max(200).optional(),
			offset: z.number().int().min(0).optional(),
		}),
	)
	.handler(async ({ input, context }) => {
		return await listAssignedTasksForUser({
			organizationId: context.organization.id,
			userId: context.user.id,
			status: input.status,
			dueBefore: input.dueBefore,
			limit: input.limit,
			offset: input.offset,
		});
	});
