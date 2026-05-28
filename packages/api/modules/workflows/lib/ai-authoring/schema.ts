// packages/api/modules/workflows/lib/ai-authoring/schema.ts
//
// Phase 12.1 (PRD_WORKFLOW_SOP_BUILDER.md §6.4, §8.4) -- Zod contract for the structured
// JSON the AI authoring model must emit. Two jobs:
//
//   1. PARSE GUARD. The model is told to return JSON shaped like AuthoredWorkflowSchema;
//      we Zod-parse the response and refuse the build if it doesn't fit. This is what
//      makes "model output -> real workflow" safe: the workflow primitives downstream
//      get inputs they already know how to handle (or we error before any write).
//
//   2. PALETTE GATE. The schema's `enum`s are the SAME closed set the Builder enforces
//      today (only step.type / dueType values that the run engine can actually execute).
//      A future builder pass that ships a new step type extends BOTH the enum here and
//      the Builder palette in lockstep. Per project memory `due_type_ui_constraint`:
//      until launchRun's computeStepDueAt is extended, the only dueType the AI is allowed
//      to emit is `none` or `offset_from_start` -- the validator refuses the rest with a
//      structured error so the model can be re-prompted or the user can be told why.
//
// The shape intentionally lives separate from the AI client + lib so it can be imported
// by tests without pulling in the Anthropic SDK.

import { z } from "zod";

// ---------------------------------------------------------------------------
// Allowed enums (kept as tuples so we get the literal union for Zod + TS types)
// ---------------------------------------------------------------------------

/** Step types the run engine can execute today. `code` + `ai` exist in the DB enum but
 * are reserved for future modules (workflows.ts schema notes "reserved"); the AI must
 * not emit them or runs would hit unhandled-type paths in the engine. */
export const AI_ALLOWED_STEP_TYPES = ["task", "approval", "heading", "one_off"] as const;
export type AiAllowedStepType = (typeof AI_ALLOWED_STEP_TYPES)[number];

/** Due types the launch path resolves. Phase 12.2 widened this from {none,
 * offset_from_start} to the full DB enum once launchRun's resolver + the
 * step-completion recompute hook landed.
 *
 * Resolution semantics callers must mirror:
 *   - offset_from_start: dueAt = launch + dueOffsetDays (resolved at launch)
 *   - offset_from_step:  dueAt = anchor.completedAt + dueOffsetDays (resolved
 *     when the anchor step completes; recompute hook patches dependents)
 *   - from_date_field:   dueAt = sourceField.value + dueOffsetDays (resolved at
 *     launch when source is a kickoff date field; resolved at step completion
 *     when source is a step-scoped date field) */
export const AI_ALLOWED_DUE_TYPES = [
	"none",
	"offset_from_start",
	"offset_from_step",
	"from_date_field",
] as const;
export type AiAllowedDueType = (typeof AI_ALLOWED_DUE_TYPES)[number];

/** Workflow `type` discriminator. Mirrors workflowType enum from the DB schema. */
export const AI_ALLOWED_WORKFLOW_TYPES = ["procedure", "document", "policy", "form"] as const;
export type AiAllowedWorkflowType = (typeof AI_ALLOWED_WORKFLOW_TYPES)[number];

/** Field types the run engine renders today. Matches the full DB fieldType enum --
 * fields are agnostic to launchRun's deadline-resolution gap, so no narrowing here. */
export const AI_ALLOWED_FIELD_TYPES = [
	"text",
	"textarea",
	"number",
	"date",
	"select",
	"multiselect",
	"file",
	"image",
	"signature",
	"member",
] as const;
export type AiAllowedFieldType = (typeof AI_ALLOWED_FIELD_TYPES)[number];

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

/** A field on a step or on the kickoff. `key` is validated by the Builder's field-key
 * lifecycle (validateKeyShape) AFTER Zod accepts the structural shape -- we keep the
 * Zod check loose so a slightly-malformed key still produces a structured error from the
 * domain layer with the same "[a-z][a-z0-9_]*" hint, rather than a Zod path error. */
export const AuthoredFieldSchema = z.object({
	key: z.string().min(1).max(64),
	label: z.string().min(1).max(200),
	fieldType: z.enum(AI_ALLOWED_FIELD_TYPES),
	isRequired: z.boolean().optional(),
	// `select` / `multiselect` use config.options = string[]; left as a free record
	// so future field types (lookup ref shape) can add their own keys without churn here.
	config: z.record(z.string(), z.unknown()).nullable().optional(),
});
export type AuthoredField = z.infer<typeof AuthoredFieldSchema>;

export const AuthoredStepSchema = z.object({
	title: z.string().min(1).max(200),
	description: z.string().max(8000).nullable().optional(),
	type: z.enum(AI_ALLOWED_STEP_TYPES),
	isRequired: z.boolean().optional(),
	isStopTask: z.boolean().optional(),
	// Section grouping is by index into the workflow's sections array. Null = ungrouped
	// (legal -- step.sectionId is nullable). Out-of-range indices are caught in the
	// post-Zod validator (`assertAuthoredWorkflowReferences`) since Zod can't see the
	// parent array's length.
	sectionIndex: z.number().int().nonnegative().nullable().optional(),
	dueType: z.enum(AI_ALLOWED_DUE_TYPES).optional(),
	dueOffsetDays: z.number().int().nullable().optional(),
	// Phase 12.2 -- anchor for offset_from_step. Step.id isn't known at authoring
	// time (steps haven't been inserted), so the AI references the anchor by INDEX
	// into the workflow's `steps` array. The authoring lib resolves this to a real
	// step.id during a second pass after all steps are inserted (same pattern as
	// editPublished's fork-and-remap loop). Out-of-range / self-anchor checks live
	// in assertAuthoredWorkflowReferences.
	dueAnchorStepIndex: z.number().int().nonnegative().nullable().optional(),
	// Phase 12.2 -- source field for from_date_field. Referenced by KEY (the same
	// stable identity merge variables use) so the authoring lib can resolve it
	// against the inserted field rows in the second pass. Source must be a `date`
	// field; the validator enforces that against the AuthoredWorkflow's combined
	// kickoff + step field set.
	dueSourceFieldKey: z.string().min(1).max(64).nullable().optional(),
	fields: z.array(AuthoredFieldSchema).max(50).optional(),
});
export type AuthoredStep = z.infer<typeof AuthoredStepSchema>;

export const AuthoredSectionSchema = z.object({
	title: z.string().min(1).max(200),
});
export type AuthoredSection = z.infer<typeof AuthoredSectionSchema>;

/** The full structured response the model must emit. `kickoffFields` lands as
 * step-less fields on the version (Invariant #5: one variable namespace per version). */
export const AuthoredWorkflowSchema = z.object({
	title: z.string().min(1).max(200),
	description: z.string().max(2000).nullable().optional(),
	type: z.enum(AI_ALLOWED_WORKFLOW_TYPES).optional(),
	sections: z.array(AuthoredSectionSchema).max(20).optional(),
	kickoffFields: z.array(AuthoredFieldSchema).max(50).optional(),
	steps: z.array(AuthoredStepSchema).min(1).max(100),
});
export type AuthoredWorkflow = z.infer<typeof AuthoredWorkflowSchema>;

// ---------------------------------------------------------------------------
// Cross-field reference checks (things Zod can't express in pure schema)
// ---------------------------------------------------------------------------

export interface AuthoredWorkflowValidationError {
	path: string;
	message: string;
}

/** Run post-parse semantic checks. Returns the list of issues; empty = OK. Caller throws
 * a domain error with these as `details.issues` so the procedure layer can surface a
 * structured BAD_REQUEST instead of letting the model's malformed reference cascade into
 * a runtime error during the build. */
export function assertAuthoredWorkflowReferences(
	wf: AuthoredWorkflow,
): AuthoredWorkflowValidationError[] {
	const issues: AuthoredWorkflowValidationError[] = [];

	// 1. Field keys must be unique across the whole version (kickoff + step fields share
	// the same namespace -- Invariant #5). Collisions here would fail downstream at the
	// uq_field_version_key unique constraint with an opaque DB error; catching it up
	// front gives the model + user a precise message.
	const seenKeys = new Map<string, string>(); // key -> first-seen path
	const recordKey = (key: string, path: string) => {
		const prior = seenKeys.get(key);
		if (prior !== undefined) {
			issues.push({
				path,
				message: `Duplicate field key "${key}" (also used at ${prior}). Field keys must be unique within the workflow.`,
			});
			return;
		}
		seenKeys.set(key, path);
	};

	for (const [i, f] of (wf.kickoffFields ?? []).entries()) {
		recordKey(f.key, `kickoffFields[${i}]`);
	}
	for (const [si, s] of wf.steps.entries()) {
		for (const [fi, f] of (s.fields ?? []).entries()) {
			recordKey(f.key, `steps[${si}].fields[${fi}]`);
		}
	}

	// 2. sectionIndex must point at a real section. Indexing a non-existent section
	// would silently null the FK; making it an explicit error here forces the model to
	// either reference a real section or set sectionIndex to null.
	const sectionCount = wf.sections?.length ?? 0;
	for (const [si, s] of wf.steps.entries()) {
		if (s.sectionIndex === null || s.sectionIndex === undefined) continue;
		if (s.sectionIndex >= sectionCount) {
			issues.push({
				path: `steps[${si}].sectionIndex`,
				message: `sectionIndex ${s.sectionIndex} is out of range (workflow has ${sectionCount} section(s)).`,
			});
		}
	}

	// 3. Per-dueType invariants. Each dueType has a required-companions set; mismatches
	// produce a structured error so the model converges on the intended shape rather
	// than silently emitting a partially-resolved deadline.
	//
	// Pre-compute the field-key -> field map for from_date_field source lookups (a
	// kickoff or step field can serve as the source; the validator just needs the
	// keys + their declared fieldType).
	const fieldsByKey = new Map<string, { fieldType: string }>();
	for (const f of wf.kickoffFields ?? []) fieldsByKey.set(f.key, { fieldType: f.fieldType });
	for (const s of wf.steps) {
		for (const f of s.fields ?? []) {
			// Steps can share keys via collision (caught above as duplicate); the
			// first occurrence wins for type-lookup purposes -- subsequent ones are
			// already flagged. Map.set with a missing key is safe; we don't overwrite
			// existing entries because the first occurrence is what the run engine
			// would resolve.
			if (!fieldsByKey.has(f.key)) {
				fieldsByKey.set(f.key, { fieldType: f.fieldType });
			}
		}
	}

	for (const [si, s] of wf.steps.entries()) {
		const dueType = s.dueType ?? "none";
		const hasOffset = s.dueOffsetDays !== undefined && s.dueOffsetDays !== null;
		const hasAnchor =
			s.dueAnchorStepIndex !== undefined && s.dueAnchorStepIndex !== null;
		const hasSourceKey =
			s.dueSourceFieldKey !== undefined &&
			s.dueSourceFieldKey !== null &&
			s.dueSourceFieldKey.length > 0;

		switch (dueType) {
			case "none": {
				if (hasOffset) {
					issues.push({
						path: `steps[${si}].dueOffsetDays`,
						message: "dueOffsetDays must be omitted when dueType is 'none' (or absent).",
					});
				}
				if (hasAnchor) {
					issues.push({
						path: `steps[${si}].dueAnchorStepIndex`,
						message: "dueAnchorStepIndex must be omitted when dueType is 'none'.",
					});
				}
				if (hasSourceKey) {
					issues.push({
						path: `steps[${si}].dueSourceFieldKey`,
						message: "dueSourceFieldKey must be omitted when dueType is 'none'.",
					});
				}
				break;
			}
			case "offset_from_start": {
				if (!hasOffset) {
					issues.push({
						path: `steps[${si}].dueOffsetDays`,
						message: "dueType 'offset_from_start' requires dueOffsetDays.",
					});
				}
				if (hasAnchor) {
					issues.push({
						path: `steps[${si}].dueAnchorStepIndex`,
						message:
							"dueAnchorStepIndex must be omitted when dueType is 'offset_from_start'.",
					});
				}
				if (hasSourceKey) {
					issues.push({
						path: `steps[${si}].dueSourceFieldKey`,
						message:
							"dueSourceFieldKey must be omitted when dueType is 'offset_from_start'.",
					});
				}
				break;
			}
			case "offset_from_step": {
				if (!hasOffset) {
					issues.push({
						path: `steps[${si}].dueOffsetDays`,
						message: "dueType 'offset_from_step' requires dueOffsetDays.",
					});
				}
				if (!hasAnchor) {
					issues.push({
						path: `steps[${si}].dueAnchorStepIndex`,
						message:
							"dueType 'offset_from_step' requires dueAnchorStepIndex (index of the anchor step).",
					});
				} else {
					const idx = s.dueAnchorStepIndex as number;
					if (idx >= wf.steps.length) {
						issues.push({
							path: `steps[${si}].dueAnchorStepIndex`,
							message: `dueAnchorStepIndex ${idx} is out of range (workflow has ${wf.steps.length} step(s)).`,
						});
					} else if (idx === si) {
						issues.push({
							path: `steps[${si}].dueAnchorStepIndex`,
							message:
								"A step cannot anchor on itself -- pick another step or change the dueType.",
						});
					}
				}
				if (hasSourceKey) {
					issues.push({
						path: `steps[${si}].dueSourceFieldKey`,
						message:
							"dueSourceFieldKey must be omitted when dueType is 'offset_from_step'.",
					});
				}
				break;
			}
			case "from_date_field": {
				if (!hasOffset) {
					issues.push({
						path: `steps[${si}].dueOffsetDays`,
						message: "dueType 'from_date_field' requires dueOffsetDays.",
					});
				}
				if (!hasSourceKey) {
					issues.push({
						path: `steps[${si}].dueSourceFieldKey`,
						message:
							"dueType 'from_date_field' requires dueSourceFieldKey (the key of a date field).",
					});
				} else {
					const srcKey = s.dueSourceFieldKey as string;
					const src = fieldsByKey.get(srcKey);
					if (!src) {
						issues.push({
							path: `steps[${si}].dueSourceFieldKey`,
							message: `dueSourceFieldKey "${srcKey}" doesn't match any field in this workflow.`,
						});
					} else if (src.fieldType !== "date") {
						issues.push({
							path: `steps[${si}].dueSourceFieldKey`,
							message: `dueSourceFieldKey "${srcKey}" must reference a 'date' field, not '${src.fieldType}'.`,
						});
					}
				}
				if (hasAnchor) {
					issues.push({
						path: `steps[${si}].dueAnchorStepIndex`,
						message:
							"dueAnchorStepIndex must be omitted when dueType is 'from_date_field'.",
					});
				}
				break;
			}
		}
	}

	return issues;
}
