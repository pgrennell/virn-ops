// packages/api/modules/vendors/procedures/list.ts
//
// List non-soft-deleted vendors in the active org. protectedOrgProcedure (not admin-only)
// because read-shape access is useful for picker UIs (the launcher's vendor picker in
// the chunk after this). Mutations are admin-only -- see other procedures.

import { listVendorsForOrg } from "@virn/database";

import { protectedOrgProcedure } from "../../../orpc/procedures";

export const list = protectedOrgProcedure
	.route({
		method: "GET",
		path: "/vendors",
		tags: ["Vendors"],
		summary: "List vendors in the active organization",
		description:
			"Returns one row per non-soft-deleted vendor with id, name, description, category, status, isActive, contactCount, primaryContactName, createdBy. Read access for any org member -- mutations are admin/owner only.",
	})
	.handler(async ({ context }) => {
		return await listVendorsForOrg(context.organization.id);
	});
