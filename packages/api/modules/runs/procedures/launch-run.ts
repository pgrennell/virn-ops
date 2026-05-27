import { z } from "zod";

import { agentOrUserOrgProcedure } from "../../../orpc/procedures";
import { launchRun } from "../lib/launch-run";
import { runEngineCall } from "./_utils";

const roleAssignmentSchema = z.object({
	roleId: z.string().min(1),
	userId: z.string().min(1).nullish(),
	guestEmail: z.string().email().nullish(),
	guestName: z.string().min(1).nullish(),
	// Vendor role assignment (Phase 8 vendor picker, ADR-007 + D-023). Both must be
	// populated together when assigning a vendor; launchRun's INVALID_ROLE_ASSIGNMENT
	// rejects partial vendor specs. Server-side: existence + isActive + non-blacklisted
	// checks per VENDOR_* error codes.
	vendorId: z.string().min(1).nullish(),
	vendorContactId: z.string().min(1).nullish(),
});

// Dual-auth (Phase 11a.2). The launcher principal is either a logged-in user or an agent
// presenting `Authorization: Bearer agent_<…>`. For agent launches, the launching agent
// is added as a `participant` row on the new run so 11a.1's "must be a pre-existing
// participant" check passes for subsequent setFieldValue / completeStep calls -- this is
// the on-demand binding point that 11a.1 deliberately deferred.
export const launchRunProc = agentOrUserOrgProcedure
	.route({
		method: "POST",
		path: "/runs/launch",
		tags: ["Runs"],
		summary: "Launch a new run from a published workflow version",
		description:
			"Snapshots the workflow version into run + run_step + field_value rows. Returns the new runId. Callable by a logged-in user OR by an agent presenting a Bearer credential -- for the agent path, the launching agent is added as a participant on the new run so it can subsequently complete steps via setFieldValue / completeStep.",
	})
	.input(
		z.object({
			workflowId: z.string().min(1),
			workflowVersionId: z.string().min(1).optional(),
			kickoffValues: z.record(z.string(), z.unknown()).default({}),
			roleAssignments: z.array(roleAssignmentSchema).default([]),
			title: z.string().min(1).optional(),
			// Mode-aware launch (Phase 8 step 3). Default 'human' keeps existing callers
			// unchanged. When mode is ai_assisted/automated, agentId is required.
			mode: z.enum(["human", "ai_assisted", "automated"]).default("human"),
			agentId: z.string().min(1).nullish(),
		}),
	)
	.handler(async ({ input, context }) => {
		const { principal, organization } = context;
		return await runEngineCall(() => {
			if (principal.kind === "agent") {
				return launchRun(
					{
						organizationId: organization.id,
						launcherAgentId: principal.agent.id,
						crossProductOrigin: principal.agent.originProduct,
					},
					input,
				);
			}
			return launchRun(
				{
					organizationId: organization.id,
					userId: principal.user.id,
				},
				input,
			);
		});
	});
