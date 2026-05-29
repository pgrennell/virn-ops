// packages/api/modules/workflows/procedures/import-from-markdown.ts
//
// Phase 13 slice B (PRD §11) -- deterministic Tango / Scribe / numbered-
// markdown ingress. Admin/owner only (same gate as createWorkflow); writes
// a draft workflow + step rows from the parsed source without ever calling
// the LLM.
//
// Lives under `workflows.importFromMarkdown` (NOT `agents.`) because this
// path is deterministic + free -- the `agents.` namespace is reserved for
// paid model calls (per the agents.authorWorkflow convention). If the
// parser refuses (no recognizable structure), the procedure surfaces a
// structured BAD_REQUEST code so the dialog can offer a fallback to
// `agents.authorWorkflow`.

import { z } from "zod";

import { adminOrgProcedure } from "../../../orpc/procedures";
import { importWorkflowFromMarkdown } from "../lib/import/markdown-import-builder";
import { workflowEngineCall } from "./_utils";

export const importFromMarkdownProc = adminOrgProcedure
	.route({
		method: "POST",
		path: "/workflows/import/markdown",
		tags: ["Workflows"],
		summary: "Import a Tango / Scribe / numbered-markdown export as a draft",
		description:
			"Deterministic parser for Tango / Scribe / numbered-markdown step formats. Builds a draft workflow directly from the parsed structure -- no LLM call, no token spend. If the source isn't recognizably structured, refuses with IMPORT_NO_RECOGNIZABLE_STRUCTURE so the caller can fall back to agents.authorWorkflow (which handles freeform markdown via the AI).",
	})
	.input(
		z.object({
			// 200k char ceiling matches the parser's safety limit. The parser
			// silently caps; we reject upfront so a 1MB paste doesn't even
			// get into the procedure.
			source: z.string().min(1).max(200_000),
			titleOverride: z.string().min(1).max(200).nullish(),
		}),
	)
	.handler(async ({ input, context }) => {
		return await workflowEngineCall(() =>
			importWorkflowFromMarkdown(
				{ organizationId: context.organization.id, userId: context.user.id },
				{ source: input.source, titleOverride: input.titleOverride ?? null },
			),
		);
	});
