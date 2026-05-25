import { clearOrganizationSettingOverride } from "@virn/database";
import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";

export const clearSetting = adminOrgProcedure
	.route({
		method: "POST",
		path: "/config/settings/clear",
		tags: ["Config"],
		summary: "Clear a per-org setting override",
		description:
			"Removes the per-org override for a setting; the org will inherit the definition default. No-op if no override exists.",
	})
	.input(
		z.object({
			settingKey: z.string().min(1),
		}),
	)
	.handler(async ({ input, context }) => {
		await clearOrganizationSettingOverride(context.organization.id, input.settingKey);
		return { ok: true as const };
	});
