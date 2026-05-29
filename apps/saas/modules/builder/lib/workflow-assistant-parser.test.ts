// workflow-assistant-parser.test.ts
//
// Pure-function tests for the Workflow Assistant prompt parser. No React,
// no DB stubs needed; just expressions in / structured calls or refusals out.

import { describe, expect, it } from "vitest";

import {
	type AssistantContextStep,
	parseAssistantPrompt,
} from "./workflow-assistant-parser";

const STEPS: AssistantContextStep[] = [
	{ id: "st_1", title: "Schedule cleaning", position: 0 },
	{ id: "st_2", title: "Inspect kitchen", position: 1 },
	{ id: "st_3", title: "Document issues", position: 2 },
	{ id: "st_4", title: "Sign off", position: 3 },
];

function call(
	prompt: string,
	activeStepId: string | null = null,
	steps = STEPS,
) {
	return parseAssistantPrompt({ prompt, steps, activeStepId });
}

describe("parseAssistantPrompt -- structured edits", () => {
	it('resolves "step 3" to position 2 (1-indexed -> 0-indexed)', () => {
		const result = call("make step 3 terser");
		expect(result).toMatchObject({
			kind: "structured",
			targetStepId: "st_3",
			targetStepTitle: "Document issues",
		});
	});

	it('strips "step N" from the refinement prompt', () => {
		const result = call("make step 3 terser");
		if (result.kind !== "structured") throw new Error("expected structured");
		expect(result.refinementPrompt).toBe("make terser");
	});

	it('resolves "the first step" to position 0', () => {
		const result = call("rephrase the first step to use plain English");
		expect(result).toMatchObject({
			kind: "structured",
			targetStepId: "st_1",
		});
	});

	it('resolves "the last step" to the highest position', () => {
		const result = call("make the last step optional");
		expect(result).toMatchObject({
			kind: "structured",
			targetStepId: "st_4",
		});
	});

	it("resolves an exact-quoted title", () => {
		const result = call('add a textarea for findings to "Inspect kitchen"');
		expect(result).toMatchObject({
			kind: "structured",
			targetStepId: "st_2",
			// The trailing "to" gets stripped as a dangling preposition after
			// the quoted-title removal -- intentional cleanup so the refinement
			// prompt reads naturally.
			refinementPrompt: "add a textarea for findings",
		});
	});

	it('handles "step #N" syntax', () => {
		const result = call("regenerate step #2");
		expect(result).toMatchObject({
			kind: "structured",
			targetStepId: "st_2",
		});
	});

	it('handles "step number N" syntax', () => {
		const result = call("rephrase step number 4 as a question");
		expect(result).toMatchObject({
			kind: "structured",
			targetStepId: "st_4",
		});
	});

	it('falls back to "this step" + activeStepId when the prompt has no explicit reference', () => {
		const result = call("make this step terser", "st_2");
		expect(result).toMatchObject({
			kind: "structured",
			targetStepId: "st_2",
		});
	});

	it("uses the active selection on an implicit prompt with no step reference at all", () => {
		const result = call("make it terser please", "st_3");
		expect(result).toMatchObject({
			kind: "structured",
			targetStepId: "st_3",
		});
	});

	it("returns the original prompt as refinement when stripping would leave it empty", () => {
		const result = call("step 1");
		if (result.kind !== "structured") throw new Error("expected structured");
		// "step 1" stripped leaves empty -> we preserve the full text.
		expect(result.refinementPrompt).toBe("step 1");
	});
});

describe("parseAssistantPrompt -- refusals + edge cases", () => {
	it('refuses with "ambiguous" when multiple distinct steps are referenced', () => {
		const result = call("rephrase step 2 and step 4");
		expect(result.kind).toBe("ambiguous");
	});

	it('refuses with "ambiguous" when a quoted title + a different numeric reference disagree', () => {
		const result = call('rewrite "Schedule cleaning" and step 3');
		expect(result.kind).toBe("ambiguous");
	});

	it("does NOT mark ambiguous when both references point to the same step", () => {
		// "step 1" and the quoted title both resolve to st_1.
		const result = call('clean up step 1 and "Schedule cleaning"');
		expect(result.kind).toBe("structured");
		if (result.kind !== "structured") throw new Error("unreachable");
		expect(result.targetStepId).toBe("st_1");
	});

	it('returns "no-target" with an empty prompt', () => {
		expect(call("").kind).toBe("no-target");
		expect(call("   ").kind).toBe("no-target");
	});

	it('returns "no-target" when the workflow has no steps yet', () => {
		const result = call("make step 3 terser", null, []);
		expect(result.kind).toBe("no-target");
	});

	it('routes questions to "unrouted" with a helpful response', () => {
		const result = call("what's the difference between approval and one_off?");
		expect(result.kind).toBe("unrouted");
	});

	it('treats prompts starting with "explain" as questions', () => {
		const result = call("explain how due rules work");
		expect(result.kind).toBe("unrouted");
	});

	// Regression tests for the 2026-05-29 Antigravity-surfaced parser bug.
	// Before the fix, questions with an active step set fell through to the
	// implicit-active-step branch and dispatched real regenerateStep calls.
	// The Builder defaults to a step being selected, so this was the common
	// case -- not the edge case. See REPORT.md §Recommend Amend for the
	// repro path.

	it("question with an active step still routes to unrouted (regression: 2026-05-29)", () => {
		// Pre-fix this returned `kind: 'structured'` with targetStepId='st_2'
		// because activeStepId was set; the question slipped past the unrouted
		// check.
		const result = call(
			"what's the difference between approval and one_off step types?",
			"st_2",
		);
		expect(result.kind).toBe("unrouted");
	});

	it('"explain..." prompts with an active step still route to unrouted (regression)', () => {
		const result = call("explain how due rules work", "st_1");
		expect(result.kind).toBe("unrouted");
	});

	it("question ending with ? + active selection routes to unrouted regardless of active step (regression)", () => {
		const result = call("how does offset_from_step resolve at launch?", "st_3");
		expect(result.kind).toBe("unrouted");
	});

	it('returns "no-target" when no step reference resolves and no active step is set', () => {
		const result = call("make it terser please", null);
		expect(result.kind).toBe("no-target");
	});

	it("treats an out-of-range numeric reference as no-target", () => {
		// step 99 doesn't exist; nothing else does either.
		const result = call("regenerate step 99");
		expect(result.kind).toBe("no-target");
	});

	it("ignores a quoted string that doesn't match any title (no false positive)", () => {
		// Quoted phrase isn't a step title; falls through to other resolvers.
		// With no other reference + no active step, returns no-target.
		const result = call('make it more like the "best practice"');
		expect(result.kind).toBe("no-target");
	});

	it('handles "step 0" as out-of-range (UX is 1-indexed; position 0 = step 1)', () => {
		const result = call("regenerate step 0");
		// "step 0" matches the numeric regex but resolves to position -1 (no match).
		// No other reference -> no-target.
		expect(result.kind).toBe("no-target");
	});
});
