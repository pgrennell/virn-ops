import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";
import { createWorkflowRole } from "../lib/roles";
import { workflowEngineCall } from "./_utils";

export const createWorkflowRoleProc = adminOrgProcedure
	.route({
		method: "POST",
		path: "/workflow-roles",
		tags: ["Workflows"],
		summary: "Create a workflow role",
	})
	.input(
		z.object({
			name: z.string().min(1).max(100),
			isInitiator: z.boolean().optional(),
		}),
	)
	.handler(async ({ input, context }) => {
		return await workflowEngineCall(() =>
			createWorkflowRole(
				{ organizationId: context.organization.id, userId: context.user.id },
				input,
			),
		);
	});
