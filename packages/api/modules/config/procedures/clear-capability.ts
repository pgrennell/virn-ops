import { clearOrganizationCapabilityOverride } from "@virn/database";
import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";

export const clearCapability = adminOrgProcedure
	.route({
		method: "POST",
		path: "/config/capabilities/clear",
		tags: ["Config"],
		summary: "Clear a per-org capability override",
		description:
			"Removes the per-org override for a capability; the org will inherit the capability's L1 default. No-op if no override exists.",
	})
	.input(
		z.object({
			capabilityKey: z.string().min(1),
		}),
	)
	.handler(async ({ input, context }) => {
		await clearOrganizationCapabilityOverride(context.organization.id, input.capabilityKey);
		return { ok: true as const };
	});
