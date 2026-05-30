// Phase 18a -- delete the open draft of a playbook. Admin-only. CASCADE drops
// the draft's steps. Refuses with PLAYBOOK_HAS_NO_DRAFT when no draft exists.

import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";
import { discardPlaybookDraft } from "../lib/publish";
import { playbookEngineCall } from "./_utils";

export const discardPlaybookDraftProc = adminOrgProcedure
	.route({
		method: "POST",
		path: "/playbooks/{playbookId}/discard-draft",
		tags: ["Playbooks"],
		summary: "Discard the open draft of a playbook",
		description:
			"Deletes the draft version + cascade-drops its steps. Refuses when no open draft exists -- the UI should refetch and reflect the post-publish state.",
	})
	.input(z.object({ playbookId: z.string().min(1) }))
	.handler(async ({ input, context }) => {
		return await playbookEngineCall(() =>
			discardPlaybookDraft(
				{ organizationId: context.organization.id, userId: context.user.id },
				input,
			),
		);
	});
