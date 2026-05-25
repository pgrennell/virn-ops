import { applyEnablementProfile } from "@virn/database";
import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";

export const applyProfile = adminOrgProcedure
	.route({
		method: "POST",
		path: "/config/profiles/apply",
		tags: ["Config"],
		summary: "Apply an enablement profile",
		description:
			"Bulk-sets profile-managed capabilities for the active organization: enables every capability in the profile, disables every other profile-managed capability. Capabilities outside profile scope are NOT touched, preserving custom overrides.",
	})
	.input(
		z.object({
			profile: z.enum(["checklist", "sop", "automation"]),
		}),
	)
	.handler(async ({ input, context }) => {
		return await applyEnablementProfile(context.organization.id, input.profile);
	});
