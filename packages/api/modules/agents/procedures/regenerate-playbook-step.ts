// packages/api/modules/agents/procedures/regenerate-playbook-step.ts
//
// Phase 18c (D-040, PRD_PLAYBOOKS.md §6.2) -- adminOrgProcedure that regenerates a
// single step in a draft Playbook via AI. Admin-only for the same reasons as
// authorPlaybook (paid model tokens + writes into playbook content). Org-scoping +
// the D-040 sibling-isolation contract live inside the lib.

import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";
import { regeneratePlaybookStep } from "../../playbooks/lib/ai-authoring/regenerate-step";
import { playbookEngineCall } from "../../playbooks/procedures/_utils";

export const regeneratePlaybookStepProc = adminOrgProcedure
	.route({
		method: "POST",
		path: "/agents/authoring/regenerate-playbook-step",
		tags: ["Agents", "Playbooks"],
		summary: "Regenerate a single step in a draft playbook (AI)",
		description:
			"Calls Claude with the target step's content + sibling context. Per D-040, manually_edited siblings are abstracted as opaque placeholders -- the model cannot read, reference, or modify them -- and a manually_edited TARGET is refused (regenerate operates only on AI-generated steps). The target's type+config are rewritten in place; provenance stays 'ai_generated'. Admin/owner only.",
	})
	.input(
		z.object({
			playbookId: z.string().min(1),
			stepId: z.string().min(1),
			refinementPrompt: z.string().max(2000).nullish(),
		}),
	)
	.handler(async ({ context, input }) => {
		return await playbookEngineCall(() =>
			regeneratePlaybookStep(
				{ organizationId: context.organization.id, userId: context.user.id },
				{
					playbookId: input.playbookId,
					stepId: input.stepId,
					refinementPrompt: input.refinementPrompt ?? null,
				},
			),
		);
	});
