import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";
import { deleteStepOp } from "../lib/structure";
import { workflowEngineCall } from "./_utils";

export const deleteStepProc = adminOrgProcedure
	.route({
		method: "DELETE",
		path: "/workflows/steps/{stepId}",
		tags: ["Workflows"],
		summary: "Delete a step from a draft version",
		description:
			"Refuses if the step is referenced by another step (as a stop-task dependency, or as a due-anchor via dueAnchorStepId). The error payload lists the referencers so the UI can guide the user to clear them first. Step fields cascade-delete with the step (schema); the dependency cleanup is the user's responsibility for safety.",
	})
	.input(z.object({ stepId: z.string().min(1) }))
	.handler(async ({ input, context }) => {
		await workflowEngineCall(() =>
			deleteStepOp(
				{ organizationId: context.organization.id, userId: context.user.id },
				input,
			),
		);
		return { ok: true as const };
	});
