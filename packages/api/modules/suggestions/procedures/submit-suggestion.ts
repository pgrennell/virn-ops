// Phase 16 -- submit a suggestion against a workflow. Any org member can
// submit; the procedure layer composes capability + workflow-org-scope
// checks via the lib.

import { z } from "zod";

import { protectedOrgProcedure } from "../../../orpc/procedures";
import { submitSuggestion } from "../lib/suggestion";

export const submitSuggestionProc = protectedOrgProcedure
	.route({
		method: "POST",
		path: "/suggestions/submit",
		tags: ["Suggestions"],
		summary: "Submit a suggestion against a workflow",
		description:
			"Creates an open suggestion. Refuses when governance.suggestions is off or when the workflow doesn't exist in this org. Body is required and capped at 5000 chars to keep the textarea sane.",
	})
	.input(
		z.object({
			workflowId: z.string().min(1),
			body: z.string().min(1).max(5000),
		}),
	)
	.handler(async ({ input, context }) => {
		return await submitSuggestion(
			{ organizationId: context.organization.id, userId: context.user.id },
			input,
		);
	});
