import { z } from "zod";

import { protectedOrgProcedure } from "../../../orpc/procedures";
import { setRunFieldValue } from "../lib/set-field-value";
import { runEngineCall } from "./_utils";

export const setFieldValueProc = protectedOrgProcedure
	.route({
		method: "POST",
		path: "/runs/field-value",
		tags: ["Runs"],
		summary: "Set a field value on a run step (or kickoff)",
		description:
			"Validates the value against the snapshotted field's type + config (Invariant #5: fields are referenced by stable key). For step-scoped fields the caller must be an assignee or org admin/owner; kickoff writes after launch are admin/owner only.",
	})
	.input(
		z.object({
			runStepId: z.string().min(1).nullable(),
			runId: z.string().min(1).optional(),
			fieldKey: z.string().min(1),
			value: z.unknown(),
		}),
	)
	.handler(async ({ input, context }) => {
		const isAdminOrOwner =
			context.membership.role === "admin" || context.membership.role === "owner";
		return await runEngineCall(() =>
			setRunFieldValue(
				{
					organizationId: context.organization.id,
					userId: context.user.id,
					isAdminOrOwner,
				},
				input,
			),
		);
	});
