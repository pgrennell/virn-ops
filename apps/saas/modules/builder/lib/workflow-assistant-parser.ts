// apps/saas/modules/builder/lib/workflow-assistant-parser.ts
//
// Phase 12 / PRD §6.3 R1 -- parse a free-text Workflow Assistant prompt into a
// structured `agents.regenerateStep` call (target step id + refinement prompt).
// Pure function; no React, no DOM, no oRPC. The chat panel composes this with
// the existing useRegenerateStep mutation.
//
// The PRD distinguishes two prompt classes:
//   1. STRUCTURED EDIT REQUESTS -- "make step 3 terser", "add a vendor field
//      to step 5", "regenerate the inspection step". These route here and
//      become regenerateStep calls.
//   2. FREE-FORM QUESTIONS -- "what's the difference between approval and
//      one_off?". These would route to a documentation-aware chat thread.
//      Out of scope for v1; this parser returns a "kind: 'unrouted'" result
//      so the panel can surface a "I can only help with step edits right now"
//      response.
//
// Step-reference grammar accepted in v1:
//   - "step N" / "step #N" / "step number N"      (1-indexed in UX; 0-indexed
//                                                  position internally)
//   - "the Nth step" where N ∈ {first, second, third, fourth, fifth, sixth,
//                               seventh, eighth, ninth, tenth, last}
//   - "this step"                                  (uses activeStepId fallback)
//   - quoted exact-match titles: "Schedule cleaning"
//
// Resolution order:
//   1. Quoted exact-match title (highest specificity).
//   2. Ordinal phrase ("the first step").
//   3. "step N" numeric reference.
//   4. "this step" / no explicit reference + activeStepId set.
//
// Ambiguity: if a prompt references multiple distinct steps ("regenerate
// step 3 and step 5"), the parser returns `kind: 'ambiguous'`. The chat
// panel surfaces "I can only refine one step per message; try splitting
// into two messages."

export interface AssistantContextStep {
	id: string;
	title: string;
	position: number;
}

export interface AssistantParseInput {
	prompt: string;
	steps: ReadonlyArray<AssistantContextStep>;
	activeStepId: string | null;
}

export type AssistantParseResult =
	| {
			kind: "structured";
			targetStepId: string;
			targetStepTitle: string;
			refinementPrompt: string;
	  }
	| { kind: "unrouted"; reason: string }
	| { kind: "ambiguous"; reason: string }
	| { kind: "no-target"; reason: string };

const ORDINAL_TO_INDEX: Record<string, number> = {
	first: 0,
	second: 1,
	third: 2,
	fourth: 3,
	fifth: 4,
	sixth: 5,
	seventh: 6,
	eighth: 7,
	ninth: 8,
	tenth: 9,
};

/** Sniff whether the prompt is a structured edit request at all. Operates on
 * the lowercased text; a prompt that looks like a question
 * ("what is offset_from_step?") is treated as `unrouted` rather than failing
 * to find a step. */
function isLikelyQuestion(prompt: string): boolean {
	const lower = prompt.trim().toLowerCase();
	if (lower.endsWith("?")) return true;
	const questionStarters = [
		"what ",
		"why ",
		"how ",
		"when ",
		"where ",
		"can you explain",
		"explain ",
	];
	for (const q of questionStarters) {
		if (lower.startsWith(q)) return true;
	}
	return false;
}

/** Extract quoted titles. Returns the array of unique quoted strings (case-
 * sensitive matching, since titles are user-authored and may carry caps). */
function extractQuotedTitles(prompt: string): string[] {
	const matches = prompt.matchAll(/"([^"]+)"/g);
	const out = new Set<string>();
	for (const m of matches) out.add(m[1]);
	return Array.from(out);
}

/** Match all `step N` / `step #N` / `step number N` references. Returns the
 * unique set of 1-indexed numbers found. */
function extractNumericStepReferences(prompt: string): number[] {
	const re = /\bstep\s*(?:#|number\s+)?(\d{1,3})\b/gi;
	const out = new Set<number>();
	for (const m of prompt.matchAll(re)) {
		const n = Number.parseInt(m[1], 10);
		if (Number.isFinite(n) && n > 0) out.add(n);
	}
	return Array.from(out);
}

/** Match ordinal phrases like "the first step", "the last step". Returns the
 * 0-indexed position or null if none. */
function extractOrdinalReference(
	prompt: string,
	stepCount: number,
): number | null {
	const lower = prompt.toLowerCase();
	// "the last step" / "last step"
	if (/\b(?:the\s+)?last\s+step\b/.test(lower)) {
		return stepCount - 1;
	}
	// "the Nth step" for N in ORDINAL_TO_INDEX
	const ordMatch = lower.match(/\b(?:the\s+)?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+step\b/);
	if (ordMatch) {
		return ORDINAL_TO_INDEX[ordMatch[1]];
	}
	return null;
}

/** Strip the resolved step reference from the prompt so what remains is the
 * refinement prompt the operator wants applied. Removes the matched
 * fragment plus surrounding "the ", "of the ", noise words. Conservative --
 * if removal would leave an empty string, the original prompt is kept (the
 * model gets the full text including the step reference, which is fine
 * because the procedure already knows the target). */
function stripStepReferenceFromPrompt(prompt: string): string {
	let stripped = prompt
		// "step N" / "step #N" / "step number N"
		.replace(/\bstep\s*(?:#|number\s+)?\d{1,3}\b/gi, "")
		// "the Nth step" / "the last step"
		.replace(
			/\b(?:the\s+)?(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last)\s+step\b/gi,
			"",
		)
		// "this step"
		.replace(/\bthis\s+step\b/gi, "")
		// quoted titles
		.replace(/"[^"]+"/g, "")
		// Common leading verbs that read awkwardly after step removal
		// ("Make terser" reads better than "Make  terser").
		.replace(/\s{2,}/g, " ")
		// Trailing/leading prepositions that are now dangling
		.replace(/\b(to|on|of|for|in)\s*$/, "")
		.replace(/^\s*(to|on|of|for|in)\s+/, "")
		.trim();
	if (stripped.length === 0) return prompt.trim();
	return stripped;
}

export function parseAssistantPrompt(
	input: AssistantParseInput,
): AssistantParseResult {
	const raw = input.prompt.trim();
	if (raw.length === 0) {
		return { kind: "no-target", reason: "Empty prompt." };
	}

	// 0. Intercept questions BEFORE any step-resolution branches.
	//
	// Bug surfaced by the 2026-05-29 Antigravity verification (REPORT.md
	// §Recommend Amend): a question like "what's the difference between
	// approval and one_off?" has no numeric / ordinal / quoted reference,
	// so the implicit-step branch below would otherwise treat it as a
	// refinement of the active step. Because the Builder opens with the
	// first step selected by default, `input.activeStepId` is almost
	// always populated -- meaning every question dispatched a real
	// regenerateStep call instead of being refused. Intercepting at the
	// top guarantees questions are unrouted regardless of selection state.
	if (isLikelyQuestion(raw)) {
		return {
			kind: "unrouted",
			reason:
				"I can only help with step edits right now. Try a request like \"make step 3 terser\" or \"add a vendor field to step 5\".",
		};
	}

	// 1. Quoted titles take highest precedence -- the operator typed an exact
	// step name, so we match against the bundle's titles directly.
	const quoted = extractQuotedTitles(raw);
	const titleMatches: AssistantContextStep[] = [];
	const titleByExactMatch = new Map(
		input.steps.map((s) => [s.title, s] as const),
	);
	for (const q of quoted) {
		const hit = titleByExactMatch.get(q);
		if (hit) titleMatches.push(hit);
	}

	// 2. Numeric step references ("step 3").
	const numericRefs = extractNumericStepReferences(raw);
	const numericMatches: AssistantContextStep[] = [];
	for (const n of numericRefs) {
		// UX is 1-indexed; position is 0-indexed.
		const target = input.steps.find((s) => s.position === n - 1);
		if (target) numericMatches.push(target);
	}

	// 3. Ordinal references ("the first step", "the last step").
	const ordinalIndex = extractOrdinalReference(raw, input.steps.length);
	const ordinalMatch =
		ordinalIndex !== null
			? input.steps.find((s) => s.position === ordinalIndex) ?? null
			: null;

	// Collect all resolved targets; if there's disagreement, the prompt is
	// ambiguous.
	const allResolvedIds = new Set<string>();
	for (const s of titleMatches) allResolvedIds.add(s.id);
	for (const s of numericMatches) allResolvedIds.add(s.id);
	if (ordinalMatch) allResolvedIds.add(ordinalMatch.id);

	if (allResolvedIds.size > 1) {
		return {
			kind: "ambiguous",
			reason:
				"I can only refine one step per message. Try splitting this into separate messages, one per step.",
		};
	}

	let resolved: AssistantContextStep | null = null;
	if (titleMatches.length > 0) resolved = titleMatches[0];
	else if (numericMatches.length > 0) resolved = numericMatches[0];
	else if (ordinalMatch) resolved = ordinalMatch;

	// 4. "this step" or implicit -- fall back to the active selection.
	if (!resolved) {
		const looksLikeImplicit =
			/\bthis\s+step\b/i.test(raw) ||
			(numericRefs.length === 0 && quoted.length === 0 && ordinalIndex === null);
		if (looksLikeImplicit && input.activeStepId) {
			const active = input.steps.find((s) => s.id === input.activeStepId);
			if (active) resolved = active;
		}
	}

	// 5. If still no target -- prompt looks like an edit request without a
	// resolvable step reference. (Question routing already happened at step 0
	// so we don't need to re-check here.)
	if (!resolved) {
		return {
			kind: "no-target",
			reason:
				input.steps.length === 0
					? "No steps in this workflow yet -- author one first."
					: `I couldn't figure out which step to edit. Try referring to it by number ("step 3"), ordinal ("the second step"), or exact title in quotes.`,
		};
	}

	const refinementPrompt = stripStepReferenceFromPrompt(raw);

	return {
		kind: "structured",
		targetStepId: resolved.id,
		targetStepTitle: resolved.title,
		refinementPrompt,
	};
}
