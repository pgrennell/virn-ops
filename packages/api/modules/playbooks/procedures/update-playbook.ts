import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";
import { updatePlaybookOp } from "../lib/playbook";
import { playbookEngineCall } from "./_utils";

export const updatePlaybookProc = adminOrgProcedure
	.route({
		method: "PATCH",
		path: "/playbooks/{playbookId}",
		tags: ["Playbooks"],
		summary: "Patch playbook-level fields (name / description / entity-set scope)",
		description:
			"Patches name, description, and/or entitySetIds. Skip a field by omitting it (don't pass null to clear -- the procedure distinguishes 'leave unchanged' from 'set to null/empty'). Use POST /playbooks/{playbookId}/set-active for the is_active toggle and DELETE /playbooks/{playbookId} for archive.",
	})
	.input(
		z.object({
			playbookId: z.string().min(1),
			name: z.string().min(1).max(120).optional(),
			description: z.string().max(2000).nullable().optional(),
			entitySetIds: z.array(z.string().min(1)).optional(),
		}),
	)
	.handler(async ({ input, context }) => {
		await playbookEngineCall(() =>
			updatePlaybookOp(
				{ organizationId: context.organization.id, userId: context.user.id },
				{
					playbookId: input.playbookId,
					name: input.name,
					description: input.description,
					entitySetIds: input.entitySetIds,
				},
			),
		);
		return { ok: true as const };
	});
