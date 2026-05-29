// packages/api/modules/agents/procedures/regenerate-step.ts
//
// Phase 12 (D-040, PRD §6.3 G10) -- adminOrgProcedure that regenerates a single
// step in a draft workflow via AI. Admin-only for the same reasons as
// authorWorkflow: the call consumes paid model tokens AND writes into the
// workflow content surface. Org-scoping happens inside the lib via
// getWorkflowForOrg.
//
// Lives under `agents.regenerateStep` per the canonical PRD's labeling.

import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";
import { regenerateStep } from "../../workflows/lib/ai-authoring/regenerate-step";
import { workflowEngineCall } from "../../workflows/procedures/_utils";

export const regenerateStepProc = adminOrgProcedure
	.route({
		method: "POST",
		path: "/agents/authoring/regenerate-step",
		tags: ["Agents", "Workflows"],
		summary: "Regenerate a single step in a draft workflow (AI)",
		description:
			"Calls Claude with the target step's content + sibling context. Per D-040, manually_edited siblings are abstracted as opaque placeholders -- the model cannot read, reference, or modify them. The target step is updated in place + its step-scoped fields are replaced; provenance flips to 'ai_generated'. Admin/owner only.",
	})
	.input(
		z.object({
			stepId: z.string().min(1),
			// Up to 2000 chars matches the operator-steer textarea size on the
			// regenerate UI affordance; longer prompts go through authorWorkflow
			// (whole-workflow scope) instead.
			refinementPrompt: z.string().max(2000).nullish(),
		}),
	)
	.handler(async ({ context, input }) => {
		return await workflowEngineCall(() =>
			regenerateStep(
				{ organizationId: context.organization.id, userId: context.user.id },
				{ stepId: input.stepId, refinementPrompt: input.refinementPrompt ?? null },
			),
		);
	});
