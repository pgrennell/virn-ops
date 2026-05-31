// packages/api/modules/playbooks/lib/ai-authoring/authoring.ts
//
// Phase 18c (PRD_PLAYBOOKS.md §6.2) -- the authorPlaybook lib. Take a free-text request,
// call Claude with the cacheable contract + entity schema, validate the structured
// response, then build a draft Playbook with its steps. Mirrors workflows/lib/
// ai-authoring/authoring.ts.
//
// Flow:
//   1. Snapshot entity schemas (frozen for this request -- reproducibility).
//   2. Compose system + user messages (prompt.ts).
//   3. Call Claude (injected seam; default uses @virn/ai).
//   4. Parse + Zod-validate + reference-check the JSON (schema.ts).
//   5. Insert the ai_authoring_prompt provenance row (FK target for the playbook).
//   6. Build playbook + draft v1 + steps (provenance='ai_generated') in ONE transaction.
//      Branch children resolve parentStepIndex -> the already-inserted parent's id in a
//      single ordered pass (the validator guarantees parentStepIndex < childIndex).
//   7. Apply entity-set hints + write the ai_authored audit (outside the tx; best-effort).
//
// The Claude call is injected (callClaude) so tests stub it without the network.

import {
	type DbExecutor,
	db,
	insertAuthoringPrompt,
	insertPlaybookStep,
	insertPlaybookWithDraft,
	updatePlaybook,
	writeAuditAndActivity,
} from "@virn/database";
import { VIRN_AI_MODEL, getAnthropicClient } from "@virn/ai";

import { adapters, type EntitySchemaForAI } from "../../../entities/adapters";
import { PlaybookEngineError } from "../errors";
import {
	type AuthoredPlaybook,
	AuthoredPlaybookSchema,
	assertAuthoredPlaybookReferences,
} from "./schema";
import {
	type SystemBlock,
	composeSystemPrompt,
	composeUserMessage,
} from "./prompt";

export type CallClaudeFn = (input: {
	model: string;
	system: SystemBlock[];
	userMessage: string;
}) => Promise<{ text: string }>;

async function defaultCallClaude(input: {
	model: string;
	system: SystemBlock[];
	userMessage: string;
}): Promise<{ text: string }> {
	const client = getAnthropicClient();
	const resp = await client.messages.create({
		model: input.model,
		max_tokens: 8192,
		thinking: { type: "adaptive" },
		system: input.system,
		messages: [{ role: "user", content: input.userMessage }],
	});
	const text = resp.content
		.filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
		.map((b) => b.text)
		.join("");
	return { text };
}

/** Strip an optional ```json ... ``` fence the model sometimes adds despite instructions. */
function unwrapJsonFence(raw: string): string {
	const trimmed = raw.trim();
	const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
	return fence ? fence[1].trim() : trimmed;
}

function parseStructuredResponse(raw: string): AuthoredPlaybook {
	const unwrapped = unwrapJsonFence(raw);
	if (unwrapped.length === 0) {
		throw new PlaybookEngineError(
			"AI_AUTHORING_INVALID_OUTPUT",
			"The model returned an empty response. Try a more specific prompt.",
			{ rawLength: 0 },
		);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(unwrapped);
	} catch (err) {
		throw new PlaybookEngineError(
			"AI_AUTHORING_INVALID_OUTPUT",
			"The model's response was not valid JSON. Try again -- this usually resolves on retry.",
			{ jsonError: (err as Error).message, rawPreview: unwrapped.slice(0, 200) },
		);
	}
	const result = AuthoredPlaybookSchema.safeParse(parsed);
	if (!result.success) {
		throw new PlaybookEngineError(
			"AI_AUTHORING_INVALID_OUTPUT",
			"The model's response didn't match the expected playbook shape.",
			{
				issues: result.error.issues.map((i) => ({
					path: i.path.join("."),
					message: i.message,
				})),
			},
		);
	}
	const refIssues = assertAuthoredPlaybookReferences(result.data);
	if (refIssues.length > 0) {
		throw new PlaybookEngineError(
			"AI_AUTHORING_INVALID_OUTPUT",
			"The model's response had internal inconsistencies.",
			{ issues: refIssues },
		);
	}
	return result.data;
}

function snapshotEntitySchemas(): ReadonlyArray<EntitySchemaForAI> {
	return Object.values(adapters).map((a) => a.schemaForAI());
}

export interface AuthorPlaybookContext {
	organizationId: string;
	userId: string;
	/** Test seam -- stub the Claude call. */
	callClaude?: CallClaudeFn;
	/** Model override; defaults to VIRN_AI_MODEL. */
	model?: string;
}

export interface AuthorPlaybookInput {
	prompt: string;
	sourceText?: string | null;
	/** Entity-set scope hints. The procedure layer validates each id belongs to the
	 * caller's org before passing them through; the lib trusts what it receives. */
	entitySetHints?: string[] | null;
}

export interface AuthorPlaybookResult {
	playbookId: string;
	draftVersionId: string;
	authoringPromptId: string;
	name: string;
	stepCount: number;
}

export async function authorPlaybook(
	ctx: AuthorPlaybookContext,
	input: AuthorPlaybookInput,
): Promise<AuthorPlaybookResult> {
	const model = ctx.model ?? VIRN_AI_MODEL;
	const callClaude = ctx.callClaude ?? defaultCallClaude;

	const entitySchemas = snapshotEntitySchemas();
	const system = composeSystemPrompt({ entitySchemas });
	const userMessage = composeUserMessage({
		prompt: input.prompt,
		sourceText: input.sourceText ?? null,
	});

	let rawText: string;
	try {
		const resp = await callClaude({ model, system, userMessage });
		rawText = resp.text;
	} catch (err) {
		const message = (err as Error)?.message ?? String(err);
		throw new PlaybookEngineError(
			"AI_AUTHORING_MODEL_ERROR",
			`The AI authoring call failed: ${message}`,
			{ model, errorName: (err as Error)?.name },
		);
	}

	const authored = parseStructuredResponse(rawText);

	// Provenance row first -- it's the playbook's aiAuthoringPromptId FK target, and it
	// preserves "what did the model emit?" even if the build below fails.
	const provenance = await insertAuthoringPrompt({
		organizationId: ctx.organizationId,
		userId: ctx.userId,
		prompt: input.prompt,
		sourceText: input.sourceText ?? null,
		responseJson: authored as unknown as Record<string, unknown>,
		entitySchemaSnapshot: { snapshots: entitySchemas } as unknown as Record<
			string,
			unknown
		>,
		model,
	});

	// Build playbook + draft + steps atomically. Branch children resolve parentStepIndex
	// to the already-inserted parent's id in a single ordered pass.
	const build = await db.transaction(async (tx: DbExecutor) => {
		let playbookId: string;
		let versionId: string;
		try {
			const r = await insertPlaybookWithDraft(
				{
					organizationId: ctx.organizationId,
					name: authored.name,
					description: authored.description ?? null,
					createdByUserId: ctx.userId,
					aiAuthoringPromptId: provenance.id,
				},
				tx,
			);
			playbookId = r.playbookId;
			versionId = r.versionId;
		} catch (err) {
			if (
				err instanceof Error &&
				/uq_playbook_org_name|duplicate key|unique constraint/i.test(err.message)
			) {
				throw new PlaybookEngineError(
					"PLAYBOOK_NAME_CONFLICT",
					`A playbook named "${authored.name}" already exists in this organization.`,
					{ name: authored.name },
				);
			}
			throw err;
		}

		const stepIdByIndex: string[] = [];
		for (const [i, step] of authored.steps.entries()) {
			const parentStepId =
				step.parentStepIndex !== undefined && step.parentStepIndex !== null
					? stepIdByIndex[step.parentStepIndex] ?? null
					: null;
			const row = await insertPlaybookStep(
				{
					playbookVersionId: versionId,
					position: i,
					type: step.type,
					config: step.config as Record<string, unknown>,
					branchLabel: step.branchLabel ?? null,
					parentStepId,
					provenance: "ai_generated",
				},
				tx,
			);
			stepIdByIndex.push(row.id);
		}

		return { playbookId, versionId };
	});

	// Entity-set hints (the lib trusts the procedure's org-scoped validation).
	if (input.entitySetHints && input.entitySetHints.length > 0) {
		await updatePlaybook({
			organizationId: ctx.organizationId,
			playbookId: build.playbookId,
			entitySetIds: input.entitySetHints,
		});
	}

	await writeAuditAndActivity({
		organizationId: ctx.organizationId,
		actorUserId: ctx.userId,
		action: "playbook.ai_authored",
		verb: "authored via AI",
		entityType: "playbook",
		entityId: build.playbookId,
		changes: { name: authored.name, stepCount: authored.steps.length },
		metadata: {
			aiAuthoringPromptId: provenance.id,
			model,
			draftVersionId: build.versionId,
		},
		activityData: { playbookName: authored.name, source: "ai" },
	});

	return {
		playbookId: build.playbookId,
		draftVersionId: build.versionId,
		authoringPromptId: provenance.id,
		name: authored.name,
		stepCount: authored.steps.length,
	};
}

export const __testables = { parseStructuredResponse, unwrapJsonFence };
