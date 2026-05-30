// Phase 16 -- list suggestions for the admin triage surface. Admin-only.

import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";
import { listSuggestions } from "../lib/suggestion";

export const listSuggestionsProc = adminOrgProcedure
	.route({
		method: "GET",
		path: "/suggestions/list",
		tags: ["Suggestions"],
		summary: "List suggestions in the org (admin triage)",
		description:
			"Joins workflow + suggester user inline. Optional workflowId + status filters. Returns rows + totalCount for pagination.",
	})
	.input(
		z.object({
			workflowId: z.string().min(1).optional(),
			status: z.enum(["open", "accepted", "rejected", "merged"]).optional(),
			limit: z.number().int().min(1).max(100).optional(),
			offset: z.number().int().min(0).optional(),
		}),
	)
	.handler(async ({ input, context }) => {
		return await listSuggestions(
			{ organizationId: context.organization.id, userId: context.user.id },
			input,
		);
	});
