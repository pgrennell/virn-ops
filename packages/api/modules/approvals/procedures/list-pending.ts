// Phase 16 -- org-wide pending approvals list for the /compliance/approvals
// dashboard. Admin-only today; reviewer-grade when ADR-004 lands.

import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";
import { listPending } from "../lib/approval";

export const listPendingProc = adminOrgProcedure
	.route({
		method: "GET",
		path: "/approvals/pending",
		tags: ["Approvals"],
		summary: "List every pending approval in the org",
		description:
			"Joins workflow + version + requester user inline. Ordered oldest-first so reviewers work the queue from the bottom (FIFO). Returns rows + totalCount for pagination.",
	})
	.input(
		z.object({
			limit: z.number().int().min(1).max(100).optional(),
			offset: z.number().int().min(0).optional(),
		}),
	)
	.handler(async ({ input, context }) => {
		return await listPending(
			{ organizationId: context.organization.id, userId: context.user.id },
			input,
		);
	});
