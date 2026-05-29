// Hard-delete a step from a playbook's draft version. Branch children are NOT
// auto-deleted -- the parent_step_id FK is SET NULL on delete, so children become
// orphaned and the builder surfaces them for re-parenting or deletion. (Matches
// the workflow delete-step pattern around step_dependency cleanup.)

import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";
import { deletePlaybookStepOp } from "../lib/step";
import { playbookEngineCall } from "./_utils";

export const deletePlaybookStepProc = adminOrgProcedure
	.route({
		method: "DELETE",
		path: "/playbooks/steps/{stepId}",
		tags: ["Playbooks"],
		summary: "Delete a playbook step from its draft version",
	})
	.input(z.object({ stepId: z.string().min(1) }))
	.handler(async ({ input, context }) => {
		await playbookEngineCall(() =>
			deletePlaybookStepOp(
				{ organizationId: context.organization.id, userId: context.user.id },
				input,
			),
		);
		return { ok: true as const };
	});
