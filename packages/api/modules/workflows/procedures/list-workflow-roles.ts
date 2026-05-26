import { listWorkflowRolesForOrg } from "@virn/database";

import { protectedOrgProcedure } from "../../../orpc/procedures";

export const listWorkflowRolesProc = protectedOrgProcedure
	.route({
		method: "GET",
		path: "/workflow-roles",
		tags: ["Workflows"],
		summary: "List workflow roles in the active organization",
		description:
			"Workflow roles (e.g. 'Operator', 'Reviewer') are ORG-level -- a single role is reused across many workflows + versions. Distinct from Better Auth's org roles (owner/admin/member), which govern app-level permissions.",
	})
	.handler(async ({ context }) => {
		return await listWorkflowRolesForOrg(context.organization.id);
	});
