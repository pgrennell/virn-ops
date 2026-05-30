// Phase 15 -- list every acknowledgment in the org. Powers the index at
// /compliance/acknowledgments. Read-only; the acknowledge action surface
// (the WRITE path) is Phase 16's governance flows.
//
// Gating: adminOrgProcedure today. Once ADR-004 ships, widen to also accept
// reviewer-grade members (the compliance pack's primary audience).

import { listAcknowledgmentsForOrg } from "@virn/database";
import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";

export const listAcknowledgmentsProc = adminOrgProcedure
	.route({
		method: "GET",
		path: "/acknowledgments/list",
		tags: ["Acknowledgments"],
		summary: "List every acknowledgment in the org, newest first",
		description:
			"Paged list joining acknowledgment + workflow + workflow_version + user. Returns rows + totalCount so the compliance index can paginate.",
	})
	.input(
		z.object({
			limit: z.number().int().min(1).max(100).optional(),
			offset: z.number().int().min(0).optional(),
		}),
	)
	.handler(async ({ input, context }) => {
		return await listAcknowledgmentsForOrg({
			organizationId: context.organization.id,
			limit: input.limit,
			offset: input.offset,
		});
	});
