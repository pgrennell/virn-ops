import { getEffectiveSettings } from "@virn/database";

import { protectedOrgProcedure } from "../../../orpc/procedures";

export const listSettings = protectedOrgProcedure
	.route({
		method: "GET",
		path: "/config/settings",
		tags: ["Config"],
		summary: "List effective settings for the active organization",
		description:
			"Returns all active settings whose gating capability (if any) is enabled, with per-org override applied (or definition default if no override).",
	})
	.handler(async ({ context }) => {
		return await getEffectiveSettings(context.organization.id);
	});
