// Phase 16 -- read shape for the workflow detail's Approval chip.
// Returns the newest approval row (or null) so the chip can render the
// right treatment: no row -> Request, pending -> Awaiting, approved/
// rejected -> decision display.

import { z } from "zod";

import { protectedOrgProcedure } from "../../../orpc/procedures";
import { getLatestApprovalStatus } from "../lib/approval";

export const getLatestProc = protectedOrgProcedure
	.route({
		method: "GET",
		path: "/approvals/latest",
		tags: ["Approvals"],
		summary: "Get the latest approval row for a version (drives the chip)",
		description:
			"Returns the newest version_approval for the given workflow_version, or null if none exists. Cross-org versions return null (anti-enumeration posture, matches getMyAcknowledgmentStatus).",
	})
	.input(z.object({ workflowVersionId: z.string().min(1) }))
	.handler(async ({ input, context }) => {
		return await getLatestApprovalStatus(
			{ organizationId: context.organization.id, userId: context.user.id },
			input,
		);
	});
