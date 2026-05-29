import { z } from "zod";

import { agentOrUserOrgProcedure, requireAgentCapability } from "../../../orpc/procedures";
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
		z
			.object({
				// Workflow target -- exactly one of workflowId or workflowSlug.
				// workflowSlug is the cross-product alias (Phase 11a step 3(a))
				// used by PM and other sibling-product callers that don't have a
				// stable Ops-side workflow id. Final exactly-one enforcement lives
				// in launchRun() so the same invariant guards every caller
				// regardless of which procedure surface they entered through.
				workflowId: z.string().min(1).optional(),
				workflowSlug: z.string().min(1).optional(),
				workflowVersionId: z.string().min(1).optional(),
				kickoffValues: z.record(z.string(), z.unknown()).default({}),
				roleAssignments: z.array(roleAssignmentSchema).default([]),
				title: z.string().min(1).optional(),
				// Mode-aware launch (Phase 8 step 3). Default 'human' keeps existing callers
				// unchanged. When mode is ai_assisted/automated, agentId is required.
				mode: z.enum(["human", "ai_assisted", "automated"]).default("human"),
				agentId: z.string().min(1).nullish(),
				// Phase 11a step 3(b) -- cross-product callback echo. All inner fields
				// optional so PM can populate whichever ids it has at launch time;
				// webhookEvents narrows the catalog set for this specific run.
				callback: z
					.object({
						pmServiceRequestId: z.string().min(1).optional(),
						pmWorkOrderId: z.string().min(1).optional(),
						webhookEvents: z.array(z.string().min(1)).optional(),
					})
					.optional(),
				// Phase 10 / v1.5c R6 lift -- entity context. Stamps
				// (entity_type, entity_id) onto the run so the Active Run
				// right-rail card on the entity's detail page can surface it.
				// Optional; absent for org-wide / multi-entity launches.
				entityContext: z
					.object({
						entityType: z.literal("listing"),
						entityId: z.string().min(1),
					})
					.optional(),
			})
			.refine(
				(v) =>
					(v.workflowId === undefined ? 0 : 1) +
						(v.workflowSlug === undefined ? 0 : 1) ===
					1,
				{
					message: "Provide exactly one of workflowId or workflowSlug.",
					path: ["workflowId"],
				},
			),
	)
	.handler(async ({ input, context }) => {
		const { principal, organization } = context;
		// Phase 11a step 4 -- per-agent capability gate. No-op for users.
		requireAgentCapability(principal, "action.runs.launch");
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
