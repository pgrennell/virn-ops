// Workflows lib hardening -- the dueType single-source-of-truth table. due-types.ts
// is read by THREE layers (structure.ts assertDueRefs, ai-authoring/schema.ts,
// StepConfigForm.tsx) to decide which companion fields (offset / anchor / source) a
// dueType requires vs forbids. due-refs.test.ts covers the cross-step REFERENCE
// validation in structure.ts, not this table -- so the requires/forbids matrix and
// dueTypeUsesCompanion were unpinned. A typo here silently mis-gates a companion
// field across all three layers, so the invariant is worth locking down. (Pure file,
// no imports -> no mocks.)

import { describe, expect, it } from "vitest";

import { DUE_TYPE_INVARIANTS, dueTypeUsesCompanion, type DueCompanion, type DueType } from "./due-types";

const ALL_COMPANIONS: DueCompanion[] = ["offset", "anchor", "source"];

// The intended requires-set per dueType (the contract the three layers depend on).
const EXPECTED_REQUIRES: Record<DueType, DueCompanion[]> = {
	none: [],
	offset_from_start: ["offset"],
	offset_from_step: ["offset", "anchor"],
	from_date_field: ["offset", "source"],
};

describe("dueTypeUsesCompanion -- requires matrix", () => {
	const cases: Array<[DueType, DueCompanion, boolean]> = [];
	for (const dueType of Object.keys(EXPECTED_REQUIRES) as DueType[]) {
		for (const c of ALL_COMPANIONS) {
			cases.push([dueType, c, EXPECTED_REQUIRES[dueType].includes(c)]);
		}
	}

	it.each(cases)("%s uses %s companion = %s", (dueType, companion, expected) => {
		expect(dueTypeUsesCompanion(dueType, companion)).toBe(expected);
	});
});

describe("DUE_TYPE_INVARIANTS -- requires/forbids partition the companion set", () => {
	it.each(Object.keys(EXPECTED_REQUIRES) as DueType[])(
		"%s: forbids is the exact complement of requires",
		(dueType) => {
			const inv = DUE_TYPE_INVARIANTS[dueType];
			const requires = [...inv.requires].sort();
			const forbids = [...inv.forbids].sort();

			// requires matches the contract.
			expect(requires).toEqual([...EXPECTED_REQUIRES[dueType]].sort());

			// requires and forbids are disjoint.
			for (const c of inv.requires) expect(inv.forbids.has(c)).toBe(false);

			// requires ∪ forbids covers every companion (nothing falls through ungated).
			const union = new Set<DueCompanion>([...inv.requires, ...inv.forbids]);
			expect([...union].sort()).toEqual([...ALL_COMPANIONS].sort());
		},
	);

	it("none requires nothing and forbids all three companions", () => {
		expect([...DUE_TYPE_INVARIANTS.none.requires]).toEqual([]);
		expect([...DUE_TYPE_INVARIANTS.none.forbids].sort()).toEqual([...ALL_COMPANIONS].sort());
	});
});
