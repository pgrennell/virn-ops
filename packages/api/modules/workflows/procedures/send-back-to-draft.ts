// Phase 9.5g (PRD §6.6) -- send an in-review workflow back to draft state with an
// optional comment for the author. Admin-only. Atomic transition with from-state guard
// to close the two-admin race.

import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";
import { sendBackToDraft } from "../lib/workflow";
import { workflowEngineCall } from "./_utils";

export const sendBackToDraftProc = adminOrgProcedure
	.route({
		method: "POST",
		path: "/workflows/{workflowId}/send-back-to-draft",
		tags: ["Workflows"],
		summary: "Send an in-review workflow back to draft",
		description:
			"Transitions review_state from 'in_review' back to 'draft'. The optional comment is recorded on the audit row (no comment table yet — surfaces in the activity feed metadata). Refuses if the workflow isn't currently in_review.",
	})
	.input(
		z.object({
			workflowId: z.string().min(1),
			comment: z.string().max(2000).nullish(),
		}),
	)
	.handler(async ({ input, context }) => {
		await workflowEngineCall(() =>
			sendBackToDraft(
				{ organizationId: context.organization.id, userId: context.user.id },
				input,
			),
		);
		return { ok: true as const };
	});
