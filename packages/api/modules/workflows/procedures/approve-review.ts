// Phase 9.5g (PRD §6.6) -- approve an in-review workflow and publish its current draft.
// Admin-only. Internally composes the state transition (in_review -> published, atomic)
// with the existing publishVersion path. Returns the same shape publishVersion does so
// the UI can navigate to the new published version's id.

import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";
import { approveReview } from "../lib/publish";
import { workflowEngineCall } from "./_utils";

export const approveReviewProc = adminOrgProcedure
	.route({
		method: "POST",
		path: "/workflows/{workflowId}/approve-review",
		tags: ["Workflows"],
		summary: "Approve a workflow currently in concierge review (publishes its draft)",
		description:
			"Atomically transitions review_state from 'in_review' to 'published' AND publishes the current draft via the existing publishVersion path. Refuses if the workflow isn't currently in_review.",
	})
	.input(z.object({ workflowId: z.string().min(1) }))
	.handler(async ({ input, context }) => {
		return await workflowEngineCall(() =>
			approveReview(
				{ organizationId: context.organization.id, userId: context.user.id },
				input,
			),
		);
	});
