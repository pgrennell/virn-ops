import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";
import { publishVersion } from "../lib/publish";
import { workflowEngineCall } from "./_utils";

export const publishVersionProc = adminOrgProcedure
	.route({
		method: "POST",
		path: "/workflows/versions/{versionId}/publish",
		tags: ["Workflows"],
		summary: "Promote a draft workflow_version to published",
		description:
			"Atomic draft -> published transition. After this the version is immutable -- launchRun snapshots it. Refuses on non-draft, on empty (no steps), and on a publish race (two concurrent publishers; loser receives CONFLICT and should refetch).",
	})
	.input(z.object({ versionId: z.string().min(1) }))
	.handler(async ({ input, context }) => {
		return await workflowEngineCall(() =>
			publishVersion(
				{ organizationId: context.organization.id, userId: context.user.id },
				input,
			),
		);
	});
