// Phase 16 -- request a version_approval for a draft workflow_version.
// Admin-only today (workflows write surface is adminOrgProcedure); the lib
// composes capability + draft-only + no-existing-pending checks.

import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";
import { requestApproval } from "../lib/approval";

export const requestApprovalProc = adminOrgProcedure
	.route({
		method: "POST",
		path: "/approvals/request",
		tags: ["Approvals"],
		summary: "Request approval for a draft workflow version",
		description:
			"Creates a pending version_approval row. Refuses when governance.approvals is off, when the version isn't a draft, or when a pending/approved row already exists for it.",
	})
	.input(
		z.object({
			workflowVersionId: z.string().min(1),
			approverId: z.string().min(1).nullable().optional(),
		}),
	)
	.handler(async ({ input, context }) => {
		return await requestApproval(
			{ organizationId: context.organization.id, userId: context.user.id },
			input,
		);
	});
