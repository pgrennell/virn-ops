// Phase 10 / v1.5c (PRD §6.4) -- read the current user's read-status for a
// specific workflow version. Drives the Read view's "Mark as read" button
// vs already-read badge state.

import { z } from "zod";

import { protectedOrgProcedure } from "../../../orpc/procedures";
import { getMyReadStatus } from "../lib/read-receipts";
import { workflowEngineCall } from "./_utils";

export const getMyReadStatusProc = protectedOrgProcedure
	.route({
		method: "GET",
		path: "/workflows/versions/{workflowVersionId}/my-read-status",
		tags: ["Workflows"],
		summary: "Get the current user's read status for a workflow version",
		description:
			"Returns { hasRead, readAt }. Cross-org versions resolve to hasRead=false (rather than a 404) so the Read view's button state renders without distinguishing 'not read' from 'not yours.'",
	})
	.input(z.object({ workflowVersionId: z.string().min(1) }))
	.handler(async ({ input, context }) => {
		return await workflowEngineCall(() =>
			getMyReadStatus(
				{ organizationId: context.organization.id, userId: context.user.id },
				input,
			),
		);
	});
