import { z } from "zod";

import { agentOrUserOrgProcedure } from "../../../orpc/procedures";
import { setRunFieldValue } from "../lib/set-field-value";
import { runEngineCall } from "./_utils";

// Dual-auth (Phase 11a, S-01a). The same handler is reachable by:
//   - a logged-in user/admin (session cookie) -- existing path
//   - an agent presenting `Authorization: Bearer agent_<…>` -- new action-surface path
// `agentOrUserOrgProcedure` normalizes the principal into context.principal; we dispatch
// here to build the right SetFieldValueContext shape (the lib already understands
// agentId / participantId / userId via discriminated context).
export const setFieldValueProc = agentOrUserOrgProcedure
	.route({
		method: "POST",
		path: "/runs/field-value",
		tags: ["Runs"],
		summary: "Set a field value on a run step (or kickoff)",
		description:
			"Validates the value against the snapshotted field's type + config (Invariant #5: fields are referenced by stable key). For step-scoped fields the caller must be an assignee or org admin/owner; kickoff writes after launch are admin/owner only. Callable by a logged-in user OR by an agent presenting a Bearer credential (the agent must already be a participant on the run, bound at launch).",
	})
	.input(
		z.object({
			runStepId: z.string().min(1).nullable(),
			runId: z.string().min(1).optional(),
			fieldKey: z.string().min(1),
			value: z.unknown(),
		}),
	)
	.handler(async ({ input, context }) => {
		const { principal, organization } = context;
		return await runEngineCall(() => {
			if (principal.kind === "agent") {
				return setRunFieldValue(
					{
						organizationId: organization.id,
						agentId: principal.agent.id,
						crossProductOrigin: principal.agent.originProduct,
						isAdminOrOwner: false,
					},
					input,
				);
			}
			const isAdminOrOwner =
				principal.membership?.role === "admin" || principal.membership?.role === "owner";
			return setRunFieldValue(
				{
					organizationId: organization.id,
					userId: principal.user.id,
					isAdminOrOwner,
				},
				input,
			);
		});
	});
