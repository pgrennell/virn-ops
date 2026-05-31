// Phase 18b -- cancel a live playbook_run. Flips a pending/active/waiting run to
// 'cancelled'; the orchestrator checks status between steps and stops. Refuses
// PLAYBOOK_RUN_NOT_CANCELLABLE on an already-terminal run.

import { z } from "zod";

import { protectedOrgProcedure } from "../../../orpc/procedures";
import { playbookEngineCall } from "../../playbooks/procedures/_utils";
import { cancelPlaybookRunOp } from "../lib/run-control";

export const cancelPlaybookRunProc = protectedOrgProcedure
	.route({
		method: "POST",
		path: "/playbook-runs/{runId}/cancel",
		tags: ["Playbook Runs"],
		summary: "Cancel a live playbook run",
	})
	.input(z.object({ runId: z.string().min(1) }))
	.handler(async ({ input, context }) => {
		return await playbookEngineCall(() =>
			cancelPlaybookRunOp(
				{ organizationId: context.organization.id, userId: context.user.id },
				{ runId: input.runId },
			),
		);
	});
