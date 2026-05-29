// Phase 10 / v1.5c (PRD §6.4) -- admin-facing list of read receipts for a
// version. Drives the "who's read v3?" surface on the workflow detail page.

import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";
import { listVersionReadReceipts } from "../lib/read-receipts";
import { workflowEngineCall } from "./_utils";

export const listReadReceiptsProc = adminOrgProcedure
	.route({
		method: "GET",
		path: "/workflows/versions/{workflowVersionId}/read-receipts",
		tags: ["Workflows"],
		summary: "List read receipts for a published workflow version (admin/owner only)",
		description:
			"Newest first. Admin-only because the operator-knowledge surface ('who's read this?') is org-management data, not per-user data.",
	})
	.input(z.object({ workflowVersionId: z.string().min(1) }))
	.handler(async ({ input, context }) => {
		return await workflowEngineCall(() =>
			listVersionReadReceipts(
				{ organizationId: context.organization.id, userId: context.user.id },
				input,
			),
		);
	});
