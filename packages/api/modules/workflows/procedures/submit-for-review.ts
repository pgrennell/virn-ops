// Phase 9.5g (PRD §6.6) -- submit a draft for concierge review. Admin-only since the
// existing edit/publish surface is admin-only. Gated on org.requireConciergeReview = true
// (the lib enforces; surfaced as CONCIERGE_REVIEW_NOT_ENABLED if the flag is off).

import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";
import { submitForReview } from "../lib/workflow";
import { workflowEngineCall } from "./_utils";

export const submitForReviewProc = adminOrgProcedure
	.route({
		method: "POST",
		path: "/workflows/{workflowId}/submit-for-review",
		tags: ["Workflows"],
		summary: "Submit a workflow's draft for concierge review",
		description:
			"Transitions workflow.review_state from 'draft' to 'in_review'. Only valid when the org has requireConciergeReview enabled. Without the flag, use publishVersion directly.",
	})
	.input(z.object({ workflowId: z.string().min(1) }))
	.handler(async ({ input, context }) => {
		await workflowEngineCall(() =>
			submitForReview(
				{ organizationId: context.organization.id, userId: context.user.id },
				input,
			),
		);
		return { ok: true as const };
	});
