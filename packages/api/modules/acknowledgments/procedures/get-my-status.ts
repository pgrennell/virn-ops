// Phase 16 -- read-shaped check for "has the current user acknowledged this
// version?" Drives the Read view's Acknowledge button vs Acknowledged badge.
// Cross-org versions return hasAcknowledged=false (not NOT_FOUND) so the UI
// doesn't need to distinguish "not yours" from "not yet."

import { z } from "zod";

import { protectedOrgProcedure } from "../../../orpc/procedures";
import { getMyAcknowledgmentStatus } from "../lib/acknowledge";

export const getMyStatusProc = protectedOrgProcedure
	.route({
		method: "GET",
		path: "/acknowledgments/my-status",
		tags: ["Acknowledgments"],
		summary: "Has the current user acknowledged a specific version?",
		description:
			"Returns { hasAcknowledged: boolean, acknowledgedAt: Date | null }. Drives the Read view's button state. Cross-org versions return hasAcknowledged=false (matches getMyReadStatus's posture).",
	})
	.input(z.object({ workflowVersionId: z.string().min(1) }))
	.handler(async ({ input, context }) => {
		return await getMyAcknowledgmentStatus(
			{ organizationId: context.organization.id, userId: context.user.id },
			input,
		);
	});
