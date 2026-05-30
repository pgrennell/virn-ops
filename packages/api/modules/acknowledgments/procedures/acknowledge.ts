// Phase 16 -- acknowledge action surface. Any org member can acknowledge a
// published workflow_version (gating composes capability + published-status
// + org-scope in the lib). Idempotent against the (version, user) unique
// constraint; re-acknowledging is a no-op (returns the existing row).

import { z } from "zod";

import { protectedOrgProcedure } from "../../../orpc/procedures";
import { acknowledgeVersion } from "../lib/acknowledge";

export const acknowledgeProc = protectedOrgProcedure
	.route({
		method: "POST",
		path: "/acknowledgments/acknowledge",
		tags: ["Acknowledgments"],
		summary: "Acknowledge a published workflow version (compliance sign-off)",
		description:
			"Idempotent. Returns the row id + timestamp + alreadyExisted flag. Refuses on draft versions (BAD_REQUEST/VERSION_NOT_PUBLISHED), cross-org versions (NOT_FOUND/VERSION_NOT_FOUND), or when governance.acknowledgments is off (FORBIDDEN/CAPABILITY_DISABLED).",
	})
	.input(z.object({ workflowVersionId: z.string().min(1) }))
	.handler(async ({ input, context }) => {
		return await acknowledgeVersion(
			{ organizationId: context.organization.id, userId: context.user.id },
			input,
		);
	});
