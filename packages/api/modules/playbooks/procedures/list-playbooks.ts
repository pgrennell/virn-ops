import { listPlaybooksForOrg } from "@virn/database";
import { z } from "zod";

import { protectedOrgProcedure } from "../../../orpc/procedures";

export const listPlaybooksProc = protectedOrgProcedure
	.route({
		method: "GET",
		path: "/playbooks",
		tags: ["Playbooks"],
		summary: "List playbooks in the active organization",
		description:
			"Returns the org's playbooks, excluding soft-deleted rows. Used by the Playbooks tab in the Library and the Phase 18b dispatcher's 'active playbooks' pre-filter (which also requires is_active=true). Ordered by name.",
	})
	.input(z.object({}).optional())
	.handler(async ({ context }) => {
		return await listPlaybooksForOrg({
			organizationId: context.organization.id,
		});
	});
