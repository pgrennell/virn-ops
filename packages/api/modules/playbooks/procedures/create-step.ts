// Insert a step into a playbook's draft version. Refuses on published-version
// mutation (D-018) and on invalid parent step references (parent must exist in the
// same version + must be a branch_on_data_set step). Step `config` is jsonb here;
// the procedure layer accepts any object and the lib layer defers type-specific
// validation to a future Phase 18a polish round (Zod discriminated union per
// step_type). For v1 we trust the manual builder UI to send well-formed configs and
// the AI authoring layer (Phase 18c) to enforce its own validator.

import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";
import { createPlaybookStepOp } from "../lib/step";
import { playbookEngineCall } from "./_utils";

const STEP_TYPES = [
	"wait_for_duration",
	"wait_for_event",
	"launch_workflow",
	"send_notification",
	"branch_on_data_set",
	"write_to_data_set",
] as const;

export const createPlaybookStepProc = adminOrgProcedure
	.route({
		method: "POST",
		path: "/playbooks/versions/{playbookVersionId}/steps",
		tags: ["Playbooks"],
		summary: "Append a step to a playbook's draft version",
	})
	.input(
		z.object({
			playbookVersionId: z.string().min(1),
			position: z.number().int().min(0),
			type: z.enum(STEP_TYPES),
			config: z.record(z.string(), z.unknown()),
			branchLabel: z.string().max(80).nullable().optional(),
			parentStepId: z.string().min(1).nullable().optional(),
		}),
	)
	.handler(async ({ input, context }) => {
		return await playbookEngineCall(() =>
			createPlaybookStepOp(
				{ organizationId: context.organization.id, userId: context.user.id },
				{
					playbookVersionId: input.playbookVersionId,
					position: input.position,
					type: input.type,
					config: input.config,
					branchLabel: input.branchLabel,
					parentStepId: input.parentStepId,
				},
			),
		);
	});
