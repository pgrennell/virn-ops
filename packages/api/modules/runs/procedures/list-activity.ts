// Phase 10 / v1.5c (PRD §6.4 / R5 cont.) -- per-run activity timeline.
//
// Returns the activity_event rows scoped to one run, oldest-first, so the
// Read view's right column can render a top-to-bottom timeline when opened
// with `?runId=<id>`. The data is the same passive stream the org's home
// timeline reads from; this procedure is purpose-built to keep cross-org
// isolation tight (one runId at a time, refuses with NOT_FOUND when the
// run lives in another org).

import { ORPCError } from "@orpc/server";
import { getRunForOrg, listActivityForRun } from "@virn/database";
import { z } from "zod";

import { protectedOrgProcedure } from "../../../orpc/procedures";

export const listActivityProc = protectedOrgProcedure
	.route({
		method: "GET",
		path: "/runs/{runId}/activity",
		tags: ["Runs"],
		summary: "List the activity timeline for one run",
		description:
			"Returns activity_event rows for the given run, oldest-first. Cross-org access refuses with NOT_FOUND so callers can't enumerate other orgs' run ids.",
	})
	.input(
		z.object({
			runId: z.string().min(1),
			limit: z.number().int().positive().max(500).optional(),
		}),
	)
	.handler(async ({ input, context }) => {
		// Pre-check the run exists + belongs to the caller's org. The activity
		// query already filters on org, but checking via getRunForOrg first lets
		// us return NOT_FOUND for a cross-org or non-existent runId instead of
		// an empty result -- the empty case is semantically "no activity yet on
		// a real run," which is different from "you can't see this run."
		const run = await getRunForOrg(context.organization.id, input.runId);
		if (!run) {
			throw new ORPCError("NOT_FOUND", {
				message: "Run not found in this organization.",
			});
		}
		const rows = await listActivityForRun(
			context.organization.id,
			input.runId,
			{ limit: input.limit },
		);
		return { events: rows };
	});
