// Bulk reorder steps in a playbook's draft version. The caller passes the FULL
// intended ordering for the version (every step in the version must be in the
// reorder set; the lib enforces this with REORDER_STEPS_INCOMPLETE). Cross-version
// or cross-org step ids in the reorder set refuse cleanly with
// REORDER_STEPS_VERSION_MISMATCH / STEP_NOT_FOUND respectively.

import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";
import { reorderPlaybookStepsOp } from "../lib/step";
import { playbookEngineCall } from "./_utils";

export const reorderPlaybookStepsProc = adminOrgProcedure
	.route({
		method: "POST",
		path: "/playbooks/versions/{playbookVersionId}/steps/reorder",
		tags: ["Playbooks"],
		summary: "Bulk-reorder steps in a playbook's draft version",
	})
	.input(
		z.object({
			playbookVersionId: z.string().min(1),
			items: z
				.array(
					z.object({
						stepId: z.string().min(1),
						position: z.number().int().min(0),
					}),
				)
				.min(1)
				.max(500),
		}),
	)
	.handler(async ({ input, context }) => {
		await playbookEngineCall(() =>
			reorderPlaybookStepsOp(
				{ organizationId: context.organization.id, userId: context.user.id },
				input,
			),
		);
		return { ok: true as const };
	});
