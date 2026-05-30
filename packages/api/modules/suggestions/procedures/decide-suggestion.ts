// Phase 16 -- triage decision (accept / reject / merge). Admin-only;
// idempotent against the WHERE-open update.

import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";
import { decideSuggestion } from "../lib/suggestion";

export const decideSuggestionProc = adminOrgProcedure
	.route({
		method: "POST",
		path: "/suggestions/decide",
		tags: ["Suggestions"],
		summary: "Resolve a suggestion (accept / reject / merge)",
		description:
			"Transitions status open -> accepted/rejected/merged exactly once. CONFLICT if another reviewer already resolved.",
	})
	.input(
		z.object({
			suggestionId: z.string().min(1),
			status: z.enum(["accepted", "rejected", "merged"]),
		}),
	)
	.handler(async ({ input, context }) => {
		return await decideSuggestion(
			{ organizationId: context.organization.id, userId: context.user.id },
			input,
		);
	});
