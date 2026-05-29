// Phase 10 / v1.5c (PRD §6.4) -- mark a published workflow version as read.
//
// Any org member can mark read; this is a passive "I've seen this SOP"
// signal, distinct from the active acknowledgment compliance gate. The lib
// helper enforces published-only (drafts are not yet SOPs) + org-scope.

import { z } from "zod";

import { protectedOrgProcedure } from "../../../orpc/procedures";
import { markVersionAsRead } from "../lib/read-receipts";
import { workflowEngineCall } from "./_utils";

export const markAsReadProc = protectedOrgProcedure
	.route({
		method: "POST",
		path: "/workflows/versions/{workflowVersionId}/mark-as-read",
		tags: ["Workflows"],
		summary: "Mark a published workflow version as read (passive signal)",
		description:
			"Writes a sop_read_receipt row for the current user. Idempotent: re-marking returns the existing row's id with alreadyExisted=true. Refuses if the version isn't published.",
	})
	.input(z.object({ workflowVersionId: z.string().min(1) }))
	.handler(async ({ input, context }) => {
		return await workflowEngineCall(() =>
			markVersionAsRead(
				{ organizationId: context.organization.id, userId: context.user.id },
				input,
			),
		);
	});
