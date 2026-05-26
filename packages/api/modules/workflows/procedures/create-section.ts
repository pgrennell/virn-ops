import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";
import { createSection } from "../lib/structure";
import { workflowEngineCall } from "./_utils";

export const createSectionProc = adminOrgProcedure
	.route({
		method: "POST",
		path: "/workflows/versions/{workflowVersionId}/sections",
		tags: ["Workflows"],
		summary: "Create a section in a draft version",
	})
	.input(
		z.object({
			workflowVersionId: z.string().min(1),
			title: z.string().min(1).max(200),
			position: z.number().int().min(0).optional(),
		}),
	)
	.handler(async ({ input, context }) => {
		return await workflowEngineCall(() =>
			createSection(
				{ organizationId: context.organization.id, userId: context.user.id },
				input,
			),
		);
	});
