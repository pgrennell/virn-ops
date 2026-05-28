// Phase 9.5g (PRD §6.6) -- toggle organization.requireConciergeReview. Admin-only;
// flipping this changes the Builder's Publish-button behavior for every author in
// the org (draft becomes "Submit for review" when on). The flag's value is read
// server-side on the Builder page mount (Better Auth's ActiveOrganization doesn't
// surface custom columns) so the toggle effect appears on next navigation /
// refetch rather than instantly across other tabs -- acceptable for an admin
// config knob.
//
// Audit deliberately omitted -- the audit_log.entityType enum doesn't include
// 'organization' (it's a Better-Auth-owned table). Matches the convention used by
// other org-config mutations (rename, logo upload) which also don't audit.

import { updateOrganization } from "@virn/database";
import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";

export const updateConciergeReview = adminOrgProcedure
	.route({
		method: "POST",
		path: "/organizations/concierge-review",
		tags: ["Organizations"],
		summary: "Toggle the org's concierge-review flag (admin/owner only)",
		description:
			"Flips workflow.publish-vs-submit-for-review behavior across the org. With this on, draft publishes must be approved by an admin via /library/reviews; with it off, admins publish directly.",
	})
	.input(z.object({ requireConciergeReview: z.boolean() }))
	.handler(async ({ context, input }) => {
		await updateOrganization({
			id: context.organization.id,
			requireConciergeReview: input.requireConciergeReview,
		});
		return { ok: true as const, requireConciergeReview: input.requireConciergeReview };
	});
