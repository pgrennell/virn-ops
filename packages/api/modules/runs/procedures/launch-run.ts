import { z } from "zod";

import { protectedOrgProcedure } from "../../../orpc/procedures";
import { launchRun } from "../lib/launch-run";
import { runEngineCall } from "./_utils";

const roleAssignmentSchema = z.object({
	roleId: z.string().min(1),
	userId: z.string().min(1).nullish(),
	guestEmail: z.string().email().nullish(),
	guestName: z.string().min(1).nullish(),
});

export const launchRunProc = protectedOrgProcedure
	.route({
		method: "POST",
		path: "/runs/launch",
		tags: ["Runs"],
		summary: "Launch a new run from a published workflow version",
		description:
			"Snapshots the workflow version into run + run_step + field_value rows. Returns the new runId.",
	})
	.input(
		z.object({
			workflowId: z.string().min(1),
			workflowVersionId: z.string().min(1).optional(),
			kickoffValues: z.record(z.string(), z.unknown()).default({}),
			roleAssignments: z.array(roleAssignmentSchema).default([]),
			title: z.string().min(1).optional(),
		}),
	)
	.handler(async ({ input, context }) => {
		return await runEngineCall(() =>
			launchRun(
				{ organizationId: context.organization.id, userId: context.user.id },
				input,
			),
		);
	});
