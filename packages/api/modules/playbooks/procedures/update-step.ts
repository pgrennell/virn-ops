// Update fields on a playbook step. Always flips provenance to 'manually_edited'
// per D-040 -- the partial-regeneration contract that protects against silent
// overwrite when agents.regeneratePlaybookStep (Phase 18c) ships.

import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";
import { updatePlaybookStepOp } from "../lib/step";
import { playbookEngineCall } from "./_utils";

const STEP_TYPES = [
	"wait_for_duration",
	"wait_for_event",
	"launch_workflow",
	"send_notification",
	"branch_on_data_set",
	"write_to_data_set",
] as const;

export const updatePlaybookStepProc = adminOrgProcedure
	.route({
		method: "PATCH",
		path: "/playbooks/steps/{stepId}",
		tags: ["Playbooks"],
		summary: "Update a playbook step on its draft version",
	})
	.input(
		z.object({
			stepId: z.string().min(1),
			position: z.number().int().min(0).optional(),
			type: z.enum(STEP_TYPES).optional(),
			config: z.record(z.string(), z.unknown()).optional(),
			branchLabel: z.string().max(80).nullable().optional(),
			parentStepId: z.string().min(1).nullable().optional(),
		}),
	)
	.handler(async ({ input, context }) => {
		await playbookEngineCall(() =>
			updatePlaybookStepOp(
				{ organizationId: context.organization.id, userId: context.user.id },
				input,
			),
		);
		return { ok: true as const };
	});
