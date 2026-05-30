// Phase 15 -- single acknowledgment receipt fetch. Powers the receipt page at
// /compliance/acknowledgments/[id]. Org-scoped; cross-org / non-existent ids
// surface as NOT_FOUND to prevent enumeration.

import { ORPCError } from "@orpc/server";
import { getAcknowledgmentForOrg } from "@virn/database";
import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";

export const getAcknowledgmentProc = adminOrgProcedure
	.route({
		method: "GET",
		path: "/acknowledgments/{acknowledgmentId}",
		tags: ["Acknowledgments"],
		summary: "Fetch a single acknowledgment receipt",
		description:
			"Returns the acknowledgment + joined workflow + version + user + organization name. NOT_FOUND for cross-org or non-existent ids.",
	})
	.input(
		z.object({
			acknowledgmentId: z.string().min(1),
		}),
	)
	.handler(async ({ input, context }) => {
		const receipt = await getAcknowledgmentForOrg({
			organizationId: context.organization.id,
			acknowledgmentId: input.acknowledgmentId,
		});
		if (!receipt) {
			throw new ORPCError("NOT_FOUND", {
				message: "Acknowledgment not found in this organization.",
			});
		}
		return receipt;
	});
