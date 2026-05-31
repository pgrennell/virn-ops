// Phase 18 hardening (A5) -- D-040 isolation at the prompt-composer boundary.
// regenerate-step.test.ts pins the invariant end-to-end through the lib; this file
// pins it directly on composeRegenerateStepUserMessage so a future edit to the
// composer can't silently start leaking a manually-edited sibling's content.
//
// The architectural guarantee: the composer only RECEIVES manually-edited siblings
// as bare positions (number[]), never their type/config -- so it structurally cannot
// render their content. These tests lock that contract in place.

import { describe, expect, it } from "vitest";

import {
	composeRegenerateStepSystemPrompt,
	composeRegenerateStepUserMessage,
} from "./prompt";

function userMessage(
	over: Partial<Parameters<typeof composeRegenerateStepUserMessage>[0]> = {},
) {
	return composeRegenerateStepUserMessage({
		currentStep: { type: "send_notification", config: { type: "APP_UPDATE" }, position: 0, branchLabel: null },
		aiGeneratedSiblings: [],
		manuallyEditedSiblingPositions: [],
		refinementPrompt: null,
		...over,
	});
}

describe("composeRegenerateStepUserMessage -- D-040 isolation", () => {
	it("renders the TARGET step's own type + config (the regenerable surface)", () => {
		const msg = userMessage({
			currentStep: { type: "wait_for_duration", config: { amount: 3, unit: "days" }, position: 2, branchLabel: "approved" },
		});
		expect(msg).toContain('"type": "wait_for_duration"');
		expect(msg).toContain('"amount": 3');
		expect(msg).toContain('"branchLabel": "approved"');
	});

	it("shows AI-generated siblings as position + type (read-only context)", () => {
		const msg = userMessage({
			aiGeneratedSiblings: [
				{ position: 1, type: "wait_for_duration" },
				{ position: 2, type: "launch_workflow" },
			],
		});
		expect(msg).toContain("position 1: type=wait_for_duration");
		expect(msg).toContain("position 2: type=launch_workflow");
	});

	it("shows manually-edited siblings ONLY as opaque positions (no type, no config)", () => {
		const msg = userMessage({
			manuallyEditedSiblingPositions: [1, 4],
		});
		expect(msg).toContain("[manually-edited step at position 1]");
		expect(msg).toContain("[manually-edited step at position 4]");
		expect(msg).toContain("do not reference");
	});

	it("never emits a 'type=' marker for a manually-edited sibling (count == ai siblings)", () => {
		// 'type=' is rendered ONLY for ai-generated siblings; manually-edited ones get
		// the opaque line. So the number of 'type=' markers must equal the ai count,
		// independent of how many manually-edited siblings exist.
		const msg = userMessage({
			aiGeneratedSiblings: [{ position: 2, type: "wait_for_duration" }],
			manuallyEditedSiblingPositions: [1, 3, 5],
		});
		const typeMarkers = msg.match(/type=/g) ?? [];
		expect(typeMarkers).toHaveLength(1);
		// And none of the manual positions carry their (unknown) content.
		expect(msg).not.toContain("position 1: type=");
		expect(msg).not.toContain("position 3: type=");
		expect(msg).not.toContain("position 5: type=");
	});

	it("omits BOTH sibling sections when there are no siblings", () => {
		const msg = userMessage();
		expect(msg).not.toContain("Other AI-generated steps");
		expect(msg).not.toContain("Manually-edited steps");
	});

	it("includes the operator refinement instruction when present, a placeholder when null", () => {
		expect(userMessage({ refinementPrompt: "switch to SMS" })).toContain("switch to SMS");
		expect(userMessage({ refinementPrompt: null })).toContain("(none");
	});

	it("isolates content across an all-manual arrangement (no type markers at all)", () => {
		const msg = userMessage({ manuallyEditedSiblingPositions: [1, 2, 3] });
		expect(msg.match(/type=/g)).toBeNull();
		expect(msg).toContain("[manually-edited step at position 2]");
	});
});

describe("composeRegenerateStepSystemPrompt", () => {
	it("appends the regenerate addendum after the base system blocks", () => {
		const blocks = composeRegenerateStepSystemPrompt({ entitySchemas: [] });
		// base composeSystemPrompt returns 2 blocks; the addendum makes 3.
		expect(blocks).toHaveLength(3);
		const addendum = blocks[blocks.length - 1];
		expect(addendum.text).toContain("Per-step regeneration mode");
		// The addendum must forbid both re-parenting and touching opaque siblings.
		expect(addendum.text).toContain("do NOT");
		expect(addendum.text).toContain("Manually-edited");
		// The addendum is NOT a cache breakpoint (it's per-call, after the warm prefix).
		expect(addendum.cache_control).toBeUndefined();
	});
});
