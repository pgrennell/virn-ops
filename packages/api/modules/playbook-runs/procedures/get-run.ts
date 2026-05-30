// Phase 18a -- fetch a single playbook_run row. NOT_FOUND for cross-org ids.

import { ORPCError } from "@orpc/server";
import { getPlaybookRunForOrg } from "@virn/database";
import { z } from "zod";

import { protectedOrgProcedure } from "../../../orpc/procedures";

export const getPlaybookRunProc = protectedOrgProcedure
	.route({
		method: "GET",
		path: "/playbook-runs/{runId}",
		tags: ["Playbook Runs"],
		summary: "Fetch a single playbook_run",
	})
	.input(z.object({ runId: z.string().min(1) }))
	.handler(async ({ input, context }) => {
		const row = await getPlaybookRunForOrg({
			organizationId: context.organization.id,
			runId: input.runId,
		});
		if (!row) {
			throw new ORPCError("NOT_FOUND", {
				message: "Playbook run not found.",
				data: { code: "PLAYBOOK_RUN_NOT_FOUND" },
			});
		}
		return row;
	});
