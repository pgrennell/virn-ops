import { z } from "zod";

import { protectedOrgProcedure } from "../../../orpc/procedures";
import { completeRunStep } from "../lib/complete-step";
import { runEngineCall } from "./_utils";

export const completeStepProc = protectedOrgProcedure
	.route({
		method: "POST",
		path: "/runs/step/complete",
		tags: ["Runs"],
		summary: "Mark a run step complete",
		description:
			"Refuses if required fields are unfilled or a stop-task dependency is incomplete. Writes append-only audit + activity records. If every required runStep is now complete, the parent run is marked complete in the same call.",
	})
	.input(z.object({ runStepId: z.string().min(1) }))
	.handler(async ({ input, context }) => {
		const isAdminOrOwner =
			context.membership.role === "admin" || context.membership.role === "owner";
		return await runEngineCall(() =>
			completeRunStep(
				{
					organizationId: context.organization.id,
					userId: context.user.id,
					isAdminOrOwner,
				},
				input.runStepId,
			),
		);
	});
