// Phase 16 -- decide (approve / reject) a pending version_approval. Admin-
// only today; widen to reviewer-grade when ADR-004 lands.

import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";
import { decideApproval } from "../lib/approval";

export const decideApprovalProc = adminOrgProcedure
	.route({
		method: "POST",
		path: "/approvals/decide",
		tags: ["Approvals"],
		summary: "Approve or reject a pending version_approval",
		description:
			"Transitions decision pending -> approved/rejected exactly once. CONFLICT if another reviewer already decided. The note is optional but useful on rejections so the requester knows what to fix.",
	})
	.input(
		z.object({
			approvalId: z.string().min(1),
			decision: z.enum(["approved", "rejected"]),
			note: z.string().max(2000).nullable().optional(),
		}),
	)
	.handler(async ({ input, context }) => {
		return await decideApproval(
			{ organizationId: context.organization.id, userId: context.user.id },
			input,
		);
	});
