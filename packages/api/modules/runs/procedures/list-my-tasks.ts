import { listAssignedTasksForAgent, listAssignedTasksForUser } from "@virn/database";
import { z } from "zod";

import { agentOrUserOrgProcedure } from "../../../orpc/procedures";

// Dual-auth (Phase 11a.2 -- agent introspection). For users this lists run-step
// assignments where `participant.userId = me`; for agents it lists assignments where
// `participant.agentId = me`. Same row shape, same procedure -- both principals share the
// "my tasks" surface.
export const listMyTasksProc = agentOrUserOrgProcedure
	.route({
		method: "GET",
		path: "/runs/my-tasks",
		tags: ["Runs"],
		summary: "List run steps assigned to the current principal (user or agent)",
		description:
			"Direct assignment only -- role -> participant fanout was already materialized at launch time. Returns the data needed to render My Work + Home rows (or the agent's own assignment list): run + workflow titles, status, due, blocked flag.",
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
		const { principal, organization } = context;
		const shared = {
			organizationId: organization.id,
			status: input.status,
			dueBefore: input.dueBefore,
			limit: input.limit,
			offset: input.offset,
		};
		if (principal.kind === "agent") {
			return await listAssignedTasksForAgent({ ...shared, agentId: principal.agent.id });
		}
		return await listAssignedTasksForUser({ ...shared, userId: principal.user.id });
	});
