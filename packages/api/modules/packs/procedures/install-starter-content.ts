// packages/api/modules/packs/procedures/install-starter-content.ts
//
// adminOrgProcedure. Materializes the property-ops pack into the active org --
// vendor categories, workflow roles, and the STR Turnover & Housekeeping workflow
// (Phase 17a). Idempotent at the pack-install boundary: re-running returns
// `alreadyInstalled: true` without writing anything new.

import { ORPCError } from "@orpc/server";

import { installPropertyOpsPack } from "../lib/install-property-ops";

import { adminOrgProcedure } from "../../../orpc/procedures";

export const installStarterContent = adminOrgProcedure
	.route({
		method: "POST",
		path: "/packs/starter-content/install",
		tags: ["Packs"],
		summary: "Install the property-ops starter content (admin/owner only)",
		description:
			"Idempotently installs the property-ops pack into the active org. Creates vendor categories, workflow roles, and a published 'STR Turnover & Housekeeping' workflow. Re-running is a no-op (returns alreadyInstalled: true). Audit-logs 'pack.installed'.",
	})
	.handler(async ({ context }) => {
		try {
			const result = await installPropertyOpsPack({
				organizationId: context.organization.id,
				userId: context.user.id,
			});
			return {
				alreadyInstalled: result.alreadyInstalled,
				packInstallId: result.packInstallId,
				summary: {
					vendorCategoriesCreated: result.created.vendorCategories,
					workflowRolesCreated: result.created.workflowRoles,
					workflowsCreated: result.created.workflows.length,
					workflows: result.created.workflows.map((w) => ({
						workflowId: w.workflowId,
						title: w.title,
					})),
				},
			};
		} catch (err) {
			if (err instanceof Error && /not seeded at platform/i.test(err.message)) {
				// The platform-seed tooling script hasn't been run yet. Distinct, customer-safe
				// error -- the internal thrown error (install-property-ops.ts) keeps the exact
				// seed command for ops/logs; the admin just gets a contact-support prompt.
				throw new ORPCError("SERVICE_UNAVAILABLE", {
					message:
						"The property-ops starter content isn't available yet. Contact support and we'll get it enabled.",
					data: { code: "PACK_NOT_SEEDED" },
				});
			}
			throw err;
		}
	});
