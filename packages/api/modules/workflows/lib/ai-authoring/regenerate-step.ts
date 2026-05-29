// packages/api/modules/workflows/lib/ai-authoring/regenerate-step.ts
//
// Phase 12 (D-040, PRD §6.3 G10) -- per-step regeneration. Operator clicks
// "Regenerate" on a single step in the Builder; we call Claude with the
// step's current content + sibling context (manually_edited siblings
// abstracted as opaque placeholders so the model can't read, reference, or
// rename their fields), apply the regenerated single-step output, and flip
// the row to provenance='ai_generated'.
//
// Why per-step (not whole workflow): authorWorkflow lives at the workflow
// level; regenerateStep lives at the row level. The D-040 contract is the
// reason for the row-level scope: a regenerate call MUST NOT touch any
// sibling with provenance='manually_edited' even as a read (the model can't
// reference their fields). That's the silent-overwrite trust failure mode
// D-040 was written to prevent.
//
// What regenerate writes on success:
//   - target step row (title, description, type, isRequired, isStopTask,
//     dueType, dueOffsetDays, provenance='ai_generated')
//   - target step's step-scoped fields (delete all + insert the regenerated set)
//   - one new ai_authoring_prompt row + one audit row
//
// What regenerate never writes:
//   - any sibling step row
//   - any kickoff field
//   - any sibling step's fields
//   - the workflow row or workflow_version row
//   - step_dependency rows (operator re-establishes after regenerate if needed)
//
// dueType scope in v1.5: regenerate emits only 'none' or 'offset_from_start'.
// Cross-step due rules ('offset_from_step', 'from_date_field') require
// resolving against sibling structure that's out of scope for v1's regenerate.
// The operator can re-add cross-step due rules via the manual builder after
// regenerate -- that flips the step BACK to manually_edited per D-040, which
// is the correct semantic for "operator took ownership of this step's
// timing-coupled-to-siblings logic."

import {
	db,
	deleteFieldsForStep,
	getStepWithVersion,
	getVersionEditBundle,
	getWorkflowForOrg,
	insertAuthoringPrompt,
	insertField,
	type InsertFieldInput,
	updateStep,
	writeAuditAndActivity,
} from "@virn/database";
import { VIRN_AI_MODEL, getAnthropicClient } from "@virn/ai";

import { adapters, type EntitySchemaForAI } from "../../../entities/adapters";
import { autoSlugFromLabel, validateKeyShape } from "../field-key";
import { WorkflowEngineError } from "../errors";
import { type CallClaudeFn } from "./authoring";
import {
	composeRegenerateStepSystemPrompt,
	composeRegenerateStepUserMessage,
	type SystemBlock,
} from "./prompt";
import { type AuthoredStep, AuthoredStepSchema } from "./schema";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RegenerateStepContext {
	organizationId: string;
	userId: string;
	/** Optional override for the Claude call -- tests pass a stub here. */
	callClaude?: CallClaudeFn;
	/** Optional model override -- defaults to VIRN_AI_MODEL. */
	model?: string;
}

export interface RegenerateStepInput {
	stepId: string;
	/** Optional operator steer for the regeneration ("make this terser",
	 * "phrase as a question", "remove the photo field"). Up to 2000 chars. */
	refinementPrompt?: string | null;
}

export interface RegenerateStepResult {
	stepId: string;
	authoringPromptId: string;
	previousTitle: string;
	newTitle: string;
	fieldCountBefore: number;
	fieldCountAfter: number;
}

// ---------------------------------------------------------------------------
// Default Claude caller (mirrors authoring.ts -- single source for the SDK shape)
// ---------------------------------------------------------------------------

async function defaultCallClaude(input: {
	model: string;
	system: SystemBlock[];
	userMessage: string;
}): Promise<{ text: string }> {
	const client = getAnthropicClient();
	const resp = await client.messages.create({
		model: input.model,
		max_tokens: 4096, // single step is smaller than a workflow; tighter cap
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

// ---------------------------------------------------------------------------
// Output parsing (mirrors authoring.ts parseStructuredResponse, but expects a
// single AuthoredStep instead of an AuthoredWorkflow)
// ---------------------------------------------------------------------------

function unwrapJsonFence(raw: string): string {
	const trimmed = raw.trim();
	const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
	if (fence) return fence[1].trim();
	return trimmed;
}

function parseAuthoredStep(raw: string): AuthoredStep {
	const unwrapped = unwrapJsonFence(raw);
	if (unwrapped.length === 0) {
		throw new WorkflowEngineError(
			"AI_AUTHORING_INVALID_OUTPUT",
			"The model returned an empty response. Try again or refine the prompt.",
			{ rawLength: 0 },
		);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(unwrapped);
	} catch (err) {
		throw new WorkflowEngineError(
			"AI_AUTHORING_INVALID_OUTPUT",
			"The model's response was not valid JSON. Try again -- this usually resolves on retry.",
			{ jsonError: (err as Error).message, rawPreview: unwrapped.slice(0, 200) },
		);
	}
	const result = AuthoredStepSchema.safeParse(parsed);
	if (!result.success) {
		throw new WorkflowEngineError(
			"AI_AUTHORING_INVALID_OUTPUT",
			"The model's response didn't match the expected step shape.",
			{
				issues: result.error.issues.map((i) => ({
					path: i.path.join("."),
					message: i.message,
				})),
			},
		);
	}
	const out = result.data;
	// Regenerate-scope hard constraints. The system prompt addendum tells the
	// model these are off-limits; we re-enforce server-side because prompt
	// compliance is best-effort.
	if (out.dueType === "offset_from_step" || out.dueType === "from_date_field") {
		throw new WorkflowEngineError(
			"AI_AUTHORING_INVALID_OUTPUT",
			"Regenerate cannot emit cross-step due rules. Use the manual builder to set offset_from_step or from_date_field after regeneration.",
			{ rejectedDueType: out.dueType },
		);
	}
	if (out.sectionIndex !== null && out.sectionIndex !== undefined) {
		throw new WorkflowEngineError(
			"AI_AUTHORING_INVALID_OUTPUT",
			"Regenerate cannot change a step's section assignment. Use the manual builder to re-section after regeneration.",
		);
	}
	if (
		out.dueAnchorStepIndex !== null &&
		out.dueAnchorStepIndex !== undefined
	) {
		throw new WorkflowEngineError(
			"AI_AUTHORING_INVALID_OUTPUT",
			"Regenerate cannot reference sibling steps (dueAnchorStepIndex not allowed).",
		);
	}
	if (
		out.dueSourceFieldKey !== null &&
		out.dueSourceFieldKey !== undefined
	) {
		throw new WorkflowEngineError(
			"AI_AUTHORING_INVALID_OUTPUT",
			"Regenerate cannot reference cross-field date sources (dueSourceFieldKey not allowed).",
		);
	}
	return out;
}

// ---------------------------------------------------------------------------
// Field-key normalization (mirrors authoring.ts -- shared lifecycle rules per
// D-017). Within the regenerated step's field set, keys must be unique against
// the WORKFLOW's takenKeys (kickoff + all other steps' fields), not just the
// step's own set, because field.key is unique within workflowVersion.
// ---------------------------------------------------------------------------

function normalizeFieldKey(
	rawKey: string,
	label: string,
	taken: Set<string>,
): string {
	let candidate = rawKey;
	try {
		validateKeyShape(rawKey);
	} catch {
		candidate = autoSlugFromLabel(label);
	}
	if (!taken.has(candidate)) {
		taken.add(candidate);
		return candidate;
	}
	for (let i = 2; i < 1000; i++) {
		const next = `${candidate}_${i}`.slice(0, 64);
		if (!taken.has(next)) {
			taken.add(next);
			return next;
		}
	}
	throw new WorkflowEngineError(
		"AI_AUTHORING_INVALID_OUTPUT",
		`Could not resolve a unique field key from "${candidate}" -- too many collisions.`,
		{ candidate },
	);
}

// ---------------------------------------------------------------------------
// snapshotEntitySchemas (mirrors authoring.ts; kept inline to avoid coupling)
// ---------------------------------------------------------------------------

function snapshotEntitySchemas(): ReadonlyArray<EntitySchemaForAI> {
	return Object.values(adapters).map((a) => a.schemaForAI());
}

// ---------------------------------------------------------------------------
// regenerateStep -- the public entry point
// ---------------------------------------------------------------------------

export async function regenerateStep(
	ctx: RegenerateStepContext,
	input: RegenerateStepInput,
): Promise<RegenerateStepResult> {
	const model = ctx.model ?? VIRN_AI_MODEL;
	const callClaude = ctx.callClaude ?? defaultCallClaude;

	// 1. Load the target step + its version. Refuse on missing target OR
	// non-draft version (regenerate is a draft-only operation; published
	// versions are snapshot-immutable per Invariant #4).
	const stepWithVersion = await getStepWithVersion(input.stepId);
	if (!stepWithVersion) {
		throw new WorkflowEngineError(
			"AI_REGENERATE_TARGET_NOT_FOUND",
			"Step not found.",
			{ stepId: input.stepId },
		);
	}
	const { step: targetStep, version } = stepWithVersion;
	if (version.status !== "draft") {
		throw new WorkflowEngineError(
			"AI_REGENERATE_VERSION_NOT_DRAFT",
			`Cannot regenerate steps on a ${version.status} version.`,
			{ versionId: version.id, status: version.status },
		);
	}

	// 2. Org scoping. The target step's workflow_version belongs to a workflow
	// that belongs to an org -- verify the caller's org matches. We refuse with
	// the same "not found" code rather than a distinct AUTHZ code so a curious
	// caller can't enumerate workflow ids across orgs (information leak avoidance).
	const workflow = await getWorkflowForOrg(ctx.organizationId, version.workflowId);
	if (!workflow) {
		throw new WorkflowEngineError(
			"AI_REGENERATE_TARGET_NOT_FOUND",
			"Step not found.",
			{ stepId: input.stepId },
		);
	}

	// 3. Load the full version-edit bundle -- gives us sections, sibling steps,
	// and all fields in one query. We'll partition siblings by provenance.
	const bundle = await getVersionEditBundle(version.id);
	if (!bundle) {
		throw new WorkflowEngineError(
			"AI_REGENERATE_TARGET_NOT_FOUND",
			"Step not found.",
			{ stepId: input.stepId },
		);
	}

	// 4. Partition siblings by provenance + build context arrays for the
	// prompt. The manually_edited list carries ONLY positions (no titles, no
	// field info) so the model has no readable context about those rows --
	// the D-040 sibling-isolation invariant enforced at the prompt level.
	const aiGeneratedSiblings: Array<{
		position: number;
		title: string;
		type: string;
	}> = [];
	const manuallyEditedSiblingPositions: number[] = [];
	for (const s of bundle.steps) {
		if (s.id === targetStep.id) continue;
		if (s.provenance === "ai_generated") {
			aiGeneratedSiblings.push({
				position: s.position,
				title: s.title,
				type: s.type,
			});
		} else {
			manuallyEditedSiblingPositions.push(s.position);
		}
	}

	// 5. Pull the target step's current step-scoped fields + the workflow's
	// kickoff field keys. The model can reference kickoff keys via `{{ key }}`
	// merge variables in the regenerated description (per D-017 the keys are
	// locked; the model cannot rename them). Kickoff fields are field.stepId IS NULL.
	const currentStepFields = bundle.fields
		.filter((f) => f.stepId === targetStep.id)
		.sort((a, b) => a.position - b.position);
	const kickoffFieldKeys = bundle.fields
		.filter((f) => f.stepId === null)
		.map((f) => f.key)
		.sort();

	// 6. Snapshot entity schemas + compose prompts.
	const entitySchemas = snapshotEntitySchemas();
	const system = composeRegenerateStepSystemPrompt({ entitySchemas });
	const userMessage = composeRegenerateStepUserMessage({
		currentStep: {
			title: targetStep.title,
			description: targetStep.description,
			type: targetStep.type,
			isRequired: targetStep.isRequired,
			isStopTask: targetStep.isStopTask,
			dueType: targetStep.dueType,
			dueOffsetDays: targetStep.dueOffsetDays,
			position: targetStep.position,
			fields: currentStepFields.map((f) => ({
				key: f.key,
				label: f.label,
				fieldType: f.fieldType,
				isRequired: f.isRequired,
			})),
		},
		aiGeneratedSiblings,
		manuallyEditedSiblingPositions,
		kickoffFieldKeys,
		refinementPrompt: input.refinementPrompt ?? null,
	});

	// 7. Call Claude.
	let rawText: string;
	try {
		const resp = await callClaude({ model, system, userMessage });
		rawText = resp.text;
	} catch (err) {
		const message = (err as Error)?.message ?? String(err);
		throw new WorkflowEngineError(
			"AI_AUTHORING_MODEL_ERROR",
			`The AI regenerate call failed: ${message}`,
			{ model, errorName: (err as Error)?.name },
		);
	}

	// 8. Parse + validate. The hard regenerate-scope refusals (cross-step refs,
	// section changes) live in parseAuthoredStep.
	const authored = parseAuthoredStep(rawText);

	// 9. Provenance row -- written BEFORE the transaction so a transaction
	// rollback still leaves the prompt+response queryable for debugging "what
	// did the model emit that we couldn't apply?" The row carries the same
	// ai_authoring_prompt shape as authorWorkflow's provenance; the consuming
	// UI uses createdAt to disambiguate "first authored" from "regenerated".
	const provenance = await insertAuthoringPrompt({
		organizationId: ctx.organizationId,
		userId: ctx.userId,
		prompt: input.refinementPrompt ?? "(no refinement)",
		sourceText: null,
		responseJson: authored as unknown as Record<string, unknown>,
		entitySchemaSnapshot: { snapshots: entitySchemas } as unknown as Record<
			string,
			unknown
		>,
		model,
	});

	// 10. Build the field replacement set. Pre-reserve the workflow's existing
	// taken keys MINUS the target step's old keys (those will be deleted before
	// re-insert). The model's keys land through the same field-key lifecycle
	// (validateKeyShape + auto-slug + collision suffixes) as the authoring path.
	const oldStepFieldKeys = new Set(currentStepFields.map((f) => f.key));
	const takenKeys = new Set(
		bundle.fields.filter((f) => !oldStepFieldKeys.has(f.key)).map((f) => f.key),
	);
	const newFieldInserts: InsertFieldInput[] = [];
	for (const [i, f] of (authored.fields ?? []).entries()) {
		const key = normalizeFieldKey(f.key, f.label, takenKeys);
		newFieldInserts.push({
			workflowVersionId: version.id,
			stepId: targetStep.id,
			key,
			label: f.label,
			fieldType: f.fieldType,
			config: (f.config as Record<string, unknown> | null | undefined) ?? null,
			isRequired: f.isRequired ?? false,
			position: i,
		});
	}

	const previousTitle = targetStep.title;
	const fieldCountBefore = currentStepFields.length;

	// 11. Apply in a single transaction. Order: drop old fields first so their
	// keys are freed for re-insert (Postgres UNIQUE on (workflowVersionId, key)
	// would otherwise reject if the model happened to reuse a now-stale key).
	await db.transaction(async (tx) => {
		await deleteFieldsForStep({ stepId: targetStep.id }, tx);
		for (const fieldInput of newFieldInserts) {
			await insertField(fieldInput, tx);
		}
		await updateStep(
			{
				stepId: targetStep.id,
				title: authored.title,
				description: authored.description ?? null,
				type: authored.type,
				isRequired: authored.isRequired ?? targetStep.isRequired,
				isStopTask: authored.isStopTask ?? targetStep.isStopTask,
				dueType: authored.dueType ?? "none",
				dueOffsetDays:
					authored.dueType === "offset_from_start"
						? (authored.dueOffsetDays ?? null)
						: null,
				// Clear cross-step refs -- regenerate scope-restricts these out.
				dueAnchorStepId: null,
				dueSourceFieldId: null,
				// D-040 -- a regenerate flips the row to ai_generated (the
				// operator's explicit consent to overwrite is the click on the
				// Regenerate button, which is itself protected by the chip
				// affordance only appearing on rows that already are or will be
				// ai_generated). Any subsequent manual edit through
				// structure.updateStepOp will flip back.
				provenance: "ai_generated",
			},
			tx,
		);
	});

	// 12. Audit + activity. Outside the transaction (best-effort; the workflow
	// state is already committed by this point).
	await writeAuditAndActivity({
		organizationId: ctx.organizationId,
		actorUserId: ctx.userId,
		action: "step.ai_regenerated",
		verb: "regenerated",
		entityType: "step",
		entityId: targetStep.id,
		changes: {
			previousTitle,
			newTitle: authored.title,
			fieldCountBefore,
			fieldCountAfter: newFieldInserts.length,
			model,
			aiAuthoringPromptId: provenance.id,
			hadRefinementPrompt: !!input.refinementPrompt,
		},
		metadata: {
			workflowVersionId: version.id,
			aiAuthoringPromptId: provenance.id,
		},
	});

	return {
		stepId: targetStep.id,
		authoringPromptId: provenance.id,
		previousTitle,
		newTitle: authored.title,
		fieldCountBefore,
		fieldCountAfter: newFieldInserts.length,
	};
}
