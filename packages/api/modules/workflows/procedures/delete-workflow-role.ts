import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";
import { deleteWorkflowRoleOp } from "../lib/roles";
import { workflowEngineCall } from "./_utils";

export const deleteWorkflowRoleProc = adminOrgProcedure
	.route({
		method: "DELETE",
		path: "/workflow-roles/{roleId}",
		tags: ["Workflows"],
		summary: "Delete a workflow role",
		description:
			"step.assignedRoleId set to null on existing steps (schema). The builder can re-assign; the run engine already tolerates unassigned steps at launch.",
	})
	.input(z.object({ roleId: z.string().min(1) }))
	.handler(async ({ input, context }) => {
		await workflowEngineCall(() =>
			deleteWorkflowRoleOp(
				{ organizationId: context.organization.id, userId: context.user.id },
				input,
			),
		);
		return { ok: true as const };
	});
