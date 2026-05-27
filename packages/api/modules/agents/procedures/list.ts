// packages/api/modules/agents/procedures/list.ts
//
// List non-soft-deleted agents in the active org. protectedOrgProcedure (not admin-only)
// because read-shape access is useful for picker UIs that future surfaces will build (Phase
// 8 step 3 step-assignment picker, etc.). Mutations are admin-only -- see other procedures.

import { listAgentsForOrg } from "@virn/database";

import { protectedOrgProcedure } from "../../../orpc/procedures";

export const list = protectedOrgProcedure
	.route({
		method: "GET",
		path: "/agents",
		tags: ["Agents"],
		summary: "List agents in the active organization",
		description:
			"Returns one row per non-soft-deleted agent with id, name, description, isActive, credentialLastFour, credentialRotatedAt, createdBy. Credential hash is NEVER returned. Read access for any org member -- mutations are admin/owner only.",
	})
	.handler(async ({ context }) => {
		return await listAgentsForOrg(context.organization.id);
	});
