// packages/api/modules/datasets/procedures/list.ts
//
// List non-archived data sets in the active org. protectedOrgProcedure (any org member
// can read -- the lookup-field run UI in Phase 9b needs read access for picker
// resolution). Mutations are admin/owner only.

import { listDataSetsForOrg } from "@virn/database";

import { protectedOrgProcedure } from "../../../orpc/procedures";

export const list = protectedOrgProcedure
	.route({
		method: "GET",
		path: "/data-sets",
		tags: ["DataSets"],
		summary: "List data sets in the active organization",
		description:
			"Returns one row per non-archived data set with id, key, name, description, status, recordCount. Read access for any org member -- mutations are admin/owner only.",
	})
	.handler(async ({ context }) => {
		return await listDataSetsForOrg(context.organization.id);
	});
