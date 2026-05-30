// Read a single playbook with both its current draft + latest published version
// (and their step lists). Used by Phase 18a's Builder + Read views -- the
// Builder reads draft + draftSteps, the Read view reads latestPublished +
// publishedSteps. One procedure feeds both.

import {
	getCurrentDraftPlaybookVersion,
	getLatestPublishedPlaybookVersion,
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
		summary: "Get a playbook + current draft + latest published (with both step lists)",
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

		const [draft, latestPublished] = await Promise.all([
			getCurrentDraftPlaybookVersion(pb.id),
			getLatestPublishedPlaybookVersion(pb.id),
		]);
		const [draftSteps, publishedSteps] = await Promise.all([
			draft ? listPlaybookStepsForVersion(draft.id) : Promise.resolve([]),
			latestPublished ? listPlaybookStepsForVersion(latestPublished.id) : Promise.resolve([]),
		]);

		return {
			playbook: pb,
			currentDraft: draft,
			draftSteps,
			latestPublished,
			publishedSteps,
		};
	});
