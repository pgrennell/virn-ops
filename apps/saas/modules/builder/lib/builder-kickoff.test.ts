// builder-kickoff.test.ts
//
// Structural source assertions for the Builder kickoff-form rail (UX_SPEC §4.3:
// "kickoff form + sections + steps" as three peers). The Launcher walk on
// 2026-05-27 surfaced that the Builder had no UI for kickoff fields; Antigravity
// had to write field.stepId = null directly to the DB to set up the walk. This
// pass adds the rail entry + center editor + state plumbing; these asserts catch
// regressions that would re-introduce the gap.
//
// What's load-bearing:
//   1. The rail entry exists (KickoffRailEntry) and is rendered in AuthorBody
//      ABOVE RunStepList. Removing it would re-introduce the original gap.
//   2. Selecting kickoff sets stepId to null on createField calls (kickoff
//      fields = field.stepId IS NULL per the schema's convention).
//   3. The kickoff state is mutually exclusive with activeStepId (selecting one
//      clears the other) -- the canvas has one active editor target.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const VIEW_PATH = path.resolve(
	import.meta.dirname,
	"..",
	"components",
	"BuilderView.tsx",
);
const PANEL_PATH = path.resolve(
	import.meta.dirname,
	"..",
	"components",
	"KickoffPanel.tsx",
);
const RAIL_PATH = path.resolve(
	import.meta.dirname,
	"..",
	"components",
	"KickoffRailEntry.tsx",
);

describe("Builder kickoff rail -- the Launcher-walk gap is closed", () => {
	const viewSrc = readFileSync(VIEW_PATH, "utf8");

	it("BuilderView holds a kickoffActive state separate from activeStepId", () => {
		// Mutually-exclusive selection state. Without this, the canvas can't swap
		// the center editor between step and kickoff.
		expect(viewSrc).toMatch(/const\s+\[kickoffActive,\s*setKickoffActive\]\s*=\s*useState\(false\)/);
	});

	it("computes kickoffFields = bundle.fields.filter(stepId === null)", () => {
		// Kickoff fields are defined by field.stepId IS NULL in the schema; the
		// Launcher reads them via the same filter at runtime. Builder must use
		// the same predicate or the rail count drifts from what the Launcher shows.
		expect(viewSrc).toMatch(/const\s+kickoffFields\s*=\s*bundle\.fields\.filter\(\(f\)\s*=>\s*f\.stepId\s*===\s*null\)/);
	});

	it("AuthorBody renders KickoffRailEntry above RunStepList in the rail", () => {
		// Spec puts kickoff first in the rail (UX_SPEC §4.3). Order matters --
		// scanning the file for KickoffRailEntry appearing BEFORE RunStepList
		// inside the AuthorBody render confirms the rail composition.
		const railIdx = viewSrc.indexOf("<KickoffRailEntry");
		const listIdx = viewSrc.indexOf("<RunStepList");
		expect(railIdx, "KickoffRailEntry must be rendered").toBeGreaterThan(-1);
		expect(listIdx, "RunStepList must be rendered").toBeGreaterThan(-1);
		expect(railIdx, "KickoffRailEntry must come before RunStepList").toBeLessThan(listIdx);
	});

	it("KickoffPanel's onAddField calls createField with stepId: null (NOT a step id)", () => {
		// The whole point of this pass: the "+ Add kickoff field" affordance must
		// create field rows with stepId=null. A regression that wired stepId to
		// activeStepId (or some other step id) would silently create per-step
		// fields under the kickoff UI -- the exact failure mode this pass closes.
		// Scan the AuthorBody's KickoffPanel render block.
		const panelRenderMatch = viewSrc.match(
			/<KickoffPanel[\s\S]*?onAddField=\{[\s\S]*?createField\.mutate\(\s*\{([\s\S]*?)\}/,
		);
		expect(panelRenderMatch, "KickoffPanel render with onAddField must exist").not.toBeNull();
		const addFieldArgs = panelRenderMatch![1];
		expect(addFieldArgs).toMatch(/stepId:\s*null/);
	});

	it("selecting kickoff clears activeStepId, and vice versa (mutually exclusive)", () => {
		// The canvas's single-active-target invariant. If onSelectKickoff stops
		// clearing activeStepId, the center swap logic ambiguates and the wrong
		// editor can paint.
		expect(viewSrc).toMatch(/onSelectKickoff=\{\(\)\s*=>\s*\{[\s\S]*?setKickoffActive\(true\)[\s\S]*?setActiveStepId\(null\)/);
		expect(viewSrc).toMatch(/onSelectStep=\{\(id\)\s*=>\s*\{[\s\S]*?setActiveStepId\(id\)[\s\S]*?setKickoffActive\(false\)/);
	});

	it("center editor swaps to KickoffPanel when kickoffActive is true", () => {
		// Order matters: kickoffActive must be checked FIRST in the render
		// conditional so it wins over an existing activeStep (since activeStepId
		// is null when kickoff is active anyway, but the guard makes intent
		// explicit + safe).
		expect(viewSrc).toMatch(/\{kickoffActive\s*\?\s*\(\s*<KickoffPanel/);
	});
});

describe("KickoffPanel -- the center editor for kickoff fields", () => {
	const panelSrc = readFileSync(PANEL_PATH, "utf8");

	it("renders only field-shaped affordances (no step-level controls)", () => {
		// Kickoff isn't a step. The panel must NOT render "Configure step",
		// "Delete step", a step-type picker, a due-rule picker, or an assignee
		// role picker. If any of those leak in, the UI would imply kickoff has
		// step semantics it doesn't.
		expect(panelSrc).not.toMatch(/Configure step/);
		expect(panelSrc).not.toMatch(/Delete step/);
		expect(panelSrc).not.toMatch(/dueType/);
		expect(panelSrc).not.toMatch(/assignedRoleId/);
		expect(panelSrc).not.toMatch(/stepType/);
	});

	it("exposes an onAddField callback typed for kickoff (no step id required)", () => {
		// The panel's prop signature must accept a parameterless onAddField --
		// the kickoff target is implicit (stepId: null). Step-field add takes
		// no args either, but the difference is the parent's wiring: KickoffPanel
		// is wired to a parent that passes stepId: null.
		expect(panelSrc).toMatch(/onAddField:\s*\(\)\s*=>\s*void/);
	});
});

describe("KickoffRailEntry -- the left-rail entry above sections + steps", () => {
	const railSrc = readFileSync(RAIL_PATH, "utf8");

	it("accepts an active flag (so the rail entry highlights when selected)", () => {
		expect(railSrc).toMatch(/active:\s*boolean/);
	});

	it("accepts a kickoffFieldCount for the badge", () => {
		// The count badge ("3" next to "Kickoff form") gives the author visible
		// confirmation that the form has fields and how many. A zero state
		// renders a +Plus icon instead of a count to invite the first add.
		expect(railSrc).toMatch(/kickoffFieldCount:\s*number/);
	});
});
