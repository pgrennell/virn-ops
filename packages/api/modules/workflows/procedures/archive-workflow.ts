import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";
import { archiveWorkflowOp } from "../lib/workflow";
import { workflowEngineCall } from "./_utils";

export const archiveWorkflowProc = adminOrgProcedure
	.route({
		method: "POST",
		path: "/workflows/{workflowId}/archive",
		tags: ["Workflows"],
		summary: "Archive a workflow (soft delete)",
		description:
			"Sets workflow.deletedAt. This is the WORKFLOW-level archive (hide the whole authored asset). Distinct from version-level workflow_version.status='archived' which retires one published version while keeping the workflow itself live. There is no hard delete -- Invariant #6 (audit/governance is append-only) implies authored content survives in history.",
	})
	.input(z.object({ workflowId: z.string().min(1) }))
	.handler(async ({ input, context }) => {
		await workflowEngineCall(() =>
			archiveWorkflowOp(
				{ organizationId: context.organization.id, userId: context.user.id },
				input,
			),
		);
		return { ok: true as const };
	});
