// packages/api/modules/organizations/procedures/list-members.ts
//
// List members of the active org for picker UIs (the Launcher's role-assignment
// picker is the first consumer; future surfaces like a member-mention picker or a
// reviewer picker can read the same shape). protectedOrgProcedure so org is from
// session, NOT input -- members of org A can't enumerate org B's roster.
//
// Holds minimal on purpose: id, name, email, image, role. The day a consumer needs
// filter-by-role or paginate-by-N is the day it gets one (D-020 wildcard-export
// lesson applied to a sibling surface -- expansion is silent + permanent if you
// don't push back).

import { listMembersForOrg } from "@virn/database";

import { protectedOrgProcedure } from "../../../orpc/procedures";

export const listMembers = protectedOrgProcedure
	.route({
		method: "GET",
		path: "/organizations/members",
		tags: ["Organizations"],
		summary: "List members of the active organization",
		description:
			"Returns one row per member with userId, name, email, image, role. Used by picker UIs (Launcher role-assignment picker, future mention/reviewer pickers). Org-scoped via session context -- callers can't enumerate other orgs' rosters.",
	})
	.handler(async ({ context }) => {
		return await listMembersForOrg(context.organization.id);
	});
