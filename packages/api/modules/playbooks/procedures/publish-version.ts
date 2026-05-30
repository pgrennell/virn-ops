// Phase 18a -- promote a playbook draft to published. Admin-only (write
// path on a workflow-grade resource). The lib enforces the publish race
// guard + the "must have at least one step" precondition.

import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";
import { publishPlaybookVersion } from "../lib/publish";
import { playbookEngineCall } from "./_utils";

export const publishPlaybookVersionProc = adminOrgProcedure
	.route({
		method: "POST",
		path: "/playbooks/versions/{versionId}/publish",
		tags: ["Playbooks"],
		summary: "Publish a draft playbook version",
		description:
			"Atomic transition: publishedAt IS NULL -> NOT NULL. Refuses on PUBLISH_RACE (concurrent publisher), VERSION_NOT_DRAFT (already published), VERSION_HAS_NO_STEPS (empty playbook).",
	})
	.input(z.object({ versionId: z.string().min(1) }))
	.handler(async ({ input, context }) => {
		return await playbookEngineCall(() =>
			publishPlaybookVersion(
				{ organizationId: context.organization.id, userId: context.user.id },
				input,
			),
		);
	});
