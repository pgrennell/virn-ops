// packages/database/drizzle/queries/ai-authoring.ts
//
// Phase 12.1 -- DB helpers for the ai_authoring_prompt provenance trail.
// Two operations:
//   1. insertAuthoringPrompt -- write the request/response/snapshot tuple BEFORE we
//      build the workflow so the workflow row's FK has something to point at.
//   2. getAuthoringPromptForOrg -- read back (org-scoped) for audit / regenerate flows.
//
// The table is append-only (no update, no delete except via org cascade). Pruning is
// out of scope for v1; if storage becomes a concern, a future janitor can age out rows
// older than N days, relying on workflow.ai_authoring_prompt_id -> set null on delete
// to preserve the workflow row.

import { and, eq } from "drizzle-orm";

import { db, type DbExecutor } from "../client";
import { aiAuthoringPrompt } from "../schema/postgres";

export interface InsertAuthoringPromptInput {
	organizationId: string;
	userId: string;
	prompt: string;
	sourceText: string | null;
	responseJson: Record<string, unknown>;
	entitySchemaSnapshot: Record<string, unknown>;
	model: string;
}

export async function insertAuthoringPrompt(
	input: InsertAuthoringPromptInput,
	executor: DbExecutor = db,
): Promise<{ id: string; createdAt: Date }> {
	const [row] = await executor
		.insert(aiAuthoringPrompt)
		.values({
			organizationId: input.organizationId,
			userId: input.userId,
			prompt: input.prompt,
			sourceText: input.sourceText,
			responseJson: input.responseJson,
			entitySchemaSnapshot: input.entitySchemaSnapshot,
			model: input.model,
		})
		.returning({ id: aiAuthoringPrompt.id, createdAt: aiAuthoringPrompt.createdAt });
	return row;
}

export interface AuthoringPromptRow {
	id: string;
	organizationId: string;
	userId: string;
	prompt: string;
	sourceText: string | null;
	responseJson: Record<string, unknown>;
	entitySchemaSnapshot: Record<string, unknown>;
	model: string;
	createdAt: Date;
}

/** Org-scoped fetch. Returns null if not found OR if the row belongs to another org
 * (the org check is a guardrail against an id leak; without it a user with a valid id
 * could read another org's provenance row). */
export async function getAuthoringPromptForOrg(
	organizationId: string,
	promptId: string,
	executor: DbExecutor = db,
): Promise<AuthoringPromptRow | null> {
	const [row] = await executor
		.select()
		.from(aiAuthoringPrompt)
		.where(
			and(
				eq(aiAuthoringPrompt.id, promptId),
				eq(aiAuthoringPrompt.organizationId, organizationId),
			),
		)
		.limit(1);
	if (!row) return null;
	return {
		id: row.id,
		organizationId: row.organizationId,
		userId: row.userId,
		prompt: row.prompt,
		sourceText: row.sourceText,
		responseJson: row.responseJson as Record<string, unknown>,
		entitySchemaSnapshot: row.entitySchemaSnapshot as Record<string, unknown>,
		model: row.model,
		createdAt: row.createdAt,
	};
}
