// packages/api/modules/agents/procedures/get.ts
//
// Single-agent fetch scoped to the active org. protectedOrgProcedure (read access for any
// member, same as list). Returns NOT_FOUND for missing / soft-deleted / cross-org -- the
// uniform response prevents existence-probing across orgs.

import { ORPCError } from "@orpc/server";
import { getAgentForOrg } from "@virn/database";
import { z } from "zod";

import { protectedOrgProcedure } from "../../../orpc/procedures";

export const get = protectedOrgProcedure
	.route({
		method: "GET",
		path: "/agents/{id}",
		tags: ["Agents"],
		summary: "Get a single agent by id",
		description:
			"Returns the agent row scoped to the active org. NOT_FOUND if missing, soft-deleted, or in another org -- uniform response prevents cross-org existence probing.",
	})
	.input(
		z.object({
			id: z.string().min(1),
		}),
	)
	.handler(async ({ context, input }) => {
		const agent = await getAgentForOrg(context.organization.id, input.id);
		if (!agent) {
			throw new ORPCError("NOT_FOUND", { message: "Agent not found." });
		}
		return agent;
	});
