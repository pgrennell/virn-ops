// packages/api/modules/playbooks/lib/ai-authoring/regenerate-step.ts
//
// Phase 18c (D-040, PRD_PLAYBOOKS.md §6.2) -- per-step regeneration. Operator clicks
// "Regenerate" on a single playbook step; we call Claude with the step's current
// content + sibling CONTEXT (ai_generated siblings shown as position+type;
// manually_edited siblings as opaque positions only -- never their content), apply the
// regenerated {type, config}, and keep the row provenance='ai_generated'.
//
// D-040 contract enforced here:
//   - Sibling isolation: a regenerate NEVER reads or writes any sibling with
//     provenance='manually_edited' (their content is excluded from the prompt).
//   - Target protection (playbook-specific, stricter than the workflow path): we REFUSE
//     to regenerate a target whose provenance is already 'manually_edited'
//     (STEP_NOT_AI_GENERATED) -- the operator must take an explicit action in the manual
//     builder if they want to hand a manually-owned step back to the AI. This is the most
//     reversible reading of D-040 (never silently overwrite manual work) and matches the
//     UI affordance (the Regenerate button only appears on ai_generated cards). The
//     workflow path allows regenerating any target; we diverge intentionally.
//
// Regenerate writes ONLY: the target step's type+config (provenance stays ai_generated),
// one ai_authoring_prompt row, one audit row. It never touches siblings, the playbook
// row, or the version row. Position / branchLabel / parentStepId are preserved.

import {
	getCurrentDraftPlaybookVersion,
	getPlaybookForOrg,
	insertAuthoringPrompt,
	listPlaybookStepsForVersion,
	updatePlaybookStep,
	writeAuditAndActivity,
} from "@virn/database";
import { VIRN_AI_MODEL, getAnthropicClient } from "@virn/ai";

import { adapters, type EntitySchemaForAI } from "../../../entities/adapters";
import { PlaybookEngineError } from "../errors";
import { type CallClaudeFn } from "./authoring";
import {
	composeRegenerateStepSystemPrompt,
	composeRegenerateStepUserMessage,
	type SystemBlock,
} from "./prompt";
import { AuthoredPlaybookStepSchema } from "./schema";

export interface RegeneratePlaybookStepContext {
	organizationId: string;
	userId: string;
	callClaude?: CallClaudeFn;
	model?: string;
}

export interface RegeneratePlaybookStepInput {
	playbookId: string;
	stepId: string;
	refinementPrompt?: string | null;
}

export interface RegeneratePlaybookStepResult {
	stepId: string;
	authoringPromptId: string;
	previousType: string;
	newType: string;
}

async function defaultCallClaude(input: {
	model: string;
	system: SystemBlock[];
	userMessage: string;
}): Promise<{ text: string }> {
	const client = getAnthropicClient();
	const resp = await client.messages.create({
		model: input.model,
		max_tokens: 2048, // a single step is tiny
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

function unwrapJsonFence(raw: string): string {
	const trimmed = raw.trim();
	const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
	return fence ? fence[1].trim() : trimmed;
}

/** Parse the single-step regenerate output. Expects { type, config }; rejects any
 * attempt to re-parent (parentStepIndex/branchLabel are out of regenerate scope). */
function parseRegeneratedStep(raw: string): { type: string; config: Record<string, unknown> } {
	const unwrapped = unwrapJsonFence(raw);
	if (unwrapped.length === 0) {
		throw new PlaybookEngineError(
			"AI_AUTHORING_INVALID_OUTPUT",
			"The model returned an empty response. Try again or refine the prompt.",
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
	const result = AuthoredPlaybookStepSchema.safeParse(parsed);
	if (!result.success) {
		throw new PlaybookEngineError(
			"AI_AUTHORING_INVALID_OUTPUT",
			"The model's response didn't match the expected step shape.",
			{ issues: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
		);
	}
	const step = result.data;
	if (
		(step.parentStepIndex !== undefined && step.parentStepIndex !== null) ||
		(step.branchLabel !== undefined && step.branchLabel !== null)
	) {
		throw new PlaybookEngineError(
			"AI_AUTHORING_INVALID_OUTPUT",
			"Regenerate cannot re-parent a step (parentStepIndex/branchLabel not allowed). The step keeps its existing branch context.",
		);
	}
	return { type: step.type, config: step.config as Record<string, unknown> };
}

function snapshotEntitySchemas(): ReadonlyArray<EntitySchemaForAI> {
	return Object.values(adapters).map((a) => a.schemaForAI());
}

export async function regeneratePlaybookStep(
	ctx: RegeneratePlaybookStepContext,
	input: RegeneratePlaybookStepInput,
): Promise<RegeneratePlaybookStepResult> {
	const model = ctx.model ?? VIRN_AI_MODEL;
	const callClaude = ctx.callClaude ?? defaultCallClaude;

	// 1. Org-scoped playbook load (cross-org -> NOT_FOUND, no enumeration leak).
	const playbook = await getPlaybookForOrg({
		organizationId: ctx.organizationId,
		playbookId: input.playbookId,
	});
	if (!playbook) {
		throw new PlaybookEngineError("PLAYBOOK_NOT_FOUND", "Playbook not found.", {
			playbookId: input.playbookId,
		});
	}

	// 2. Regenerate is a draft-only operation (published versions are snapshot-immutable).
	const draft = await getCurrentDraftPlaybookVersion(playbook.id);
	if (!draft) {
		throw new PlaybookEngineError(
			"PLAYBOOK_HAS_NO_DRAFT",
			"This playbook has no open draft to regenerate. Click Edit to fork a draft first.",
			{ playbookId: playbook.id },
		);
	}

	// 3. Load draft steps; locate the target.
	const steps = await listPlaybookStepsForVersion(draft.id);
	const target = steps.find((s) => s.id === input.stepId);
	if (!target) {
		throw new PlaybookEngineError("STEP_NOT_FOUND", "Step not found in the current draft.", {
			stepId: input.stepId,
			versionId: draft.id,
		});
	}

	// 4. D-040 target protection: never overwrite a manually-owned step.
	if (target.provenance === "manually_edited") {
		throw new PlaybookEngineError(
			"STEP_NOT_AI_GENERATED",
			"This step was manually edited; regenerate only operates on AI-generated steps. Reset or recreate it through the builder first.",
			{ stepId: input.stepId },
		);
	}

	// 5. Partition siblings by provenance. manually_edited siblings contribute ONLY their
	// position (no type, no config) -- the D-040 sibling-isolation invariant at the prompt.
	const aiGeneratedSiblings: Array<{ position: number; type: string }> = [];
	const manuallyEditedSiblingPositions: number[] = [];
	for (const s of steps) {
		if (s.id === target.id) continue;
		if (s.provenance === "ai_generated") {
			aiGeneratedSiblings.push({ position: s.position, type: s.type });
		} else {
			manuallyEditedSiblingPositions.push(s.position);
		}
	}

	// 6. Compose prompts.
	const entitySchemas = snapshotEntitySchemas();
	const system = composeRegenerateStepSystemPrompt({ entitySchemas });
	const userMessage = composeRegenerateStepUserMessage({
		currentStep: {
			type: target.type,
			config: target.config,
			position: target.position,
			branchLabel: target.branchLabel,
		},
		aiGeneratedSiblings,
		manuallyEditedSiblingPositions,
		refinementPrompt: input.refinementPrompt ?? null,
	});

	// 7. Call Claude.
	let rawText: string;
	try {
		const resp = await callClaude({ model, system, userMessage });
		rawText = resp.text;
	} catch (err) {
		const message = (err as Error)?.message ?? String(err);
		throw new PlaybookEngineError(
			"AI_AUTHORING_MODEL_ERROR",
			`The AI regenerate call failed: ${message}`,
			{ model, errorName: (err as Error)?.name },
		);
	}

	// 8. Parse + validate.
	const regenerated = parseRegeneratedStep(rawText);

	// 9. Provenance row (before the write so a failed apply still leaves it queryable).
	const provenance = await insertAuthoringPrompt({
		organizationId: ctx.organizationId,
		userId: ctx.userId,
		prompt: input.refinementPrompt ?? "(no refinement)",
		sourceText: null,
		responseJson: regenerated as unknown as Record<string, unknown>,
		entitySchemaSnapshot: { snapshots: entitySchemas } as unknown as Record<string, unknown>,
		model,
	});

	// 10. Apply -- ONLY the target's type + config; provenance stays ai_generated.
	// position / branchLabel / parentStepId are untouched (updatePlaybookStep patches
	// only the provided fields).
	const previousType = target.type;
	await updatePlaybookStep({
		stepId: target.id,
		type: regenerated.type as typeof target.type,
		config: regenerated.config,
		provenance: "ai_generated",
	});

	await writeAuditAndActivity({
		organizationId: ctx.organizationId,
		actorUserId: ctx.userId,
		action: "playbook_step.ai_regenerated",
		verb: "regenerated",
		entityType: "playbook",
		entityId: playbook.id,
		changes: {
			stepId: target.id,
			previousType,
			newType: regenerated.type,
			hadRefinementPrompt: !!input.refinementPrompt,
			model,
		},
		metadata: { playbookVersionId: draft.id, aiAuthoringPromptId: provenance.id },
	});

	return {
		stepId: target.id,
		authoringPromptId: provenance.id,
		previousType,
		newType: regenerated.type,
	};
}
