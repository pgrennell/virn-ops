// Phase 18a -- list playbook_run rows in the org. Read-only; the dispatcher
// + orchestrator that POPULATE this table land in Phase 18b. Today the list
// is always empty for any org -- the procedure exists so the Builder + Read
// views can render the "0 runs yet" state without breaking.

import { listPlaybookRunsForOrg } from "@virn/database";
import { z } from "zod";

import { protectedOrgProcedure } from "../../../orpc/procedures";

const STATUS = z.enum([
	"pending",
	"active",
	"waiting",
	"completed",
	"failed",
	"cancelled",
]);

export const listPlaybookRunsProc = protectedOrgProcedure
	.route({
		method: "GET",
		path: "/playbook-runs",
		tags: ["Playbook Runs"],
		summary: "List playbook_run rows in the org, newest first",
		description:
			"Joins parent playbook + version. Optional playbookId + status filters. Returns rows + totalCount for pagination. Phase 18a read surface for Phase 18b's execution pipeline.",
	})
	.input(
		z.object({
			playbookId: z.string().min(1).optional(),
			status: STATUS.optional(),
			limit: z.number().int().min(1).max(100).optional(),
			offset: z.number().int().min(0).optional(),
		}),
	)
	.handler(async ({ input, context }) => {
		return await listPlaybookRunsForOrg({
			organizationId: context.organization.id,
			playbookId: input.playbookId,
			status: input.status,
			limit: input.limit,
			offset: input.offset,
		});
	});
