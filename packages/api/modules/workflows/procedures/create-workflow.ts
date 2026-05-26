import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";
import { createWorkflow } from "../lib/workflow";
import { workflowEngineCall } from "./_utils";

export const createWorkflowProc = adminOrgProcedure
	.route({
		method: "POST",
		path: "/workflows",
		tags: ["Workflows"],
		summary: "Create a new workflow + initial draft version",
		description:
			"Inserts a workflow row and a v1 draft workflow_version in a single transaction. `type` defaults to 'procedure' so the generic + Create flow lands on a procedure; passing 'document'/'policy'/'form' creates the right type directly without create-then-update.",
	})
	.input(
		z.object({
			title: z.string().min(1).max(200),
			description: z.string().max(2000).nullable().optional(),
			type: z.enum(["procedure", "document", "policy", "form"]).optional(),
		}),
	)
	.handler(async ({ input, context }) => {
		return await workflowEngineCall(() =>
			createWorkflow(
				{ organizationId: context.organization.id, userId: context.user.id },
				{
					title: input.title,
					description: input.description ?? null,
					type: input.type,
				},
			),
		);
	});
