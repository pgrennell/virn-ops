// Phase 18b-3 -- in-flight playbook runs for an entity, for the Active Run
// right-rail card on entity-detail pages (sibling to runs.listForEntity).

import { z } from "zod";

import { listActivePlaybookRunsForEntity } from "@virn/database";
import { protectedOrgProcedure } from "../../../orpc/procedures";

export const listActivePlaybookRunsForEntityProc = protectedOrgProcedure
	.route({
		method: "GET",
		path: "/playbook-runs/active-for-entity",
		tags: ["Playbook Runs"],
		summary: "List in-flight playbook runs stamped against an entity",
	})
	.input(
		z.object({
			entityType: z.string().min(1),
			entityId: z.string().min(1),
		}),
	)
	.handler(async ({ input, context }) => {
		const rows = await listActivePlaybookRunsForEntity(
			context.organization.id,
			input.entityType,
			input.entityId,
		);
		return { playbookRuns: rows };
	});
