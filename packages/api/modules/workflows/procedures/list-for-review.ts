// Phase 9.5g (PRD §6.6) -- admin review inbox listing. Returns workflows currently in
// the 'in_review' state, oldest-updated first (so stale submissions are top-of-mind).
// Admin-only since this surfaces the reviewer-side admin inbox.

import { listWorkflowsInReview } from "@virn/database";

import { adminOrgProcedure } from "../../../orpc/procedures";

export const listForReviewProc = adminOrgProcedure
	.route({
		method: "GET",
		path: "/workflows/for-review",
		tags: ["Workflows"],
		summary: "List workflows currently awaiting concierge review (admin inbox)",
		description:
			"Returns workflows in review_state='in_review' with their draft + latest-published version pointers for the review-pane diff view. Oldest-first so admins triage staleness from the top.",
	})
	.handler(async ({ context }) => {
		return await listWorkflowsInReview(context.organization.id);
	});
