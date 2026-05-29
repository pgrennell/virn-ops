import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";
import { archivePlaybookOp } from "../lib/playbook";
import { playbookEngineCall } from "./_utils";

export const archivePlaybookProc = adminOrgProcedure
	.route({
		method: "DELETE",
		path: "/playbooks/{playbookId}",
		tags: ["Playbooks"],
		summary: "Soft-archive a playbook (sets deletedAt; cancellable in-flight runs continue)",
		description:
			"Sets playbook.deletedAt = now(). Dispatcher (Phase 18b) excludes archived playbooks from trigger evaluation, so no NEW runs fire. In-flight playbook_run rows are NOT cancelled here -- they finish their orchestration naturally per their pinned snapshot (D-018).",
	})
	.input(z.object({ playbookId: z.string().min(1) }))
	.handler(async ({ input, context }) => {
		await playbookEngineCall(() =>
			archivePlaybookOp(
				{ organizationId: context.organization.id, userId: context.user.id },
				input,
			),
		);
		return { ok: true as const };
	});
