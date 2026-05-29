import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";
import { createPlaybookOp } from "../lib/playbook";
import { playbookEngineCall } from "./_utils";

export const createPlaybookProc = adminOrgProcedure
	.route({
		method: "POST",
		path: "/playbooks",
		tags: ["Playbooks"],
		summary: "Create a new playbook + initial draft version",
		description:
			"Inserts a playbook row and a v1 draft playbook_version in a single transaction. Defaults to is_active=false (must be explicitly enabled before the dispatcher fires it) and reviewState='draft'. Pass entitySetIds if scoping is known at create time.",
	})
	.input(
		z.object({
			name: z.string().min(1).max(120),
			description: z.string().max(2000).nullable().optional(),
			entitySetIds: z.array(z.string().min(1)).optional(),
		}),
	)
	.handler(async ({ input, context }) => {
		return await playbookEngineCall(() =>
			createPlaybookOp(
				{ organizationId: context.organization.id, userId: context.user.id },
				{
					name: input.name,
					description: input.description ?? null,
					entitySetIds: input.entitySetIds,
				},
			),
		);
	});
