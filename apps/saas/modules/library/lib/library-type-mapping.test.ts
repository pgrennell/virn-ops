// library-type-mapping.test.ts
//
// Pins the single-source mapping (integrity #3 of the Library prompt): the type tabs
// + the Create menu MUST stay coordinated so a tab can never filter to a type the
// Create menu can't produce, and vice versa.

import { describe, expect, it } from "vitest";

import {
	filterRowsByTab,
	LIBRARY_CREATE_MENU,
	LIBRARY_TYPE_CHIPS,
	LIBRARY_TYPE_TABS,
	type WorkflowType,
} from "./library-types";
import type { WorkflowListRow } from "./library-row-action";

const ALL_WORKFLOW_TYPES: readonly WorkflowType[] = [
	"procedure",
	"document",
	"policy",
	"form",
];

describe("LIBRARY_TYPE_TABS coverage", () => {
	it("has exactly one 'All' tab that includes no filter", () => {
		const all = LIBRARY_TYPE_TABS.filter((t) => t.includes === null);
		expect(all).toHaveLength(1);
		expect(all[0].id).toBe("all");
	});

	it("covers every workflow.type at least once across non-All tabs", () => {
		const covered = new Set<WorkflowType>();
		for (const tab of LIBRARY_TYPE_TABS) {
			if (tab.includes === null) continue;
			for (const t of tab.includes) covered.add(t);
		}
		for (const t of ALL_WORKFLOW_TYPES) {
			expect(covered.has(t), `tab coverage missing for type=${t}`).toBe(true);
		}
	});

	it("non-All tabs are mutually exclusive (a type belongs to at most one tab)", () => {
		const seen = new Map<WorkflowType, string>();
		for (const tab of LIBRARY_TYPE_TABS) {
			if (tab.includes === null) continue;
			for (const t of tab.includes) {
				const prev = seen.get(t);
				expect(
					prev,
					`type=${t} appears in both tab=${prev} and tab=${tab.id}`,
				).toBeUndefined();
				seen.set(t, tab.id);
			}
		}
	});

	it("tab ids are unique", () => {
		const ids = LIBRARY_TYPE_TABS.map((t) => t.id);
		expect(new Set(ids).size).toBe(ids.length);
	});
});

describe("LIBRARY_CREATE_MENU coverage (create direction pinned alongside the tab direction)", () => {
	it("has exactly four entries -- one per workflow.type", () => {
		expect(LIBRARY_CREATE_MENU).toHaveLength(4);
	});

	it("covers every workflow.type exactly once", () => {
		const types = LIBRARY_CREATE_MENU.map((e) => e.type).sort();
		const expected = [...ALL_WORKFLOW_TYPES].sort();
		expect(types).toEqual(expected);
	});

	it("each entry has a non-empty label", () => {
		for (const e of LIBRARY_CREATE_MENU) {
			expect(e.label.length).toBeGreaterThan(0);
		}
	});
});

describe("LIBRARY_TYPE_CHIPS covers every workflow.type", () => {
	it("has a chip definition for each enum value", () => {
		for (const t of ALL_WORKFLOW_TYPES) {
			expect(LIBRARY_TYPE_CHIPS[t]).toBeDefined();
			expect(LIBRARY_TYPE_CHIPS[t].label.length).toBeGreaterThan(0);
			expect(LIBRARY_TYPE_CHIPS[t].className.length).toBeGreaterThan(0);
		}
	});
});

describe("filterRowsByTab", () => {
	const rows: Array<Pick<WorkflowListRow, "id" | "type">> = [
		{ id: "p1", type: "procedure" },
		{ id: "p2", type: "procedure" },
		{ id: "d1", type: "document" },
		{ id: "pol1", type: "policy" },
		{ id: "f1", type: "form" },
	];

	it("All returns the full list unchanged", () => {
		expect(filterRowsByTab(rows, "all")).toEqual(rows);
	});

	it("Workflows includes procedure only", () => {
		expect(filterRowsByTab(rows, "workflows").map((r) => r.id)).toEqual([
			"p1",
			"p2",
		]);
	});

	it("SOPs includes document AND policy (the spec's collapse rule)", () => {
		expect(filterRowsByTab(rows, "sops").map((r) => r.id)).toEqual([
			"d1",
			"pol1",
		]);
	});

	it("Forms includes form only", () => {
		expect(filterRowsByTab(rows, "forms").map((r) => r.id)).toEqual(["f1"]);
	});
});
