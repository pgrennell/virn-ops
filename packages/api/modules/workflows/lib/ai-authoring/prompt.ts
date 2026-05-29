// packages/api/modules/workflows/lib/ai-authoring/prompt.ts
//
// Phase 12.1 (PRD §8.4) -- compose the system prompt the AI authoring call sends to
// Claude. Three structural goals:
//
//   1. CACHEABILITY. The Anthropic Messages API caches the prefix of `system` blocks
//      marked with cache_control breakpoints; the AI authoring path bills heavily on
//      the entity-schema + builder-contract blocks (they're the long ones), so we set
//      a breakpoint after the contract block so it stays in cache across calls within
//      the 5-minute TTL. Per-org entity schema gets its own breakpoint so a request for
//      org-A doesn't invalidate the cache for org-B.
//
//   2. CLOSED VOCABULARY. The contract block enumerates the EXACT enum values the
//      validator (schema.ts) will accept. Telling the model "you may emit step.type =
//      task | approval | heading | one_off" up front converges its outputs to the
//      validator's gate, vastly reducing parse-fail loops.
//
//   3. SHAPE CONTRACT. The expected JSON shape is embedded in the system block as a
//      mini grammar -- not a JSON example with realistic values (which the model
//      sometimes copies verbatim), but a literal field-by-field description with
//      "<your value here>" placeholders.
//
// What is NOT in this file:
//   - The actual Anthropic SDK call. That lives in `authoring.ts` and uses the helpers
//     exported here. Keeping prompt assembly pure makes it trivially testable.
//   - Output validation. That's `schema.ts`.

import type { EntitySchemaForAI } from "../../../entities/adapters";
import {
	AI_ALLOWED_DUE_TYPES,
	AI_ALLOWED_FIELD_TYPES,
	AI_ALLOWED_STEP_TYPES,
	AI_ALLOWED_WORKFLOW_TYPES,
} from "./schema";

/**
 * Anthropic system-block shape. Mirrors the SDK's `TextBlockParam` minus types we don't
 * need; staying local avoids importing the SDK from a layer that's heavily unit-tested
 * (`schema.ts` and `prompt.ts` should be importable without the network-bearing SDK).
 */
export interface SystemBlock {
	type: "text";
	text: string;
	cache_control?: { type: "ephemeral" };
}

/** Lower bound on a cache_control block (per Anthropic docs: min ~2048 tokens for
 * Sonnet). We don't measure tokens here; this constant is for the safety assertion in
 * `composeSystemPrompt` that flags blocks too small to plausibly meet the threshold.
 * Sonnet 4.6 specifically lists 2048-token minimums; we use ~1500 chars (~ ≥350 tokens
 * for English prose) as a "this block is genuinely tiny" lint check rather than a hard
 * billing gate -- the API itself silently no-ops too-small breakpoints. */
const MIN_BLOCK_CHARS_FOR_CACHE_HINT = 1500;

/** The "builder contract" block. Stable across all requests + all orgs -- so we set a
 * cache breakpoint after it. Lists the validator's exact closed sets and the shape
 * grammar the model must emit. */
function builderContractBlock(): string {
	return [
		"# Virn Workflow Authoring Contract",
		"",
		"You are Claude, authoring structured workflow definitions for the Virn property-ops",
		"platform. You convert a user's free-text request into a single JSON object that the",
		"Virn workflow engine can build into a draft workflow. The user is a property-ops",
		"admin; treat their prompt as the source of truth on intent and ground your output",
		"in the entity schema you'll see below.",
		"",
		"## Output rules",
		"",
		"1. Return EXACTLY ONE JSON object matching the shape in the OUTPUT SHAPE section",
		"   below. No prose before or after. No markdown code fence. No comments.",
		"2. Use ONLY the enum values listed below. Outputs containing other values will be",
		"   rejected and the user will see an error.",
		"3. Field keys must match the regex /^[a-z][a-z0-9_]*$/ (lowercase, starts with a",
		"   letter, underscores allowed, no spaces or hyphens). Keys are case-sensitive and",
		"   must be UNIQUE across the entire workflow (kickoff fields and step fields share",
		"   one namespace).",
		"4. Step deadlines (dueType) -- pick the shape that matches the timing source:",
		"   - 'offset_from_start' WITH dueOffsetDays: deadline relative to LAUNCH",
		"     (e.g. 'due 3 days after launch' -> dueOffsetDays: 3). Negative values mean",
		"     'before launch' and almost never make sense; use positive integers.",
		"   - 'offset_from_step' WITH dueAnchorStepIndex AND dueOffsetDays: deadline",
		"     relative to the COMPLETION of another step in this workflow. Reference the",
		"     anchor by its index in the steps array (0-based). Use this when a step's",
		"     deadline depends on when an earlier step actually finishes",
		"     (e.g. 'inspector signs off 2 days after photos uploaded'). Negative offset",
		"     = 'before the anchor completes' (the deadline only resolves once the",
		"     anchor completes, so 'before' here means a planning warning rather than a",
		"     hard pre-completion gate). A step cannot anchor on itself.",
		"   - 'from_date_field' WITH dueSourceFieldKey AND dueOffsetDays: deadline",
		"     anchored on a DATE field's value. The source field must exist in this",
		"     workflow (kickoff or step field) and must have fieldType='date'. Common",
		"     pattern: a kickoff date 'guest_arrival' with a step due 'guest_arrival - 1'",
		"     (dueOffsetDays: -1). Resolves at launch if the source is a kickoff field;",
		"     resolves at step completion if the source is collected later.",
		"   - 'none' (or omit): no deadline.",
		"5. Step types are: task (the default; a checkable to-do for the assignee),",
		"   approval (gate that pauses for a yes/no sign-off), heading (a label-only",
		"   divider with no completion semantics), one_off (a task triggered ad-hoc rather",
		"   than scheduled). Use 'task' unless the structure clearly calls for one of the",
		"   others.",
		"6. Keep step counts realistic. A focused procedure has 3-10 steps; a multi-section",
		"   policy may have 15-30. Avoid emitting 1-step workflows (low signal) or",
		"   100-step monsters (overwhelming).",
		"",
		"## Allowed enum values",
		"",
		`- workflow.type: ${AI_ALLOWED_WORKFLOW_TYPES.join(" | ")}`,
		`- step.type: ${AI_ALLOWED_STEP_TYPES.join(" | ")}`,
		`- step.dueType: ${AI_ALLOWED_DUE_TYPES.join(" | ")}`,
		`- field.fieldType: ${AI_ALLOWED_FIELD_TYPES.join(" | ")}`,
		"",
		"## Output shape",
		"",
		"```",
		"{",
		'  "title": "<human-readable workflow title, max 200 chars>",',
		'  "description": "<optional one-paragraph description, max 2000 chars> | null",',
		'  "type": "<one of workflow.type; default \\"procedure\\" if omitted>",',
		'  "sections": [',
		'    { "title": "<section title>" }',
		"  ],",
		'  "kickoffFields": [',
		"    {",
		'      "key": "<snake_case key, unique across workflow>",',
		'      "label": "<human-friendly label>",',
		'      "fieldType": "<one of field.fieldType>",',
		'      "isRequired": false,',
		'      "config": { "options": ["...for select/multiselect..."] }',
		"    }",
		"  ],",
		'  "steps": [',
		"    {",
		'      "title": "<step title>",',
		'      "description": "<optional details, may include checklists in markdown> | null",',
		'      "type": "<one of step.type>",',
		'      "isRequired": true,',
		'      "isStopTask": false,',
		'      "sectionIndex": 0,    // index into sections[], or null if ungrouped',
		'      "dueType": "<one of step.dueType>",',
		'      "dueOffsetDays": 7,                 // required for offset_from_start | offset_from_step | from_date_field; negative allowed for the latter two',
		'      "dueAnchorStepIndex": 0,            // ONLY for dueType="offset_from_step"; 0-based index into steps[]',
		'      "dueSourceFieldKey": "guest_arrival", // ONLY for dueType="from_date_field"; must reference a date field by key',
		'      "fields": [',
		"        {",
		'          "key": "<unique snake_case key>",',
		'          "label": "<human label>",',
		'          "fieldType": "<one of field.fieldType>",',
		'          "isRequired": true',
		"        }",
		"      ]",
		"    }",
		"  ]",
		"}",
		"```",
		"",
		"## Authoring guidance",
		"",
		"- Group related steps under sections when the workflow has 8+ steps; for short",
		"  procedures, leave sections empty.",
		"- Use kickoffFields for inputs gathered ONCE at launch (the date of move-in,",
		"  which vendor was selected). Use step.fields for inputs captured DURING the step",
		"  (a signature, a photo, an inspector's notes).",
		"- isStopTask=true means the workflow halts until this step is resolved -- use",
		"  sparingly, for genuine gates like manager approval.",
		"- Prefer concrete, action-verb titles ('Inspect kitchen', not 'Kitchen').",
		"- The user's prompt may name property types, locations, or vendor categories.",
		"  Cross-reference these against the entity schema below; if a name doesn't match",
		"  any registered entity, treat it as descriptive context rather than a literal",
		"  field reference.",
	].join("\n");
}

/** Render the EntityAdapter.schemaForAI() snapshots as a single text block. Tenant-
 * varying inputs (per-org listings, vendor categories, etc.) are NOT included here --
 * the block holds only the SCHEMA (field names + types), which is stable across all
 * orgs in v1.5 (one adapter, one shape). When per-tenant data starts to matter for
 * authoring, push it into a separate user-message block so it doesn't invalidate this
 * cache. */
function entitySchemaBlock(snapshots: ReadonlyArray<EntitySchemaForAI>): string {
	const lines: string[] = [
		"# Entity Schema",
		"",
		"The Virn workspace tracks these entity types. When a workflow operates on or",
		"references an entity (a listing, a vendor, etc.), use these field names; do NOT",
		"invent fields the schema doesn't declare.",
		"",
	];
	for (const s of snapshots) {
		lines.push(`## ${s.label} (type="${s.type}")`);
		lines.push("");
		lines.push(s.description);
		lines.push("");
		lines.push("Fields:");
		for (const f of s.fields) {
			const opt = f.nullable ? " (optional)" : "";
			const note = f.description ? ` -- ${f.description}` : "";
			lines.push(`- \`${f.key}\` (${f.dataType})${opt}: ${f.label}${note}`);
		}
		if (s.commonCohortDimensions && s.commonCohortDimensions.length > 0) {
			lines.push("");
			lines.push("Common cohort dimensions (suggested entity-set splits):");
			for (const d of s.commonCohortDimensions) lines.push(`- ${d}`);
		}
		lines.push("");
	}
	return lines.join("\n");
}

export interface ComposeSystemPromptInput {
	entitySchemas: ReadonlyArray<EntitySchemaForAI>;
}

/**
 * Build the system prompt for `messages.create({ system: ... })`. Returns an array of
 * blocks with cache_control on the boundaries we want preserved across calls:
 *
 *   [contract, cache_control=ephemeral]  <- shared across all orgs + all requests
 *   [entitySchema, cache_control=ephemeral] <- shared across all requests for an org
 *
 * Per-request volatile content (the user's free-text prompt, the optional source text)
 * is NOT in the system block -- it goes in the `messages` array so it doesn't
 * invalidate either cache.
 */
export function composeSystemPrompt(input: ComposeSystemPromptInput): SystemBlock[] {
	const contract = builderContractBlock();
	const entities = entitySchemaBlock(input.entitySchemas);

	// Defensive lint: warn (via console.warn -- not throw) if a block we're marking as
	// cacheable is suspiciously short. The Anthropic API silently ignores breakpoints on
	// blocks below the minimum token threshold; this surfaces the misconfiguration in
	// dev rather than us discovering "we're not getting cache hits" in metrics later.
	for (const [name, text] of [
		["contract", contract],
		["entitySchema", entities],
	] as const) {
		if (text.length < MIN_BLOCK_CHARS_FOR_CACHE_HINT) {
			// eslint-disable-next-line no-console
			console.warn(
				`[ai-authoring] system block "${name}" is ${text.length} chars; below the` +
					` heuristic threshold of ${MIN_BLOCK_CHARS_FOR_CACHE_HINT}. The Anthropic` +
					` cache breakpoint may be ignored.`,
			);
		}
	}

	return [
		{ type: "text", text: contract, cache_control: { type: "ephemeral" } },
		{ type: "text", text: entities, cache_control: { type: "ephemeral" } },
	];
}

/** Compose the user message text that pairs with the cached system blocks. Keeps the
 * volatile inputs (prompt + optional sourceText + optional templateReferenceJson)
 * together so the cache prefix (system blocks) is unchanged across requests for
 * the same org.
 *
 * Phase 12 follow-up slice B: when `templateReferenceJson` is supplied, the
 * message includes a "Structural reference" block AFTER the request + source
 * sections. The model is told to ADAPT the reference based on the request
 * rather than copy verbatim. The reference goes in the user message (not the
 * system block) because it's user-volatile -- different requests pick
 * different templates and a cached template would poison cross-request hits. */
export function composeUserMessage(input: {
	prompt: string;
	sourceText: string | null;
	templateReferenceJson?: string | null;
}): string {
	const sections: string[] = [];

	if (input.sourceText) {
		sections.push(
			[
				"Build a workflow for the following request, grounded in the supplied source text",
				"(e.g. an existing SOP, a Tango export, a meeting transcript). Treat the source as",
				"authoritative for structure; use the request to clarify scope. Return ONE JSON",
				"object matching the OUTPUT SHAPE in the system contract; no prose, no code fence.",
			].join("\n"),
		);
	} else {
		sections.push(
			[
				"Build a workflow for the following request. Return ONE JSON object matching",
				"the OUTPUT SHAPE in the system contract; no prose, no code fence.",
			].join("\n"),
		);
	}

	sections.push(`Request:\n${input.prompt}`);

	if (input.sourceText) {
		sections.push(`Source text:\n${input.sourceText}`);
	}

	if (input.templateReferenceJson) {
		sections.push(
			[
				"Structural reference (use this workflow's shape as a starting point;",
				"ADAPT based on the request above -- do not copy verbatim. Field keys,",
				"step titles, and descriptions should reflect the request's scope, not",
				"the reference's. Add, remove, or rename steps/fields freely):",
				input.templateReferenceJson,
			].join("\n"),
		);
	}

	return sections.join("\n\n");
}

// ---------------------------------------------------------------------------
// Phase 12 regenerateStep (D-040, PRD §6.3 G10) -- per-step regeneration prompt
// ---------------------------------------------------------------------------

/** Compose the system blocks for a regenerate-step call. Reuses the cacheable
 * builder contract + entity schema blocks from the workflow-level path so the
 * cache prefix stays warm across both authoring AND regeneration calls for the
 * same org -- they share the same closed vocabulary + the same entity schema. */
export function composeRegenerateStepSystemPrompt(
	input: ComposeSystemPromptInput,
): SystemBlock[] {
	const blocks = composeSystemPrompt(input);
	// Add a small uncached final block scoping the model to a single-step output
	// shape. Kept short + uncached because it's regenerate-specific (the
	// authoring path doesn't need it) and we don't want it to invalidate the
	// authoring path's cache prefix.
	return [
		...blocks,
		{
			type: "text",
			text: regenerateStepContractAddendum(),
		},
	];
}

function regenerateStepContractAddendum(): string {
	return [
		"# Per-step regeneration mode",
		"",
		"In this call you are regenerating ONE specific step in an existing workflow, NOT",
		"authoring a whole workflow. Return ONE JSON object matching the STEP SHAPE below",
		"(a subset of the workflow's OUTPUT SHAPE -- just the step fields).",
		"",
		"## Step shape",
		"",
		"{",
		'  "title": "<step title, required>",',
		'  "description": "<step description, optional, can be null>",',
		'  "type": "<task | approval | heading | one_off, required>",',
		'  "isRequired": <true | false, optional, defaults true>,',
		'  "isStopTask": <true | false, optional, defaults false>,',
		'  "dueType": "<none | offset_from_start, optional>",',
		'  "dueOffsetDays": <integer, required when dueType="offset_from_start">,',
		'  "fields": [<AuthoredField, ...>] (optional; step-scoped fields)',
		"}",
		"",
		"## Hard constraints for regenerate",
		"",
		"1. Emit ONLY the step shape above. Do NOT wrap it in a workflow shape.",
		"2. dueType is restricted to 'none' or 'offset_from_start' in regenerate. Cross-step",
		"   references ('offset_from_step', 'from_date_field') are NOT supported here -- if",
		"   the original step had a cross-step due rule, the operator will re-establish it",
		"   in the manual builder after regeneration.",
		"3. NEVER reference fields that live on other steps. The fields you emit MUST live on",
		"   THIS step only. Kickoff field references in description text are allowed and",
		"   preserved verbatim (mustache `{{ field_key }}`); you cannot rename them.",
		"4. Other steps in the workflow are listed below for context. AI-generated siblings",
		"   are shown with title + position so you can phrase this step coherently. Manually-",
		"   edited siblings are shown as opaque '[manually-edited step at position N]' --",
		"   you cannot read their content, reference their fields, or modify them in any way.",
		"5. Per the regenerate contract: this call writes ONLY the target step. The validator",
		"   will reject any output that attempts to imply edits to siblings, sections, or",
		"   the workflow header.",
	].join("\n");
}

/** Compose the user-message body for a regenerate-step call. The body carries
 * the target step's current content, the AI-generated sibling context (read-only
 * for the model), the opaque placeholders for manually_edited siblings, and the
 * operator's optional refinement instruction. */
export function composeRegenerateStepUserMessage(input: {
	currentStep: {
		title: string;
		description: string | null;
		type: string;
		isRequired: boolean;
		isStopTask: boolean;
		dueType: string;
		dueOffsetDays: number | null;
		position: number;
		fields: ReadonlyArray<{ key: string; label: string; fieldType: string; isRequired: boolean }>;
	};
	aiGeneratedSiblings: ReadonlyArray<{ position: number; title: string; type: string }>;
	manuallyEditedSiblingPositions: ReadonlyArray<number>;
	kickoffFieldKeys: ReadonlyArray<string>;
	refinementPrompt: string | null;
}): string {
	const lines: string[] = [];
	lines.push(
		"Regenerate the following step. Return ONE JSON object matching the STEP SHAPE in",
		"the system contract addendum; no prose, no code fence.",
		"",
		"## Current step content",
		"",
		JSON.stringify(
			{
				title: input.currentStep.title,
				description: input.currentStep.description,
				type: input.currentStep.type,
				isRequired: input.currentStep.isRequired,
				isStopTask: input.currentStep.isStopTask,
				dueType: input.currentStep.dueType,
				dueOffsetDays: input.currentStep.dueOffsetDays,
				positionInWorkflow: input.currentStep.position,
				fields: input.currentStep.fields,
			},
			null,
			2,
		),
		"",
	);
	if (input.aiGeneratedSiblings.length > 0) {
		lines.push("## Other AI-generated steps (read-only context)", "");
		for (const s of input.aiGeneratedSiblings) {
			lines.push(`- position ${s.position}: ${s.title} (type=${s.type})`);
		}
		lines.push("");
	}
	if (input.manuallyEditedSiblingPositions.length > 0) {
		lines.push("## Manually-edited steps (opaque -- do not reference)", "");
		for (const p of input.manuallyEditedSiblingPositions) {
			lines.push(`- [manually-edited step at position ${p}]`);
		}
		lines.push("");
	}
	if (input.kickoffFieldKeys.length > 0) {
		lines.push(
			"## Kickoff field keys (you may reference these in description merge variables)",
			"",
			input.kickoffFieldKeys.map((k) => `- ${k}`).join("\n"),
			"",
		);
	}
	if (input.refinementPrompt) {
		lines.push(
			"## Operator refinement instruction (steer your regeneration accordingly)",
			"",
			input.refinementPrompt,
			"",
		);
	} else {
		lines.push(
			"## Operator refinement instruction",
			"",
			"(none -- regenerate the step in line with the current content's intent)",
			"",
		);
	}
	return lines.join("\n");
}
