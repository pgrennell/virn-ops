// packages/api/modules/packs/procedures/get-starter-content-status.ts
//
// Read-only status check for the StarterContentCard in /settings/general. Returns
// (a) whether the property-ops pack is available at the platform level (false if
// nobody's run the platform seed), and (b) whether the active org has installed.
// Any org member can read this (the install action itself is admin-only).

import { getPropertyOpsInstallStatus } from "../lib/install-property-ops";

import { protectedOrgProcedure } from "../../../orpc/procedures";

export const getStarterContentStatus = protectedOrgProcedure
	.route({
		method: "GET",
		path: "/packs/starter-content/status",
		tags: ["Packs"],
		summary: "Get install status of the property-ops starter content for this org",
		description:
			"Returns { packAvailable, installed, installedAt } so the UI can render an enabled 'Install' button or a disabled 'Already installed' badge.",
	})
	.handler(async ({ context }) => {
		return await getPropertyOpsInstallStatus(context.organization.id);
	});
