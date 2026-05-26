import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";
import { updateWorkflowRoleOp } from "../lib/roles";
import { workflowEngineCall } from "./_utils";

export const updateWorkflowRoleProc = adminOrgProcedure
	.route({
		method: "PATCH",
		path: "/workflow-roles/{roleId}",
		tags: ["Workflows"],
		summary: "Update a workflow role",
	})
	.input(
		z.object({
			roleId: z.string().min(1),
			name: z.string().min(1).max(100).optional(),
			isInitiator: z.boolean().optional(),
		}),
	)
	.handler(async ({ input, context }) => {
		await workflowEngineCall(() =>
			updateWorkflowRoleOp(
				{ organizationId: context.organization.id, userId: context.user.id },
				input,
			),
		);
		return { ok: true as const };
	});
