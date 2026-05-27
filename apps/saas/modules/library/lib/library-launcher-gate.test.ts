// library-launcher-gate.test.ts
//
// Structural source assertions for the Launcher pass. Two integrity rules are
// load-bearing here (Launcher plan integrity #1 + #2) and both are wired-not-
// rendered today (the runtime gate is the user's manual walk). These four asserts
// catch the regressions that would silently break the wiring:
//
//   1. LibraryRow's `run` action opens the launcher (not /runs route navigation)
//   2. LauncherForm loads getVersionBundle for latestPublishedVersionId
//      (NOT currentDraft.id; NOT workflow-resolved-server-side)
//   3. LauncherForm passes the pinned latestPublishedVersionId to runs.launch
//      (closes the publish-during-fill-window race; D-018)
//   4. LauncherForm's submit catches REQUIRED_KICKOFF_FIELD_MISSING and surfaces
//      the missing field keys inline (integrity #2 server-is-the-gate)

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROW_PATH = path.resolve(import.meta.dirname, "..", "components", "LibraryRow.tsx");
const FORM_PATH = path.resolve(import.meta.dirname, "..", "components", "LauncherForm.tsx");

describe("LibraryRow wires Run to the launcher, not the /runs route stub", () => {
	const src = readFileSync(ROW_PATH, "utf8");

	it("accepts an onOpenLauncher callback as a required prop", () => {
		expect(src).toMatch(/onOpenLauncher:\s*\(/);
	});

	it("handleRun calls onOpenLauncher with the pinned latestPublishedVersionId", () => {
		// The pinned version is what the form will render from AND submit with --
		// closes the publish-during-fill-window race. A regression that dropped
		// the version id (or passed the workflow id only) would break integrity #1.
		expect(src).toMatch(/onOpenLauncher\(\{[\s\S]*?latestPublishedVersionId:/);
	});

	it("handleRun does NOT navigate to /runs?launch= (the Pass 1 stub is dead)", () => {
		// Catch a regression that re-introduces the /runs?launch= router.push --
		// the launcher replaces it wholesale.
		expect(src).not.toMatch(/router\.push\(`?\/[^`]*\/runs\?launch=/);
	});
});

describe("LauncherForm loads + launches the SAME pinned version (integrity #1)", () => {
	const src = readFileSync(FORM_PATH, "utf8");

	it("loads getVersionBundle for workflow.latestPublishedVersionId, not currentDraft.id", () => {
		// The form's bundle query must read the pinned id off the prop. A regression
		// that switched to workflow.id (then server-resolved) would re-open the
		// publish-during-fill-window race.
		expect(src).toMatch(
			/getVersionBundle\.queryOptions\(\s*\{\s*input:\s*\{\s*versionId:\s*workflow\.latestPublishedVersionId/,
		);
		expect(src).not.toMatch(/currentDraft\.id/);
	});

	it("submit passes the same pinned versionId to runs.launch (form-version == launch-version)", () => {
		// Together with the assert above, this proves form-version and launch-version
		// are identical by construction -- not by two independent "latest published"
		// resolutions that could drift across the publish window.
		expect(src).toMatch(
			/workflowVersionId:\s*workflow\.latestPublishedVersionId/,
		);
	});

	it("catches REQUIRED_KICKOFF_FIELD_MISSING and surfaces the missing field keys inline", () => {
		// The server is the source of truth for required-field refusal (integrity #2);
		// the form catches the typed code, paints the inline per-field indicator, and
		// names the missing fields in the banner. A regression that swallowed the
		// refusal (e.g., a generic error handler) would silently degrade UX.
		expect(src).toMatch(/REQUIRED_KICKOFF_FIELD_MISSING/);
		expect(src).toMatch(/setServerMissingFieldKeys/);
		expect(src).toMatch(/missingFieldKeys/);
	});
});
