// Phase 18b -- manually launch a playbook. Operator-initiated (any org member),
// ignores the is_active gate per PRD §6.4. Seeds a playbook_run + kicks the
// Inngest orchestrator; returns the new run id.

import { z } from "zod";

import { protectedOrgProcedure } from "../../../orpc/procedures";
import { playbookEngineCall } from "../../playbooks/procedures/_utils";
import { launchPlaybookManual } from "../lib/run-control";

export const launchPlaybookManualProc = protectedOrgProcedure
	.route({
		method: "POST",
		path: "/playbook-runs/launch-manual",
		tags: ["Playbook Runs"],
		summary: "Manually launch a playbook from its latest published version",
		description:
			"Operator-initiated launch. Ignores playbook.is_active (intentional override). Refuses PLAYBOOK_NOT_PUBLISHED when no published version exists. Returns the new playbookRunId; the Inngest orchestrator drives it from there.",
	})
	.input(
		z.object({
			playbookId: z.string().min(1),
			entityContext: z
				.object({
					entityType: z.string().min(1),
					entityId: z.string().min(1),
				})
				.nullish(),
		}),
	)
	.handler(async ({ input, context }) => {
		return await playbookEngineCall(() =>
			launchPlaybookManual(
				{ organizationId: context.organization.id, userId: context.user.id },
				{ playbookId: input.playbookId, entityContext: input.entityContext ?? null },
			),
		);
	});
