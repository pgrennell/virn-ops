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

import { ORPCError } from "@orpc/server";
import {
	getLatestPublishedWorkflowVersion,
	getWorkflowForOrg,
	listEntitySetsForOrg,
} from "@virn/database";
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
			// Phase 12 follow-up -- entity-set scope hints. When provided, the
			// resulting workflow's entitySetIds is set to this list so the
			// launcher's listForEntity filter narrows accordingly. Hard-capped at
			// 25 to mirror the entity-set picker UX (an org with that many sets
			// is well past the picker's usability ceiling).
			entitySetHints: z.array(z.string().min(1)).max(25).nullish(),
			// Phase 12 follow-up (slice B) -- "start from this template" hint.
			// References any published workflow in the caller's org. The lib
			// embeds its structure in the user message as a "use this as a
			// starting point; adapt based on the request" block.
			templateHintId: z.string().min(1).nullish(),
			// Phase 12 follow-up (slice C) -- how strongly the model should
			// lean on the template. `reference` (default) is the slice-B
			// behavior; `adapt` tells the model to keep the template intact
			// except for explicit prompt-driven changes. Refuses `adapt`
			// without a templateHintId.
			templateMode: z.enum(["reference", "adapt"]).nullish(),
		}),
	)
	.handler(async ({ context, input }) => {
		// Phase 12 follow-up -- if the caller supplied entitySetHints, validate
		// every id belongs to the active org BEFORE spending model tokens. A
		// forged id wouldn't break anything (entity_set_ids is a stored array,
		// not a FK), but failing fast preserves the "the user sees an actionable
		// error before paying for a generation" contract that the rest of the
		// procedure observes (prompt min/max, model-error mapping, etc).
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
		// Phase 12 follow-up (slice B) -- templateHintId validation. Verify the
		// id is a workflow in the caller's org AND has a published version
		// before paying for the model call. Two failure shapes:
		//   - workflow doesn't exist / is cross-org -> TEMPLATE_HINT_NOT_FOUND
		//   - workflow exists but has no published version -> TEMPLATE_HINT_NO_PUBLISHED_VERSION
		// Both surface as BAD_REQUEST with a structured `data.code` so the
		// dialog can render an actionable inline error rather than a generic
		// failure message.
		const templateHintId = input.templateHintId ?? null;
		const templateMode = input.templateMode ?? null;
		// Slice C -- `adapt` requires a template; "adapt nothing" is nonsense.
		// Reject before paying for the model call.
		if (templateMode === "adapt" && !templateHintId) {
			throw new ORPCError("BAD_REQUEST", {
				message: "templateMode 'adapt' requires a templateHintId.",
				data: { code: "AI_AUTHORING_TEMPLATE_MODE_REQUIRES_HINT" },
			});
		}
		if (templateHintId) {
			const wf = await getWorkflowForOrg(
				context.organization.id,
				templateHintId,
			);
			if (!wf) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Template workflow not found.",
					data: { code: "AI_AUTHORING_TEMPLATE_HINT_NOT_FOUND" },
				});
			}
			const ver = await getLatestPublishedWorkflowVersion(templateHintId);
			if (!ver) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Template workflow has no published version to reference.",
					data: { code: "AI_AUTHORING_TEMPLATE_HINT_NO_PUBLISHED_VERSION" },
				});
			}
		}
		return await workflowEngineCall(() =>
			authorWorkflow(
				{ organizationId: context.organization.id, userId: context.user.id },
				{
					prompt: input.prompt,
					sourceText: input.sourceText ?? null,
					entitySetHints: hints,
					templateHintId,
					templateMode,
				},
			),
		);
	});
