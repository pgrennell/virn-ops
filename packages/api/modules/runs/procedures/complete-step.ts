import { z } from "zod";

import { agentOrUserOrgProcedure } from "../../../orpc/procedures";
import { completeRunStep } from "../lib/complete-step";
import { runEngineCall } from "./_utils";

// Dual-auth (Phase 11a, S-01a). Same handler reachable by logged-in user or by an agent
// presenting `Authorization: Bearer agent_<…>`. See set-field-value.ts for the same pattern.
export const completeStepProc = agentOrUserOrgProcedure
	.route({
		method: "POST",
		path: "/runs/step/complete",
		tags: ["Runs"],
		summary: "Mark a run step complete",
		description:
			"Refuses if required fields are unfilled or a stop-task dependency is incomplete. Writes append-only audit + activity records. If every required runStep is now complete, the parent run is marked complete in the same call. Callable by a logged-in user OR by an agent presenting a Bearer credential (the agent must already be a participant on the run, bound at launch).",
	})
	.input(z.object({ runStepId: z.string().min(1) }))
	.handler(async ({ input, context }) => {
		const { principal, organization } = context;
		return await runEngineCall(() => {
			if (principal.kind === "agent") {
				return completeRunStep(
					{
						organizationId: organization.id,
						agentId: principal.agent.id,
						crossProductOrigin: principal.agent.originProduct,
						isAdminOrOwner: false,
					},
					input.runStepId,
				);
			}
			const isAdminOrOwner =
				principal.membership?.role === "admin" || principal.membership?.role === "owner";
			return completeRunStep(
				{
					organizationId: organization.id,
					userId: principal.user.id,
					isAdminOrOwner,
				},
				input.runStepId,
			);
		});
	});
