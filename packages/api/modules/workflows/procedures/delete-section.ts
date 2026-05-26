import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";
import { deleteSectionOp } from "../lib/structure";
import { workflowEngineCall } from "./_utils";

export const deleteSectionProc = adminOrgProcedure
	.route({
		method: "DELETE",
		path: "/workflows/sections/{sectionId}",
		tags: ["Workflows"],
		summary: "Delete a section from a draft version",
		description:
			"Steps in the section have their sectionId set to null (schema behavior). The builder can re-bucket them; nothing is lost.",
	})
	.input(z.object({ sectionId: z.string().min(1) }))
	.handler(async ({ input, context }) => {
		await workflowEngineCall(() =>
			deleteSectionOp(
				{ organizationId: context.organization.id, userId: context.user.id },
				input,
			),
		);
		return { ok: true as const };
	});
