import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";
import { updateWorkflowMeta } from "../lib/workflow";
import { workflowEngineCall } from "./_utils";

export const updateWorkflowProc = adminOrgProcedure
	.route({
		method: "PATCH",
		path: "/workflows/{workflowId}",
		tags: ["Workflows"],
		summary: "Update workflow-level metadata (title, description, type, isActive)",
		description:
			"Workflow-level fields only -- never touches a workflow_version. Per-version content edits route through the section/step/field procedures against the open draft.",
	})
	.input(
		z.object({
			workflowId: z.string().min(1),
			title: z.string().min(1).max(200).optional(),
			description: z.string().max(2000).nullable().optional(),
			type: z.enum(["procedure", "document", "policy", "form"]).optional(),
			isActive: z.boolean().optional(),
		}),
	)
	.handler(async ({ input, context }) => {
		await workflowEngineCall(() =>
			updateWorkflowMeta(
				{ organizationId: context.organization.id, userId: context.user.id },
				input,
			),
		);
		return { ok: true as const };
	});
