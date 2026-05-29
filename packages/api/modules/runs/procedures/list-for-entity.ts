// Phase 10 / v1.5c (PRD §6.5 / R6 lift) -- Active Run card data source.
//
// Returns in-flight runs whose entity context matches the requested
// (entityType, entityId). The card renders at most ~20 rows, hence the
// hard-capped limit. Click target on each row is
//   `/[orgSlug]/library/workflows/[workflowId]/read?runId=<runId>`
// which lights up the Read view's per-run timeline shipped in R5 cont.
//
// Cross-org isolation: org filter lives in the query; the entity itself isn't
// pre-verified here because the resolver is dumb-by-design (we don't enforce
// "you can see this listing" -- the calling page's gating already did). The
// query returns an empty array for a foreign-org entityId since the run-side
// org filter prunes everything.

import { listActiveRunsForEntity } from "@virn/database";
import { z } from "zod";

import { protectedOrgProcedure } from "../../../orpc/procedures";

export const listForEntityProc = protectedOrgProcedure
	.route({
		method: "GET",
		path: "/runs/for-entity/{entityType}/{entityId}",
		tags: ["Runs"],
		summary: "List active runs whose entity context matches",
		description:
			"Returns active runs (status='active') stamped with this (entityType, entityId) at launch time. Used by entity-detail pages' Active Run right-rail card. Org-scoped; foreign-org entity ids return an empty array (not NOT_FOUND, because the resolver doesn't need to know whether the entity exists -- callers are expected to have verified that separately).",
	})
	.input(
		z.object({
			entityType: z.literal("listing"),
			entityId: z.string().min(1),
			limit: z.number().int().positive().max(50).optional(),
		}),
	)
	.handler(async ({ input, context }) => {
		const rows = await listActiveRunsForEntity(
			context.organization.id,
			input.entityType,
			input.entityId,
			{ limit: input.limit },
		);
		return { runs: rows };
	});
