import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";
import { discardDraft } from "../lib/publish";
import { workflowEngineCall } from "./_utils";

export const discardDraftProc = adminOrgProcedure
	.route({
		method: "POST",
		path: "/workflows/versions/{versionId}/discard",
		tags: ["Workflows"],
		summary: "Discard a draft workflow_version",
		description:
			"Refuses if the version isn't a draft, or if it's the only version of the workflow (would orphan the workflow row -- archive the workflow instead).",
	})
	.input(z.object({ versionId: z.string().min(1) }))
	.handler(async ({ input, context }) => {
		await workflowEngineCall(() =>
			discardDraft(
				{ organizationId: context.organization.id, userId: context.user.id },
				input,
			),
		);
		return { ok: true as const };
	});
