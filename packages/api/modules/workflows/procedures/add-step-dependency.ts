import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";
import { addStepDependency } from "../lib/structure";
import { workflowEngineCall } from "./_utils";

export const addStepDependencyProc = adminOrgProcedure
	.route({
		method: "POST",
		path: "/workflows/steps/{stepId}/dependencies",
		tags: ["Workflows"],
		summary: "Add a stop-task dependency on a draft step",
		description:
			"Creates a step_dependency edge: the step at `stepId` cannot complete until the step at `dependsOnStepId` is completed. Both endpoints must live in the same draft version. Idempotent via the unique constraint.",
	})
	.input(
		z.object({
			stepId: z.string().min(1),
			dependsOnStepId: z.string().min(1),
		}),
	)
	.handler(async ({ input, context }) => {
		await workflowEngineCall(() =>
			addStepDependency(
				{ organizationId: context.organization.id, userId: context.user.id },
				input,
			),
		);
		return { ok: true as const };
	});
