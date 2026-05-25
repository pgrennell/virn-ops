import { setOrganizationCapabilityOverride } from "@virn/database";
import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";

export const setCapabilityEnabled = adminOrgProcedure
	.route({
		method: "POST",
		path: "/config/capabilities/set",
		tags: ["Config"],
		summary: "Set per-org capability override",
		description:
			"Upserts a per-org override for a capability. The capability key must reference an existing capability.",
	})
	.input(
		z.object({
			capabilityKey: z.string().min(1),
			enabled: z.boolean(),
		}),
	)
	.handler(async ({ input, context }) => {
		await setOrganizationCapabilityOverride(
			context.organization.id,
			input.capabilityKey,
			input.enabled,
		);
		return { ok: true as const };
	});
