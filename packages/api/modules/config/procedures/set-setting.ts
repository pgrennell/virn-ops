import { setOrganizationSettingOverride } from "@virn/database";
import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";

export const setSetting = adminOrgProcedure
	.route({
		method: "POST",
		path: "/config/settings/set",
		tags: ["Config"],
		summary: "Set per-org setting override",
		description:
			"Upserts a per-org override for a setting. The value is validated server-side against the setting's stored validationSchema; an invalid value rejects with a Zod error.",
	})
	.input(
		z.object({
			settingKey: z.string().min(1),
			value: z.unknown(),
		}),
	)
	.handler(async ({ input, context }) => {
		await setOrganizationSettingOverride(
			context.organization.id,
			input.settingKey,
			input.value,
		);
		return { ok: true as const };
	});
