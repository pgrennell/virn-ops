// packages/api/modules/agents/procedures/rotate-credential.ts
//
// Generate a new credential for an existing agent. adminOrgProcedure. Existing MCP sessions
// (when Phase 11 lands) using the old credential will fail to authenticate after rotation.
// Returns the new plaintext credential ONCE.

import { ORPCError } from "@orpc/server";
import { rotateAgentCredential, writeAuditAndActivity } from "@virn/database";
import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";

export const rotateCredential = adminOrgProcedure
	.route({
		method: "POST",
		path: "/agents/{id}/rotate-credential",
		tags: ["Agents"],
		summary: "Rotate an agent's credential (admin/owner only)",
		description:
			"Generates a new credential, replaces the stored hash, returns the new plaintext ONCE. Existing MCP sessions using the old credential will fail to authenticate after rotation. Audit-logs 'agent.credential_rotated'.",
	})
	.input(
		z.object({
			id: z.string().min(1),
		}),
	)
	.handler(async ({ context, input }) => {
		const result = await rotateAgentCredential({
			organizationId: context.organization.id,
			agentId: input.id,
		});
		if (!result) {
			throw new ORPCError("NOT_FOUND", { message: "Agent not found." });
		}

		await writeAuditAndActivity({
			organizationId: context.organization.id,
			actorUserId: context.user.id,
			action: "agent.credential_rotated",
			verb: "rotated credential for",
			entityType: "agent",
			entityId: input.id,
			changes: {
				credentialLastFour: result.credentialLastFour,
				credentialRotatedAt: result.credentialRotatedAt.toISOString(),
			},
		});

		return result;
	});
