// packages/api/modules/agents/procedures/author-playbook.ts
//
// Phase 18c (PRD_PLAYBOOKS.md §6.2) -- adminOrgProcedure that turns a free-text prompt
// into a draft Playbook. Admin-only for the same reasons as authorWorkflow: it writes a
// playbook + version + steps under the caller's org (same gate as create), and consumes
// paid model tokens. Lives under `agents.authorPlaybook` per the PRD's labeling.
//
// templateHintId (PRD signature) is DEFERRED for v1 -- the authorPlaybook lib doesn't yet
// build a template reference (the prompt composer supports it; wiring the projection is a
// follow-up). entitySetHints + sourceText are supported now.

import { ORPCError } from "@orpc/server";
import { listEntitySetsForOrg } from "@virn/database";
import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";
import { authorPlaybook } from "../../playbooks/lib/ai-authoring/authoring";
import { playbookEngineCall } from "../../playbooks/procedures/_utils";

export const authorPlaybookProc = adminOrgProcedure
	.route({
		method: "POST",
		path: "/agents/authoring/playbook",
		tags: ["Agents", "Playbooks"],
		summary: "Author a playbook from a free-text prompt (AI)",
		description:
			"Calls Claude to convert the user's request into a structured Playbook (a time/event-staged step sequence), then builds a draft. Stores the prompt + entity-schema snapshot + model response on an ai_authoring_prompt row for reproducibility. Admin/owner only.",
	})
	.input(
		z.object({
			prompt: z.string().min(8).max(8000),
			sourceText: z.string().max(50000).nullish(),
			entitySetHints: z.array(z.string().min(1)).max(25).nullish(),
		}),
	)
	.handler(async ({ context, input }) => {
		// Validate entity-set hints belong to the active org BEFORE spending model tokens.
		const hints = input.entitySetHints ?? null;
		if (hints && hints.length > 0) {
			const validSets = await listEntitySetsForOrg({
				organizationId: context.organization.id,
				entityType: "listing",
			});
			const validIds = new Set(validSets.map((s) => s.id));
			const unknown = hints.filter((id) => !validIds.has(id));
			if (unknown.length > 0) {
				throw new ORPCError("BAD_REQUEST", {
					message: `Unknown entity set id${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}.`,
					data: { code: "AI_AUTHORING_INVALID_ENTITY_SET_HINTS", unknownIds: unknown },
				});
			}
		}

		return await playbookEngineCall(() =>
			authorPlaybook(
				{ organizationId: context.organization.id, userId: context.user.id },
				{
					prompt: input.prompt,
					sourceText: input.sourceText ?? null,
					entitySetHints: hints,
				},
			),
		);
	});
