import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";
import { deleteFieldOp } from "../lib/structure";
import { workflowEngineCall } from "./_utils";

export const deleteFieldProc = adminOrgProcedure
	.route({
		method: "DELETE",
		path: "/workflows/fields/{fieldId}",
		tags: ["Workflows"],
		summary: "Delete a field from a draft version",
		description:
			"Refuses if the field is referenced by a condition or a due-rule (FIELD_HAS_REFERENCERS). Silently breaking the reference is a worse failure mode than forcing the user to clear it first.",
	})
	.input(z.object({ fieldId: z.string().min(1) }))
	.handler(async ({ input, context }) => {
		await workflowEngineCall(() =>
			deleteFieldOp(
				{ organizationId: context.organization.id, userId: context.user.id },
				input,
			),
		);
		return { ok: true as const };
	});
