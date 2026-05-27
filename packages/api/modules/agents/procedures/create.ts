// packages/api/modules/agents/procedures/create.ts
//
// Create an org-scoped agent. adminOrgProcedure -- only admin/owner can mint agents (they
// hold credentials that can act on org data via the Phase 11 MCP boundary).
//
// Returns the plaintext credential ONCE. Standard service-account pattern: the user is
// responsible for storing it; we never see plaintext again. Lost = rotate.

import { ORPCError } from "@orpc/server";
import { createAgent, writeAuditAndActivity } from "@virn/database";
import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";

export const create = adminOrgProcedure
	.route({
		method: "POST",
		path: "/agents",
		tags: ["Agents"],
		summary: "Create an agent (admin/owner only)",
		description:
			"Creates an org-scoped agent with a freshly generated credential. The plaintext credential is returned ONCE -- standard service-account pattern. Audit-logs 'agent.created'.",
	})
	.input(
		z.object({
			name: z.string().min(1).max(120),
			description: z.string().max(2000).nullish(),
		}),
	)
	.handler(async ({ context, input }) => {
		try {
			const result = await createAgent({
				organizationId: context.organization.id,
				name: input.name,
				description: input.description ?? null,
				createdByUserId: context.user.id,
			});

			await writeAuditAndActivity({
				organizationId: context.organization.id,
				actorUserId: context.user.id,
				action: "agent.created",
				verb: "created",
				entityType: "agent",
				entityId: result.id,
				changes: {
					name: result.name,
					description: result.description,
				},
				activityData: {
					agentName: result.name,
				},
			});

			return result;
		} catch (e) {
			// UNIQUE(organizationId, name) violation -> readable refusal
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
