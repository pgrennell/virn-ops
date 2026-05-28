// packages/api/modules/workflows/lib/ai-authoring/authoring.ts
//
// Phase 12.1 (PRD §6.4, §8.4) -- the authorWorkflow lib: take a free-text request,
// call Claude with the cacheable system contract + entity schema, validate the
// structured response, then build a real workflow with a draft version, sections,
// steps, and fields. Provenance row is written FIRST so the workflow's FK has a target.
//
// The flow:
//
//   1. Snapshot entity schemas (frozen for this request -- reproducibility per PRD §8.4).
//   2. Compose system + user messages (prompt.ts).
//   3. Call Claude (model+thinking config in @virn/ai/anthropic.ts).
//   4. Parse + validate the JSON (schema.ts: Zod parse + post-parse reference checks).
//   5. Insert ai_authoring_prompt provenance row.
//   6. Insert workflow + draft version + sections + steps + fields -- all in a single
//      transaction so any partial failure leaves nothing behind (vs. half-built workflow).
//   7. Audit + activity write outside the transaction (the audit helper is best-effort).
//
// The Claude client is injected (callClaude param) so tests can stub it without
// touching the network. The shipping default uses getAnthropicClient() from @virn/ai.

import {
	type DbExecutor,
	type InsertFieldInput,
	type InsertStepInput,
	db,
	insertAuthoringPrompt,
	insertField,
	insertSection,
	insertStep,
	insertWorkflowWithDraft,
	updateStep,
	writeAuditAndActivity,
} from "@virn/database";
import { VIRN_AI_MODEL, getAnthropicClient } from "@virn/ai";

import { adapters, type EntitySchemaForAI } from "../../../entities/adapters";
import { autoSlugFromLabel, validateKeyShape } from "../field-key";
import { WorkflowEngineError } from "../errors";
import { assertStepDueRefs } from "../structure";
import {
	type AuthoredWorkflow,
	AuthoredWorkflowSchema,
	assertAuthoredWorkflowReferences,
} from "./schema";
import {
	type SystemBlock,
	composeSystemPrompt,
	composeUserMessage,
} from "./prompt";

// ---------------------------------------------------------------------------
// Injection seam for the Claude call
// ---------------------------------------------------------------------------

/** Shape of the Claude call we depend on -- a single async function returning the
 * model's raw text. The lib doesn't care whether that text came from the SDK, a stub,
 * or a replay fixture. */
export type CallClaudeFn = (input: {
	model: string;
	system: SystemBlock[];
	userMessage: string;
}) => Promise<{ text: string }>;

/** Default Claude caller -- uses the lazy SDK singleton from @virn/ai. Adaptive
 * thinking is opt-in here (Sonnet 4.6 supports it; per the project's choice of
 * claude-sonnet-4-6 in PRD §8.4). max_tokens is generous since structured JSON
 * for a 30-step workflow can hit ~6k tokens; we leave headroom over that. */
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
	// Concatenate text blocks (the response can contain thinking blocks too; we only
	// want the model's user-facing output). Refuse-to-answer / refusal blocks will end
	// up as zero text content -- the JSON parser catches that with a structured error.
	const text = resp.content
		.filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
		.map((b) => b.text)
		.join("");
	return { text };
}

// ---------------------------------------------------------------------------
// Output cleanup -- the model SOMETIMES wraps JSON in a fence even when told not to
// ---------------------------------------------------------------------------

/** Strip optional ```json ... ``` (or generic ```) fences and surrounding whitespace.
 * Returns the raw text unchanged if no fence was found. */
function unwrapJsonFence(raw: string): string {
	const trimmed = raw.trim();
	const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
	if (fence) return fence[1].trim();
	return trimmed;
}

function parseStructuredResponse(raw: string): AuthoredWorkflow {
	const unwrapped = unwrapJsonFence(raw);
	if (unwrapped.length === 0) {
		throw new WorkflowEngineError(
			"AI_AUTHORING_INVALID_OUTPUT",
			"The model returned an empty response. Try a more specific prompt.",
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
	const result = AuthoredWorkflowSchema.safeParse(parsed);
	if (!result.success) {
		throw new WorkflowEngineError(
			"AI_AUTHORING_INVALID_OUTPUT",
			"The model's response didn't match the expected workflow shape.",
			{
				issues: result.error.issues.map((i) => ({
					path: i.path.join("."),
					message: i.message,
				})),
			},
		);
	}
	const refIssues = assertAuthoredWorkflowReferences(result.data);
	if (refIssues.length > 0) {
		throw new WorkflowEngineError(
			"AI_AUTHORING_INVALID_OUTPUT",
			"The model's response had internal inconsistencies.",
			{ issues: refIssues },
		);
	}
	return result.data;
}

// ---------------------------------------------------------------------------
// Field-key normalization
// ---------------------------------------------------------------------------

/** Apply the Builder's key lifecycle to a model-emitted key: if it's already a valid
 * slug, keep it; otherwise auto-slug from the label. Uniqueness within the version is
 * enforced by the uq_field_version_key constraint (we built the model's output to be
 * pre-deduped via assertAuthoredWorkflowReferences) -- a collision past that means a
 * collision after auto-slug-from-label across two different labels, which we resolve
 * with positional suffixes (`_2`, `_3`). */
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
	// Defensive: shouldn't reach here for any sane authored output.
	throw new WorkflowEngineError(
		"AI_AUTHORING_INVALID_OUTPUT",
		`Could not resolve a unique field key from "${candidate}" -- too many collisions.`,
		{ candidate },
	);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface AuthorWorkflowContext {
	organizationId: string;
	userId: string;
	/** Optional override for the Claude call -- tests pass a stub here. */
	callClaude?: CallClaudeFn;
	/** Optional model override -- defaults to VIRN_AI_MODEL ('claude-sonnet-4-6'). */
	model?: string;
}

export interface AuthorWorkflowInput {
	prompt: string;
	sourceText?: string | null;
}

export interface AuthorWorkflowResult {
	workflowId: string;
	draftVersionId: string;
	authoringPromptId: string;
	title: string;
	stepCount: number;
	fieldCount: number;
}

/** Snapshot every adapter's schemaForAI() output -- this is what's stored on the
 * provenance row and what gets sent to the model. Pure; no DB. */
function snapshotEntitySchemas(): ReadonlyArray<EntitySchemaForAI> {
	return Object.values(adapters).map((a) => a.schemaForAI());
}

export async function authorWorkflow(
	ctx: AuthorWorkflowContext,
	input: AuthorWorkflowInput,
): Promise<AuthorWorkflowResult> {
	const model = ctx.model ?? VIRN_AI_MODEL;
	const callClaude = ctx.callClaude ?? defaultCallClaude;

	// 1. Snapshot entity schemas (reproducibility per PRD §8.4).
	const entitySchemas = snapshotEntitySchemas();

	// 2. Compose prompt blocks.
	const system = composeSystemPrompt({ entitySchemas });
	const userMessage = composeUserMessage({
		prompt: input.prompt,
		sourceText: input.sourceText ?? null,
	});

	// 3. Call Claude. Network failures bubble as AI_AUTHORING_MODEL_ERROR so the
	// procedure layer can surface a distinct BAD_REQUEST code (the call failed; the
	// user can retry without anything having been written).
	let rawText: string;
	try {
		const resp = await callClaude({ model, system, userMessage });
		rawText = resp.text;
	} catch (err) {
		const message = (err as Error)?.message ?? String(err);
		throw new WorkflowEngineError(
			"AI_AUTHORING_MODEL_ERROR",
			`The AI authoring call failed: ${message}`,
			{ model, errorName: (err as Error)?.name },
		);
	}

	// 4. Parse + validate. Failures here are user-actionable (retry / refine prompt).
	const authored = parseStructuredResponse(rawText);

	// 5. Write provenance row -- BEFORE the workflow build so the workflow row's FK
	// has a target. Outside the workflow's transaction by design: if the workflow
	// build fails, the provenance row still lets us debug "what did the model emit
	// that we couldn't build?" by looking at responseJson.
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

	// 6. Build the workflow in a single transaction. Pattern mirrors workflows/lib/
	// workflow.ts createWorkflow + the fork path in publish.ts:editPublished.
	const buildResult = await db.transaction(async (tx: DbExecutor) => {
		const { workflowId, versionId } = await insertWorkflowWithDraft(
			{
				organizationId: ctx.organizationId,
				title: authored.title,
				description: authored.description ?? null,
				type: authored.type ?? "procedure",
				createdBy: ctx.userId,
				aiAuthoringPromptId: provenance.id,
			},
			tx,
		);

		// 6a. Sections (preserve order; index in the source authored.sections array is
		// the key for step.sectionIndex remap).
		const sectionIds: string[] = [];
		for (const [i, s] of (authored.sections ?? []).entries()) {
			const row = await insertSection(
				{ workflowVersionId: versionId, title: s.title, position: i },
				tx,
			);
			sectionIds.push(row.id);
		}

		// 6b. Kickoff fields (stepId = null). Reserve all kickoff keys in `takenKeys`
		// FIRST so the model can't accidentally have a kickoff and a step field land
		// on the same auto-slug after normalization (Invariant #5: shared namespace).
		// fieldIdByKey is indexed by the MODEL'S RAW key (f.key) -- not the normalized
		// one -- because dueSourceFieldKey references in the model's output use the
		// same raw key the model emitted on the field. assertAuthoredWorkflowReferences
		// already rejected duplicate raw keys upstream, so f.key is unique here.
		const takenKeys = new Set<string>();
		const fieldIdByKey = new Map<string, string>();
		let fieldCount = 0;
		for (const [i, f] of (authored.kickoffFields ?? []).entries()) {
			const key = normalizeFieldKey(f.key, f.label, takenKeys);
			const payload: InsertFieldInput = {
				workflowVersionId: versionId,
				stepId: null,
				key,
				label: f.label,
				fieldType: f.fieldType,
				config: (f.config as Record<string, unknown> | null | undefined) ?? null,
				isRequired: f.isRequired ?? false,
				position: i,
			};
			const fieldRow = await insertField(payload, tx);
			fieldCount++;
			fieldIdByKey.set(f.key, fieldRow.id);
		}

		// 6c. Steps + step fields. Anchor + source-field refs are deferred to a
		// second pass (6d) because at insertion time we don't yet know the new
		// step.id for a forward reference (anchor a step on a later step). Index/
		// key resolution after the full insert pass keeps the references safe and
		// matches the existing editPublished fork-and-remap pattern.
		const stepIdByIndex: string[] = [];

		for (const [si, s] of authored.steps.entries()) {
			const sectionId =
				s.sectionIndex === null || s.sectionIndex === undefined
					? null
					: sectionIds[s.sectionIndex] ?? null;
			const stepInput: InsertStepInput = {
				workflowVersionId: versionId,
				sectionId,
				type: s.type,
				title: s.title,
				description: s.description ?? null,
				position: si,
				isRequired: s.isRequired ?? true,
				isStopTask: s.isStopTask ?? false,
				// dueType pin: drop the references at insert; second pass patches
				// dueAnchorStepId / dueSourceFieldId after the full id map is built.
				dueType: s.dueType ?? "none",
				dueOffsetDays: s.dueOffsetDays ?? null,
			};
			const stepRow = await insertStep(stepInput, tx);
			stepIdByIndex.push(stepRow.id);

			for (const [fi, f] of (s.fields ?? []).entries()) {
				const key = normalizeFieldKey(f.key, f.label, takenKeys);
				const payload: InsertFieldInput = {
					workflowVersionId: versionId,
					stepId: stepRow.id,
					key,
					label: f.label,
					fieldType: f.fieldType,
					config: (f.config as Record<string, unknown> | null | undefined) ?? null,
					isRequired: f.isRequired ?? false,
					position: fi,
				};
				const fieldRow = await insertField(payload, tx);
				fieldCount++;
				// Index by the model's RAW key (same as kickoff loop) so the 6d
				// second pass resolves dueSourceFieldKey deterministically.
				fieldIdByKey.set(f.key, fieldRow.id);
			}
		}

		// 6d. Second pass -- resolve dueAnchorStepId + dueSourceFieldId references
		// now that every step + field has an id. Only steps with the relevant
		// dueType get touched; the rest skip with no DB write. Each resolved ref
		// goes through assertStepDueRefs before the updateStep write -- the same
		// guard the public structure.updateStepOp uses -- so authoring can't
		// smuggle a cross-version anchor / self-anchor / non-date source past the
		// invariants even if assertAuthoredWorkflowReferences ever loosens.
		for (const [si, s] of authored.steps.entries()) {
			const stepId = stepIdByIndex[si];
			if (!stepId) continue;
			const dueType = s.dueType ?? "none";
			if (dueType === "offset_from_step") {
				const idx = s.dueAnchorStepIndex;
				if (typeof idx === "number" && idx >= 0 && idx < stepIdByIndex.length) {
					const dueAnchorStepId = stepIdByIndex[idx] ?? null;
					await assertStepDueRefs({
						versionId,
						stepId,
						dueAnchorStepId,
					});
					await updateStep({ stepId, dueAnchorStepId }, tx);
				}
			} else if (dueType === "from_date_field") {
				const key = s.dueSourceFieldKey;
				if (typeof key === "string" && key.length > 0) {
					const dueSourceFieldId = fieldIdByKey.get(key) ?? null;
					if (dueSourceFieldId) {
						await assertStepDueRefs({
							versionId,
							stepId,
							dueSourceFieldId,
						});
						await updateStep({ stepId, dueSourceFieldId }, tx);
					}
				}
			}
		}

		return { workflowId, versionId, fieldCount };
	});

	// 7. Audit + activity (best-effort; outside the workflow build transaction so a
	// post-build audit failure can't roll back a fully-valid workflow).
	await writeAuditAndActivity({
		organizationId: ctx.organizationId,
		actorUserId: ctx.userId,
		action: "workflow.ai_authored",
		verb: "authored via AI",
		entityType: "workflow",
		entityId: buildResult.workflowId,
		changes: {
			title: authored.title,
			type: authored.type ?? "procedure",
			stepCount: authored.steps.length,
			fieldCount: buildResult.fieldCount,
		},
		metadata: {
			aiAuthoringPromptId: provenance.id,
			model,
			draftVersionId: buildResult.versionId,
		},
		activityData: {
			workflowTitle: authored.title,
			source: "ai",
		},
	});

	return {
		workflowId: buildResult.workflowId,
		draftVersionId: buildResult.versionId,
		authoringPromptId: provenance.id,
		title: authored.title,
		stepCount: authored.steps.length,
		fieldCount: buildResult.fieldCount,
	};
}

// Expose internals for unit-test reachability without re-exporting them from the
// barrel. Tests import directly from this file.
export const __testables = {
	parseStructuredResponse,
	unwrapJsonFence,
	normalizeFieldKey,
};
