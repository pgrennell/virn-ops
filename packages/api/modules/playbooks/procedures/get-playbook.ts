// Read a single playbook with its current draft version + draft step list. Used by
// the Phase 18a builder detail page. Versions/steps for published versions are not
// returned -- that's a separate Read-view query that lands when v1.5c three-views
// surface for Playbooks ships (currently the Playbook read view is described in
// PRD_PLAYBOOKS §6.5 but not yet implemented).

import {
	getCurrentDraftPlaybookVersion,
	getPlaybookForOrg,
	listPlaybookStepsForVersion,
} from "@virn/database";
import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { protectedOrgProcedure } from "../../../orpc/procedures";

export const getPlaybookProc = protectedOrgProcedure
	.route({
		method: "GET",
		path: "/playbooks/{playbookId}",
		tags: ["Playbooks"],
		summary: "Get a playbook with its current draft version + draft step list",
	})
	.input(z.object({ playbookId: z.string().min(1) }))
	.handler(async ({ input, context }) => {
		const pb = await getPlaybookForOrg({
			organizationId: context.organization.id,
			playbookId: input.playbookId,
		});
		if (!pb) {
			throw new ORPCError("NOT_FOUND", {
				message: "Playbook not found.",
				data: { code: "PLAYBOOK_NOT_FOUND", playbookId: input.playbookId },
			});
		}

		const draft = await getCurrentDraftPlaybookVersion(pb.id);
		const draftSteps = draft ? await listPlaybookStepsForVersion(draft.id) : [];

		return {
			playbook: pb,
			currentDraft: draft,
			draftSteps,
		};
	});
