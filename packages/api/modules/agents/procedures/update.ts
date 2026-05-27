// packages/api/modules/agents/procedures/update.ts
//
// Patch an agent's mutable fields (name, description, isActive). adminOrgProcedure --
// toggling isActive=false fails authentication at the MCP boundary (Phase 11), so this is
// a privileged action.

import { ORPCError } from "@orpc/server";
import { updateAgent, writeAuditAndActivity } from "@virn/database";
import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";

export const update = adminOrgProcedure
	.route({
		method: "PATCH",
		path: "/agents/{id}",
		tags: ["Agents"],
		summary: "Update an agent (admin/owner only)",
		description:
			"Patches name, description, or isActive. isActive=false soft-disables -- the agent fails MCP authentication (Phase 11) but historical participant rows + audit trail are preserved. Audit-logs 'agent.updated'.",
	})
	.input(
		z.object({
			id: z.string().min(1),
			name: z.string().min(1).max(120).optional(),
			description: z.string().max(2000).nullish(),
			isActive: z.boolean().optional(),
		}),
	)
	.handler(async ({ context, input }) => {
		const { id, ...patch } = input;
		try {
			const updated = await updateAgent({
				organizationId: context.organization.id,
				agentId: id,
				name: patch.name,
				description: patch.description ?? undefined,
				isActive: patch.isActive,
			});
			if (!updated) {
				throw new ORPCError("NOT_FOUND", { message: "Agent not found." });
			}

			await writeAuditAndActivity({
				organizationId: context.organization.id,
				actorUserId: context.user.id,
				action: "agent.updated",
				verb: "updated",
				entityType: "agent",
				entityId: id,
				changes: patch,
				activityData: { agentName: updated.name },
			});

			return updated;
		} catch (e) {
			if (
				e instanceof Error &&
				/uq_agent_org_name|duplicate key/i.test(e.message)
			) {
				throw new ORPCError("CONFLICT", {
					message: `An agent named "${input.name}" already exists in this organization.`,
				});
			}
			throw e;
		}
	});
