import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";
import { reorderStepsOp } from "../lib/structure";
import { workflowEngineCall } from "./_utils";

export const reorderStepsProc = adminOrgProcedure
	.route({
		method: "POST",
		path: "/workflows/versions/{workflowVersionId}/steps/reorder",
		tags: ["Workflows"],
		summary: "Reassign step positions inside a draft version",
		description:
			"Batched update -- caller supplies the new (stepId, position) tuples in one call so the canvas drag-reorder commits atomically.",
	})
	.input(
		z.object({
			workflowVersionId: z.string().min(1),
			ordering: z.array(
				z.object({
					stepId: z.string().min(1),
					position: z.number().int().min(0),
				}),
			),
		}),
	)
	.handler(async ({ input, context }) => {
		await workflowEngineCall(() =>
			reorderStepsOp(
				{ organizationId: context.organization.id, userId: context.user.id },
				input,
			),
		);
		return { ok: true as const };
	});
