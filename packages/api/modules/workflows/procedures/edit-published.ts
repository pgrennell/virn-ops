import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";
import { editPublished } from "../lib/publish";
import { workflowEngineCall } from "./_utils";

export const editPublishedProc = adminOrgProcedure
	.route({
		method: "POST",
		path: "/workflows/{workflowId}/edit",
		tags: ["Workflows"],
		summary: "Resume the workflow's open draft, or fork a new draft from the latest published version",
		description:
			"At most ONE open draft per workflow -- enforced here, not in the UI. If a draft exists, returns it (`forked: false`). If not, deep-copies the latest published version into a fresh draft (sections/steps/fields/step_dependencies; field.key preserved verbatim per Invariant #5; IDs remapped) and returns the new draft id (`forked: true`). In-flight runs are untouched (they hold their own snapshot per Invariant #4).",
	})
	.input(z.object({ workflowId: z.string().min(1) }))
	.handler(async ({ input, context }) => {
		return await workflowEngineCall(() =>
			editPublished(
				{ organizationId: context.organization.id, userId: context.user.id },
				input,
			),
		);
	});
