// packages/api/modules/vendors/procedures/list-for-launcher.ts
//
// Launcher-targeted vendor list. protectedOrgProcedure (read access for any org member
// who can launch a run). Returns only active, non-blacklisted vendors with their
// active contacts pre-joined -- single query, no N+1 across the per-role picker.

import { listVendorsForLauncher } from "@virn/database";

import { protectedOrgProcedure } from "../../../orpc/procedures";

export const listForLauncher = protectedOrgProcedure
	.route({
		method: "GET",
		path: "/vendors/launcher-picker",
		tags: ["Vendors"],
		summary: "List active vendors with active contacts for the launcher picker",
		description:
			"Returns active, non-blacklisted vendors in the active org with their active contacts pre-joined. Used by the LauncherForm's per-role assignee picker -- pre-filters at the DB layer so the UI doesn't have to. Empty contacts arrays are returned (not omitted) so the picker can show disabled-with-reason.",
	})
	.handler(async ({ context }) => {
		return await listVendorsForLauncher(context.organization.id);
	});
