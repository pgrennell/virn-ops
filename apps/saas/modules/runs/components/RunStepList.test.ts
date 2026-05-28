// Phase 12.2 -- formatDueRule covers the author-mode chip's text rendering for
// every dueType + the "incomplete config" fallback paths.

import { describe, expect, it } from "vitest";

import { formatDueRule } from "./RunStepList";

type Rule = Parameters<typeof formatDueRule>[0];

const baseRule = (overrides: Partial<Rule> = {}): Rule => ({
	dueType: "none",
	dueOffsetDays: null,
	dueAnchorStepTitle: null,
	dueSourceFieldKey: null,
	...overrides,
});

describe("formatDueRule -- offset_from_start", () => {
	it("'due Nd after launch' for positive offsets", () => {
		const { text } = formatDueRule(
			baseRule({ dueType: "offset_from_start", dueOffsetDays: 3 }),
		);
		expect(text).toBe("due 3d after launch");
	});

	it("'due at launch' for offset=0", () => {
		const { text } = formatDueRule(
			baseRule({ dueType: "offset_from_start", dueOffsetDays: 0 }),
		);
		expect(text).toBe("due at launch");
	});

	it("renders nothing when offset is null (config still incomplete)", () => {
		const { text } = formatDueRule(
			baseRule({ dueType: "offset_from_start", dueOffsetDays: null }),
		);
		expect(text).toBe("");
	});
});

describe("formatDueRule -- offset_from_step", () => {
	it("positive offset reads 'Nd after \"<anchor>\"'", () => {
		const { text } = formatDueRule(
			baseRule({
				dueType: "offset_from_step",
				dueOffsetDays: 2,
				dueAnchorStepTitle: "Inspect kitchen",
			}),
		);
		expect(text).toBe("due 2d after Inspect kitchen");
	});

	it("negative offset reads 'Nd before \"<anchor>\"' (using absolute value)", () => {
		const { text } = formatDueRule(
			baseRule({
				dueType: "offset_from_step",
				dueOffsetDays: -3,
				dueAnchorStepTitle: "Lease signed",
			}),
		);
		expect(text).toBe("due 3d before Lease signed");
	});

	it("offset=0 reads 'on <anchor>'", () => {
		const { text } = formatDueRule(
			baseRule({
				dueType: "offset_from_step",
				dueOffsetDays: 0,
				dueAnchorStepTitle: "Inspector signs off",
			}),
		);
		expect(text).toBe("due on Inspector signs off");
	});

	it("missing anchor title falls back to the incomplete-config marker", () => {
		const { text, title } = formatDueRule(
			baseRule({
				dueType: "offset_from_step",
				dueOffsetDays: 2,
				dueAnchorStepTitle: null,
			}),
		);
		expect(text).toBe("due rule incomplete");
		expect(title).toMatch(/Anchor step or offset not set/);
	});

	it("missing offset also falls back", () => {
		const { text } = formatDueRule(
			baseRule({
				dueType: "offset_from_step",
				dueOffsetDays: null,
				dueAnchorStepTitle: "Anchor",
			}),
		);
		expect(text).toBe("due rule incomplete");
	});
});

describe("formatDueRule -- from_date_field", () => {
	it("wraps the source key in {{ }} for visual distinction", () => {
		const { text } = formatDueRule(
			baseRule({
				dueType: "from_date_field",
				dueOffsetDays: 7,
				dueSourceFieldKey: "lease_start",
			}),
		);
		expect(text).toBe("due 7d after {{lease_start}}");
	});

	it("negative offset reads 'before {{key}}' for guest-arrival-style patterns", () => {
		const { text } = formatDueRule(
			baseRule({
				dueType: "from_date_field",
				dueOffsetDays: -1,
				dueSourceFieldKey: "guest_arrival",
			}),
		);
		expect(text).toBe("due 1d before {{guest_arrival}}");
	});

	it("missing source key falls back to incomplete marker", () => {
		const { text } = formatDueRule(
			baseRule({
				dueType: "from_date_field",
				dueOffsetDays: 3,
				dueSourceFieldKey: null,
			}),
		);
		expect(text).toBe("due rule incomplete");
	});
});

describe("formatDueRule -- 'none' renders nothing", () => {
	it("returns empty text for dueType='none'", () => {
		const { text } = formatDueRule(baseRule({ dueType: "none" }));
		expect(text).toBe("");
	});
});
