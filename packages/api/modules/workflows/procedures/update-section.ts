import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";
import { updateSectionOp } from "../lib/structure";
import { workflowEngineCall } from "./_utils";

export const updateSectionProc = adminOrgProcedure
	.route({
		method: "PATCH",
		path: "/workflows/sections/{sectionId}",
		tags: ["Workflows"],
		summary: "Update a section in a draft version",
	})
	.input(
		z.object({
			sectionId: z.string().min(1),
			title: z.string().min(1).max(200).optional(),
			position: z.number().int().min(0).optional(),
		}),
	)
	.handler(async ({ input, context }) => {
		await workflowEngineCall(() =>
			updateSectionOp(
				{ organizationId: context.organization.id, userId: context.user.id },
				input,
			),
		);
		return { ok: true as const };
	});
