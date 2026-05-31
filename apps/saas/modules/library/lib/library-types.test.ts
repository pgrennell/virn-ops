// saas library lib hardening -- library-types.ts is the single source of truth for the
// Library type-tab <-> workflow.type mapping (read by the tab filter, the + Create menu,
// the row chips, the empty-state CTA). Pure data + filterRowsByTab. Pins the filter
// behaviour + the cross-table completeness invariants the file's own comments call out
// (every workflow.type must be reachable through the tabs / create menu / chips).

import { describe, expect, it } from "vitest";

import {
	filterRowsByTab,
	LIBRARY_CREATE_MENU,
	LIBRARY_TYPE_CHIPS,
	LIBRARY_TYPE_TABS,
	type WorkflowType,
} from "./library-types";

const ALL_TYPES: WorkflowType[] = ["procedure", "document", "policy", "form"];

const rows = [
	{ id: "a", type: "procedure" as const },
	{ id: "b", type: "document" as const },
	{ id: "c", type: "policy" as const },
	{ id: "d", type: "form" as const },
];

describe("filterRowsByTab", () => {
	it("returns all rows unchanged for the All tab", () => {
		expect(filterRowsByTab(rows, "all")).toEqual(rows);
	});

	it("workflows tab returns only procedure rows", () => {
		expect(filterRowsByTab(rows, "workflows").map((r) => r.id)).toEqual(["a"]);
	});

	it("sops tab returns document + policy rows", () => {
		expect(filterRowsByTab(rows, "sops").map((r) => r.id)).toEqual(["b", "c"]);
	});

	it("forms tab returns only form rows", () => {
		expect(filterRowsByTab(rows, "forms").map((r) => r.id)).toEqual(["d"]);
	});

	it("returns all rows for an unknown tab id (defensive)", () => {
		expect(filterRowsByTab(rows, "ghost" as never)).toEqual(rows);
	});

	it("handles an empty row list", () => {
		expect(filterRowsByTab([], "workflows")).toEqual([]);
	});
});

describe("LIBRARY_TYPE_TABS -- completeness + consistency", () => {
	it("every workflow.type is included by exactly one non-All tab (no type falls through)", () => {
		const counts = new Map<WorkflowType, number>(ALL_TYPES.map((t) => [t, 0]));
		for (const tab of LIBRARY_TYPE_TABS) {
			if (tab.includes === null) continue; // the All tab
			for (const t of tab.includes) counts.set(t, (counts.get(t) ?? 0) + 1);
		}
		for (const t of ALL_TYPES) expect(counts.get(t)).toBe(1);
	});

	it("each create-target tab's createDefaultType is one of its own includes", () => {
		for (const tab of LIBRARY_TYPE_TABS) {
			if (tab.createDefaultType === null) continue;
			expect(tab.includes).not.toBeNull();
			expect(tab.includes).toContain(tab.createDefaultType);
		}
	});
});

describe("LIBRARY_CREATE_MENU + LIBRARY_TYPE_CHIPS -- cover every workflow.type", () => {
	it("the Create menu has exactly one entry per workflow.type", () => {
		expect(LIBRARY_CREATE_MENU.map((e) => e.type).sort()).toEqual([...ALL_TYPES].sort());
	});

	it("a type chip exists for every workflow.type", () => {
		for (const t of ALL_TYPES) {
			expect(LIBRARY_TYPE_CHIPS[t]).toBeDefined();
			expect(LIBRARY_TYPE_CHIPS[t].label.length).toBeGreaterThan(0);
		}
	});
});
