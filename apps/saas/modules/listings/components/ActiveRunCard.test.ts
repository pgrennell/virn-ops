// Phase 10 / v1.5c (PRD §6.5 / R6 lift) -- ActiveRunCard helper tests.
// The card component itself is a TanStack-query wrapper exercised in the
// Antigravity E2E; these tests pin the relative-date helper so the row
// subtitle stays single-line at all expected boundaries.

import { describe, expect, it } from "vitest";

import { formatRelativeShort } from "./ActiveRunCard";

const NOW = new Date("2026-05-29T15:00:00Z");

describe("formatRelativeShort -- bucket transitions", () => {
	it("returns \"just now\" under a minute", () => {
		expect(
			formatRelativeShort(new Date("2026-05-29T14:59:30Z"), NOW),
		).toBe("just now");
	});

	it("returns minutes for under an hour", () => {
		expect(
			formatRelativeShort(new Date("2026-05-29T14:55:00Z"), NOW),
		).toBe("5m ago");
		expect(
			formatRelativeShort(new Date("2026-05-29T14:01:00Z"), NOW),
		).toBe("59m ago");
	});

	it("returns hours for under a day", () => {
		expect(
			formatRelativeShort(new Date("2026-05-29T13:00:00Z"), NOW),
		).toBe("2h ago");
		expect(
			formatRelativeShort(new Date("2026-05-28T16:00:00Z"), NOW),
		).toBe("23h ago");
	});

	it("returns days for under 30 days", () => {
		expect(
			formatRelativeShort(new Date("2026-05-28T15:00:00Z"), NOW),
		).toBe("1d ago");
		expect(
			formatRelativeShort(new Date("2026-05-01T15:00:00Z"), NOW),
		).toBe("28d ago");
	});

	it("returns a calendar date for past 30 days", () => {
		const result = formatRelativeShort(new Date("2026-04-01T15:00:00Z"), NOW);
		// Locale-sensitive month/day output; assert the shape is a short date,
		// not the relative bucket.
		expect(result).not.toMatch(/ago$/);
		expect(result).toMatch(/Apr|04/);
	});

	it("accepts a string input (TanStack Query returns dates as ISO strings on the wire)", () => {
		expect(formatRelativeShort("2026-05-29T14:55:00Z", NOW)).toBe("5m ago");
	});
});
