// Phase 12 follow-up (PRD §8.4) -- read-side surface for the
// ai_authoring_prompt provenance row.
//
// The authoring procedure already writes one provenance row per AI call
// (prompt + sourceText + entitySchemaSnapshot + responseJson + model).
// Workflows that came from AI authoring carry `workflow.aiAuthoringPromptId`.
// This procedure closes the loop: given a promptId, return the row so a
// reader can inspect "what produced this workflow."
//
// Gating: protectedOrgProcedure (read access for any org member). The
// authoring procedure itself is admin-only because it spends tokens; reading
// the resulting trail is informational and doesn't carry the same cost or
// privilege. Cross-org access refuses with NOT_FOUND -- same uniform
// response pattern the rest of the org-scoped read surface uses, so a valid
// id can't be used to probe another org's existence.

import { ORPCError } from "@orpc/server";
import { getAuthoringPromptForOrg } from "@virn/database";
import { z } from "zod";

import { protectedOrgProcedure } from "../../../orpc/procedures";

export const getAuthoringPromptProc = protectedOrgProcedure
	.route({
		method: "GET",
		path: "/agents/authoring/prompts/{promptId}",
		tags: ["Agents", "Workflows"],
		summary: "Get the AI-authoring provenance row for a workflow",
		description:
			"Returns the prompt, optional source text, entity schema snapshot, model id, and timestamp the AI was given when the workflow was authored. Used by the AI chip in the Builder + Read view to render a 'View originating prompt' dialog. Returns NOT_FOUND for cross-org or missing ids.",
	})
	.input(
		z.object({
			promptId: z.string().min(1),
		}),
	)
	.handler(async ({ input, context }) => {
		const row = await getAuthoringPromptForOrg(
			context.organization.id,
			input.promptId,
		);
		if (!row) {
			throw new ORPCError("NOT_FOUND", {
				message: "Authoring prompt not found.",
			});
		}
		// Deliberately omit `responseJson` from the response. It's stored for
		// forensic diffing inside the lib but the client doesn't need the raw
		// JSON to render the inspection dialog -- showing the structured workflow
		// in the canvas IS the rendered response. Sending it back would also
		// bloat every dialog open with 2-6KB of duplicate data.
		return {
			id: row.id,
			prompt: row.prompt,
			sourceText: row.sourceText,
			entitySchemaSnapshot: row.entitySchemaSnapshot,
			model: row.model,
			createdAt: row.createdAt,
		};
	});
