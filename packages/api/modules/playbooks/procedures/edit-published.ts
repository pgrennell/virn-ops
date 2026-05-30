// Phase 18a -- resume-or-fork on a published playbook. Admin-only. Returns
// { draftVersionId, draftVersionNumber, forked } so the Builder UI can show
// the right toast ("editing existing draft" vs "forked from v2").

import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";
import { editPublishedPlaybook } from "../lib/publish";
import { playbookEngineCall } from "./_utils";

export const editPublishedPlaybookProc = adminOrgProcedure
	.route({
		method: "POST",
		path: "/playbooks/{playbookId}/edit",
		tags: ["Playbooks"],
		summary: "Resume the playbook's open draft or fork a new one from latest published",
		description:
			"At most ONE open draft per playbook (enforced server-side). When forking, deep-copies the source steps + trigger config; preserves provenance flags on each step. Idempotent: calling twice in a row returns the same draft (forked=false on the second call).",
	})
	.input(z.object({ playbookId: z.string().min(1) }))
	.handler(async ({ input, context }) => {
		return await playbookEngineCall(() =>
			editPublishedPlaybook(
				{ organizationId: context.organization.id, userId: context.user.id },
				input,
			),
		);
	});
