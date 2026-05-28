// packages/api/modules/agents/procedures/author-workflow.ts
//
// Phase 12.1 (PRD_WORKFLOW_SOP_BUILDER.md §6.4, §8.4) -- adminOrgProcedure that turns
// a free-text prompt into a draft workflow. Admin-only because:
//   1. The output writes a workflow + version + sections + steps + fields under the
//      caller's org -- same auth gate as createWorkflow (also admin/owner).
//   2. The call consumes paid model tokens and the validator may refuse + retry; that's
//      a billable side effect we don't want available to every org member.
//
// Lives under `agents.authorWorkflow` per the PRD's labeling (the "agent" in question
// is the AI authoring behavior, not an ADR-006 agent principal). The handler hands off
// to the workflows/lib authoring module via workflowEngineCall so the typed
// AI_AUTHORING_* error codes map cleanly to ORPCError shapes.

import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";
import { authorWorkflow } from "../../workflows/lib/ai-authoring/authoring";
import { workflowEngineCall } from "../../workflows/procedures/_utils";

export const authorWorkflowProc = adminOrgProcedure
	.route({
		method: "POST",
		path: "/agents/authoring/workflow",
		tags: ["Agents", "Workflows"],
		summary: "Author a workflow from a free-text prompt (AI)",
		description:
			"Calls Claude to convert the user's request into a structured workflow, then builds a draft. Stores the prompt + entity-schema snapshot + model response on an ai_authoring_prompt row for reproducibility. Admin/owner only.",
	})
	.input(
		z.object({
			// 8k char ceiling matches PRD §8.4; column is unconstrained text so this is
			// purely a procedure-layer guardrail against runaway inputs (also caps the
			// cost-per-call ceiling since the prompt is the dominant volatile input).
			prompt: z.string().min(8).max(8000),
			// Optional doc-ingest source text. Phase 13 (Tango/Scribe import) wires the
			// upstream path that produces this; for now it's accepted opportunistically.
			sourceText: z.string().max(50000).nullish(),
		}),
	)
	.handler(async ({ context, input }) => {
		return await workflowEngineCall(() =>
			authorWorkflow(
				{ organizationId: context.organization.id, userId: context.user.id },
				{ prompt: input.prompt, sourceText: input.sourceText ?? null },
			),
		);
	});
