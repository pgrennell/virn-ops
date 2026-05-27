// packages/api/modules/agents/procedures/soft-delete.ts
//
// Soft-delete an agent (sets deletedAt + isActive=false). adminOrgProcedure. Historical
// `participant` rows pointing at the agent are preserved via the ON DELETE RESTRICT FK --
// past activity feed entries still show "Turnover AI completed Step 3". New MCP
// authentication for this agent fails after delete (Phase 11).

import { ORPCError } from "@orpc/server";
import { softDeleteAgent, writeAuditAndActivity } from "@virn/database";
import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";

export const softDelete = adminOrgProcedure
	.route({
		method: "DELETE",
		path: "/agents/{id}",
		tags: ["Agents"],
		summary: "Soft-delete an agent (admin/owner only)",
		description:
			"Sets deletedAt + isActive=false. Historical participant rows are preserved (the activity feed still shows past agent actions). New MCP authentication for this agent fails after delete. Idempotent. Audit-logs 'agent.deleted'.",
	})
	.input(
		z.object({
			id: z.string().min(1),
		}),
	)
	.handler(async ({ context, input }) => {
		const result = await softDeleteAgent({
			organizationId: context.organization.id,
			agentId: input.id,
		});
		if (!result.deleted) {
			// Either doesn't exist, cross-org, or already soft-deleted -- uniform response.
			throw new ORPCError("NOT_FOUND", { message: "Agent not found." });
		}

		await writeAuditAndActivity({
			organizationId: context.organization.id,
			actorUserId: context.user.id,
			action: "agent.deleted",
			verb: "deleted",
			entityType: "agent",
			entityId: input.id,
		});

		return { deleted: true };
	});
