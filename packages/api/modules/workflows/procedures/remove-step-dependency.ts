import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";
import { removeStepDependency } from "../lib/structure";
import { workflowEngineCall } from "./_utils";

export const removeStepDependencyProc = adminOrgProcedure
	.route({
		method: "DELETE",
		path: "/workflows/steps/{stepId}/dependencies/{dependsOnStepId}",
		tags: ["Workflows"],
		summary: "Remove a stop-task dependency from a draft step",
	})
	.input(
		z.object({
			stepId: z.string().min(1),
			dependsOnStepId: z.string().min(1),
		}),
	)
	.handler(async ({ input, context }) => {
		await workflowEngineCall(() =>
			removeStepDependency(
				{ organizationId: context.organization.id, userId: context.user.id },
				input,
			),
		);
		return { ok: true as const };
	});
