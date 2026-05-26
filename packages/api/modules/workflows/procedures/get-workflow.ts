import { ORPCError } from "@orpc/server";
import { getWorkflowWithVersions } from "@virn/database";
import { z } from "zod";

import { protectedOrgProcedure } from "../../../orpc/procedures";

export const getWorkflowProc = protectedOrgProcedure
	.route({
		method: "GET",
		path: "/workflows/{workflowId}",
		tags: ["Workflows"],
		summary: "Get a workflow with its version list",
		description:
			"Returns the workflow record + every version (newest first) + shortcuts to the current draft (at most one) and the latest published. Drives the Builder's index page and the Library row-action logic.",
	})
	.input(z.object({ workflowId: z.string().min(1) }))
	.handler(async ({ input, context }) => {
		const result = await getWorkflowWithVersions(context.organization.id, input.workflowId);
		if (!result) {
			throw new ORPCError("NOT_FOUND", { message: "Workflow not found in this organization." });
		}
		return result;
	});
