import { getEffectiveCapabilities } from "@virn/database";

import { protectedOrgProcedure } from "../../../orpc/procedures";

export const listCapabilities = protectedOrgProcedure
	.route({
		method: "GET",
		path: "/config/capabilities",
		tags: ["Config"],
		summary: "List effective capabilities for the active organization",
		description:
			"Returns all active capabilities with per-org override applied (or capability default if no override).",
	})
	.handler(async ({ context }) => {
		return await getEffectiveCapabilities(context.organization.id);
	});
