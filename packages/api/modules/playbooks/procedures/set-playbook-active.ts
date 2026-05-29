// The is_active dispatcher gate (PRD_PLAYBOOKS §6.4). Splitting this out from
// updatePlaybook gives the audit trail a distinct "enabled" / "disabled" verb and
// keeps the call sites grep-able. The Phase 18b Inngest dispatcher reads is_active
// on every trigger fire -- disabled playbooks are skipped at dispatch time
// (operator-initiated manual launches via playbookRuns.launchManual ignore the gate).

import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";
import { setPlaybookActiveOp } from "../lib/playbook";
import { playbookEngineCall } from "./_utils";

export const setPlaybookActiveProc = adminOrgProcedure
	.route({
		method: "POST",
		path: "/playbooks/{playbookId}/set-active",
		tags: ["Playbooks"],
		summary: "Enable or disable a playbook (the Phase 18b dispatcher gate)",
	})
	.input(
		z.object({
			playbookId: z.string().min(1),
			isActive: z.boolean(),
		}),
	)
	.handler(async ({ input, context }) => {
		await playbookEngineCall(() =>
			setPlaybookActiveOp(
				{ organizationId: context.organization.id, userId: context.user.id },
				input,
			),
		);
		return { ok: true as const };
	});
