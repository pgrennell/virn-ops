// packages/api/modules/playbooks/lib/ai-authoring/prompt.ts
//
// Phase 18c (PRD_PLAYBOOKS.md §6.2) -- compose the Claude prompt for Playbook AI
// authoring. Mirrors workflows/lib/ai-authoring/prompt.ts:
//   1. CACHEABILITY -- contract block + entity-schema block carry cache_control
//      breakpoints so the prefix stays warm across calls within the 5-min TTL.
//   2. CLOSED VOCABULARY -- the contract enumerates the exact six step types +
//      per-type config keys the validator (schema.ts) accepts.
//   3. SHAPE CONTRACT -- the expected JSON is described field-by-field with
//      placeholders, not a realistic example the model might copy verbatim.
//
// Pure (no SDK) so schema.ts + prompt.ts stay importable in tests without the network.

import type { EntitySchemaForAI } from "../../../entities/adapters";
import { AI_PLAYBOOK_STEP_TYPES } from "./schema";

export interface SystemBlock {
	type: "text";
	text: string;
	cache_control?: { type: "ephemeral" };
}

const MIN_BLOCK_CHARS_FOR_CACHE_HINT = 1500;

/** Stable across all requests + orgs -> cache breakpoint after it. Lists the six step
 * types, their config shapes, the branch mechanism, and the output grammar. */
function builderContractBlock(): string {
	return [
		"# Virn Playbook Authoring Contract",
		"",
		"You are Claude, authoring structured Playbook definitions for the Virn property-ops",
		"platform. A Playbook is a time-and-event-staged SEQUENCE (a cadence) -- distinct from",
		"a Workflow (a one-time branching procedure). You convert a property-ops admin's",
		"free-text request into a single JSON object the Virn playbook engine builds into a",
		"draft playbook. Ground your output in the entity schema you'll see below.",
		"",
		"## Output rules",
		"",
		"1. Return EXACTLY ONE JSON object matching the OUTPUT SHAPE below. No prose before or",
		"   after. No markdown code fence. No comments.",
		"2. Use ONLY the step types + config keys listed below. Other values are rejected and",
		"   the user sees an error.",
		"3. A Playbook is an ORDERED list of steps. Model time-staging with wait steps between",
		"   actions (e.g. 'wait 1 day, then send a review request'). Keep step counts realistic",
		"   (a focused cadence is 2-8 steps).",
		"",
		"## Step types + config shapes",
		"",
		`The six step types are: ${AI_PLAYBOOK_STEP_TYPES.join(" | ")}. Each step is`,
		'`{ "type": "<one of the six>", "config": { ... } }`. Config by type:',
		"",
		'- wait_for_duration -- pause the cadence. config: { "amount": <positive int>, "unit":',
		'  "minutes"|"hours"|"days"|"weeks" }. Example: wait 3 days -> {"amount":3,"unit":"days"}.',
		'- wait_for_event -- block until a named event fires. config: { "eventName": "<string>",',
		'  "timeoutDays": <positive int, optional>, "onTimeout": "continue"|"abort" (optional,',
		'  default "continue") }.',
		'- launch_workflow -- kick off a Workflow run. config: { "workflowSlug": "<slug>" } OR',
		'  { "workflowId": "<id>" } (EXACTLY ONE), plus optional "kickoffValues": {<object>} and',
		'  "mode": "human"|"ai_assisted"|"automated". Prefer workflowSlug when the request names',
		"  a workflow by name; you usually won't know raw ids.",
		'- send_notification -- notify someone. config: { "type": "<notification type, e.g.',
		'  ACKNOWLEDGMENT_DUE>", "userId": "<recipient id, optional>", "link": "<url, optional>",',
		'  "data": {<object, optional>} }. Recipient wiring beyond an explicit userId is done by',
		"  a human later; emit the intent + type.",
		'- branch_on_data_set -- choose a sub-path from a value. config: { "branches":',
		'  ["<label1>", "<label2>", ...] } plus EITHER { "dataSetKey": "<key>", "recordLabel":',
		'  "<label>", "field": "<field, optional>" } (read a data-set record) OR { "source":',
		'  "<dot.path.into.trigger.payload>" }. The branch CHILDREN are separate steps that set',
		"  parentStepIndex + branchLabel (see branching below).",
		'- write_to_data_set -- append a record. config: { "dataSetKey": "<key>", "label":',
		'  "<record label>", "value": {<object, optional>} }.',
		"",
		"## Branching",
		"",
		"To branch, emit a branch_on_data_set step, then emit its child steps LATER in the",
		"array, each with:",
		'  "parentStepIndex": <0-based index of the branch_on_data_set step (must be EARLIER)>,',
		'  "branchLabel": "<one of that parent\'s config.branches values>".',
		"A child whose label isn't one of the parent's branches is rejected. Steps without",
		"parentStepIndex/branchLabel are top-level (run in sequence).",
		"",
		"## Output shape",
		"",
		"```",
		"{",
		'  "name": "<human-readable playbook name, max 120 chars>",',
		'  "description": "<optional one-paragraph description, max 2000 chars> | null",',
		'  "steps": [',
		"    {",
		'      "type": "<one of the six step types>",',
		'      "config": { <type-specific, per the shapes above> },',
		'      "parentStepIndex": 0,        // ONLY for branch children; index into steps[]',
		'      "branchLabel": "approved"    // ONLY for branch children; one of the parent branches',
		"    }",
		"  ]",
		"}",
		"```",
		"",
		"## Authoring guidance",
		"",
		"- Insert wait_for_duration steps to space actions over time -- that's the whole point",
		"  of a Playbook vs a Workflow.",
		"- launch_workflow is how a Playbook hands off real procedural work to a Workflow.",
		"- The user's prompt may name property types, vendor categories, or data sets. Cross-",
		"  reference these against the entity schema below; if a name doesn't match a registered",
		"  entity, treat it as descriptive context, not a literal field reference.",
	].join("\n");
}

/** Render the EntityAdapter.schemaForAI() snapshots. Schema only (stable across orgs in
 * v1.5) so the cache breakpoint holds. Mirrors the workflow path's rendering. */
function entitySchemaBlock(snapshots: ReadonlyArray<EntitySchemaForAI>): string {
	const lines: string[] = [
		"# Entity Schema",
		"",
		"The Virn workspace tracks these entity types. When a Playbook references an entity,",
		"use these field names; do NOT invent fields the schema doesn't declare.",
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

export function composeSystemPrompt(input: ComposeSystemPromptInput): SystemBlock[] {
	const contract = builderContractBlock();
	const entities = entitySchemaBlock(input.entitySchemas);
	for (const [name, text] of [
		["contract", contract],
		["entitySchema", entities],
	] as const) {
		if (text.length < MIN_BLOCK_CHARS_FOR_CACHE_HINT) {
			// eslint-disable-next-line no-console
			console.warn(
				`[playbook-ai-authoring] system block "${name}" is ${text.length} chars; below` +
					` the heuristic threshold of ${MIN_BLOCK_CHARS_FOR_CACHE_HINT}. The Anthropic` +
					` cache breakpoint may be ignored.`,
			);
		}
	}
	return [
		{ type: "text", text: contract, cache_control: { type: "ephemeral" } },
		{ type: "text", text: entities, cache_control: { type: "ephemeral" } },
	];
}

export function composeUserMessage(input: {
	prompt: string;
	sourceText: string | null;
	templateReferenceJson?: string | null;
}): string {
	const sections: string[] = [];
	sections.push(
		input.sourceText
			? [
					"Build a Playbook for the following request, grounded in the supplied source",
					"text. Return ONE JSON object matching the OUTPUT SHAPE in the system contract;",
					"no prose, no code fence.",
				].join("\n")
			: [
					"Build a Playbook for the following request. Return ONE JSON object matching the",
					"OUTPUT SHAPE in the system contract; no prose, no code fence.",
				].join("\n"),
	);
	sections.push(`Request:\n${input.prompt}`);
	if (input.sourceText) sections.push(`Source text:\n${input.sourceText}`);
	if (input.templateReferenceJson) {
		sections.push(
			[
				"Structural reference (use this playbook's shape as a starting point; ADAPT based",
				"on the request above -- do not copy verbatim):",
				input.templateReferenceJson,
			].join("\n"),
		);
	}
	return sections.join("\n\n");
}

// ---------------------------------------------------------------------------
// Per-step regeneration (D-040, PRD §6.2) -- regenerate ONE step in place
// ---------------------------------------------------------------------------

export function composeRegenerateStepSystemPrompt(
	input: ComposeSystemPromptInput,
): SystemBlock[] {
	return [
		...composeSystemPrompt(input),
		{ type: "text", text: regenerateStepContractAddendum() },
	];
}

function regenerateStepContractAddendum(): string {
	return [
		"# Per-step regeneration mode",
		"",
		"In this call you are regenerating ONE specific step in an existing Playbook, NOT",
		"authoring a whole playbook. Return ONE JSON object matching the STEP SHAPE below",
		"(just the step's own type + config).",
		"",
		"## Step shape",
		"",
		"{",
		'  "type": "<one of the six step types>",',
		'  "config": { <type-specific config per the system contract> }',
		"}",
		"",
		"## Hard constraints for regenerate",
		"",
		"1. Emit ONLY the step shape above. Do NOT wrap it in a playbook shape, and do NOT",
		"   emit parentStepIndex/branchLabel -- the step keeps its existing position + branch",
		"   context; you regenerate only its type + config.",
		"2. Other steps in the Playbook are listed below for context. AI-generated siblings are",
		"   shown with position + type so you can phrase this step coherently. Manually-edited",
		"   siblings are shown as opaque '[manually-edited step at position N]' -- you cannot",
		"   read their content, reference them, or modify them in any way.",
		"3. Per the regenerate contract: this call writes ONLY the target step. The validator",
		"   rejects any output implying edits to siblings.",
	].join("\n");
}

export function composeRegenerateStepUserMessage(input: {
	currentStep: {
		type: string;
		config: unknown;
		position: number;
		branchLabel: string | null;
	};
	aiGeneratedSiblings: ReadonlyArray<{ position: number; type: string }>;
	manuallyEditedSiblingPositions: ReadonlyArray<number>;
	refinementPrompt: string | null;
}): string {
	const lines: string[] = [];
	lines.push(
		"Regenerate the following step. Return ONE JSON object matching the STEP SHAPE in the",
		"system contract addendum; no prose, no code fence.",
		"",
		"## Current step content",
		"",
		JSON.stringify(
			{
				type: input.currentStep.type,
				config: input.currentStep.config,
				positionInPlaybook: input.currentStep.position,
				branchLabel: input.currentStep.branchLabel,
			},
			null,
			2,
		),
		"",
	);
	if (input.aiGeneratedSiblings.length > 0) {
		lines.push("## Other AI-generated steps (read-only context)", "");
		for (const s of input.aiGeneratedSiblings) {
			lines.push(`- position ${s.position}: type=${s.type}`);
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
	lines.push(
		"## Operator refinement instruction",
		"",
		input.refinementPrompt
			? input.refinementPrompt
			: "(none -- regenerate the step in line with the current content's intent)",
		"",
	);
	return lines.join("\n");
}
