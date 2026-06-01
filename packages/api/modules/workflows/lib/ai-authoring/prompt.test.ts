// Unit tests for the AI-authoring prompt composers (Phase 12.1 / D-040). Pure string +
// system-block assembly, no SDK/network. Pins: the cached system-block structure + closed
// vocabulary in the contract, the entity-schema rendering, the user-message branches
// (source text / template reference vs adapt), the regenerate addendum, and -- most
// importantly -- the D-040 isolation rule: manually-edited siblings render as opaque
// position placeholders, never their content.

import { describe, expect, it, vi } from "vitest";

import type { EntitySchemaForAI } from "../../../entities/adapters";
import {
	composeRegenerateStepSystemPrompt,
	composeRegenerateStepUserMessage,
	composeSystemPrompt,
	composeUserMessage,
} from "./prompt";
import { AI_ALLOWED_STEP_TYPES } from "./schema";

const SNAPSHOTS = [
	{
		type: "listing",
		label: "Listing",
		description: "A property listing.",
		fields: [
			{ key: "address", label: "Address", dataType: "text", nullable: false },
			{ key: "beds", label: "Beds", dataType: "number", nullable: true, description: "bedroom count" },
		],
		commonCohortDimensions: ["region", "property_type"],
	},
] as unknown as EntitySchemaForAI[];

describe("composeSystemPrompt", () => {
	it("returns contract + entity-schema blocks, both cache-controlled", () => {
		const blocks = composeSystemPrompt({ entitySchemas: SNAPSHOTS });
		expect(blocks).toHaveLength(2);
		for (const b of blocks) {
			expect(b.type).toBe("text");
			expect(b.cache_control).toEqual({ type: "ephemeral" });
		}
	});

	it("embeds the closed step-type vocabulary in the contract block", () => {
		const [contract] = composeSystemPrompt({ entitySchemas: SNAPSHOTS });
		expect(contract.text).toContain("Virn Workflow Authoring Contract");
		for (const t of AI_ALLOWED_STEP_TYPES) {
			expect(contract.text).toContain(t);
		}
	});

	it("renders the entity schema (fields, optional marker, cohort dimensions)", () => {
		const [, entities] = composeSystemPrompt({ entitySchemas: SNAPSHOTS });
		expect(entities.text).toContain('Listing (type="listing")');
		expect(entities.text).toContain("address");
		expect(entities.text).toContain("(optional)"); // beds is nullable
		expect(entities.text).toContain("bedroom count"); // field description
		expect(entities.text).toContain("region"); // cohort dimension
	});

	it("warns when a cache-marked block is suspiciously short (empty schema)", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		composeSystemPrompt({ entitySchemas: [] });
		expect(warn).toHaveBeenCalled();
		expect(warn.mock.calls.some((c) => String(c[0]).includes("entitySchema"))).toBe(true);
		warn.mockRestore();
	});
});

describe("composeUserMessage", () => {
	it("builds a plain request message with no source/template", () => {
		const msg = composeUserMessage({ prompt: "Turnover checklist", sourceText: null });
		expect(msg).toContain("Request:\nTurnover checklist");
		expect(msg).not.toContain("Source text:");
		expect(msg).not.toContain("Structural reference");
	});

	it("includes the source text block when provided", () => {
		const msg = composeUserMessage({ prompt: "From this SOP", sourceText: "1. Do a thing" });
		expect(msg).toContain("grounded in the supplied source text");
		expect(msg).toContain("Source text:\n1. Do a thing");
	});

	it("adds an adapt-freely reference block by default", () => {
		const msg = composeUserMessage({
			prompt: "Like that one",
			sourceText: null,
			templateReferenceJson: '{"title":"Base"}',
		});
		expect(msg).toContain("Structural reference");
		expect(msg).toContain("ADAPT based on the request");
		expect(msg).toContain('{"title":"Base"}');
	});

	it("switches to keep-intact wording in adapt mode", () => {
		const msg = composeUserMessage({
			prompt: "Tweak it",
			sourceText: null,
			templateReferenceJson: '{"title":"Base"}',
			templateMode: "adapt",
		});
		expect(msg).toContain("keep the structure intact");
		expect(msg).not.toContain("Structural reference");
	});
});

describe("composeRegenerateStepSystemPrompt", () => {
	it("appends an uncached per-step addendum to the shared system blocks", () => {
		const blocks = composeRegenerateStepSystemPrompt({ entitySchemas: SNAPSHOTS });
		expect(blocks).toHaveLength(3);
		const addendum = blocks[2];
		expect(addendum.cache_control).toBeUndefined();
		expect(addendum.text).toContain("Per-step regeneration mode");
		expect(addendum.text).toContain("Emit ONLY the step shape");
	});
});

describe("composeRegenerateStepUserMessage (D-040 isolation)", () => {
	const base = {
		currentStep: {
			title: "Inspect kitchen",
			description: "Check appliances",
			type: "task",
			isRequired: true,
			isStopTask: false,
			dueType: "none",
			dueOffsetDays: null,
			position: 1,
			fields: [],
		},
		aiGeneratedSiblings: [{ position: 0, title: "Unlock unit", type: "task" }],
		manuallyEditedSiblingPositions: [2],
		kickoffFieldKeys: ["guest_arrival"],
		refinementPrompt: null as string | null,
	};

	it("includes the current step content and AI sibling context", () => {
		const msg = composeRegenerateStepUserMessage(base);
		expect(msg).toContain("Inspect kitchen");
		expect(msg).toContain("position 0: Unlock unit (type=task)");
		expect(msg).toContain("guest_arrival");
	});

	it("renders manually-edited siblings as opaque position placeholders (no content)", () => {
		const msg = composeRegenerateStepUserMessage(base);
		expect(msg).toContain("[manually-edited step at position 2]");
		expect(msg).toContain("Manually-edited steps (opaque");
	});

	it("includes the operator refinement when present, else a none marker", () => {
		const withPrompt = composeRegenerateStepUserMessage({
			...base,
			refinementPrompt: "Make it stricter",
		});
		expect(withPrompt).toContain("Make it stricter");

		const without = composeRegenerateStepUserMessage(base);
		expect(without).toContain("(none");
	});
});
