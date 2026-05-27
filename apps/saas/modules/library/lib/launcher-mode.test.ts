// launcher-mode.test.ts
//
// Structural source assertions for the Phase 8 step 3 launcher mode UI. These guard the
// load-bearing invariants surfaced in the plan turn:
//   1. The 3 mode cards exist (Human / AI-assisted / Automated)
//   2. The agent picker reads from orpc.agents.list (not some other surface)
//   3. The picker filters to isActive=true (so disabled agents can't be picked + then
//      rejected by the server's AGENT_INACTIVE)
//   4. The disabled-reason copy explains WHY a mode is off, not just that it's off
//      (UX_SPEC §2: never silently hide)
//   5. LauncherForm includes mode + agentId in the runs.launch payload
//   6. The submit Disable gate blocks submission when mode != human + no agent picked
//      (prevents an obvious MODE_REQUIRES_AGENT roundtrip)
//
// Same pattern as builder-kickoff.test.ts -- regex-asserting on source is the project's
// established way to lock UI structure without a DOM runtime.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const PICKER_PATH = path.resolve(
	import.meta.dirname,
	"..",
	"components",
	"LaunchModePicker.tsx",
);
const FORM_PATH = path.resolve(
	import.meta.dirname,
	"..",
	"components",
	"LauncherForm.tsx",
);

describe("LaunchModePicker -- the S-07 wedge UI", () => {
	const src = readFileSync(PICKER_PATH, "utf8");

	it("declares all three mode cards (human / ai_assisted / automated)", () => {
		// Card definitions sit in a MODE_CARDS array; assert each id is present.
		expect(src).toMatch(/id:\s*"human"/);
		expect(src).toMatch(/id:\s*"ai_assisted"/);
		expect(src).toMatch(/id:\s*"automated"/);
	});

	it("agent picker reads from orpc.agents.list (not a bespoke surface)", () => {
		expect(src).toMatch(/orpc\.agents\.list\.queryOptions/);
	});

	it("agent picker filters to isActive=true (disabled agents are excluded)", () => {
		// Server would otherwise reject the launch with AGENT_INACTIVE -- this client-side
		// filter prevents picking an agent that's guaranteed to fail.
		expect(src).toMatch(/filter\(\(a\)\s*=>\s*a\.isActive\)/);
	});

	it("ai_assisted disabled-reason mentions Settings → Agents when no agents exist", () => {
		expect(src).toMatch(/No active agents.*Settings\s*→\s*Agents/);
	});

	it("ai_assisted disabled-reason mentions AI-shaped steps when workflow has none", () => {
		expect(src).toMatch(/no AI-shaped steps/);
	});

	it("preview block shows the agent name + a numbered count of steps", () => {
		// The preview is the wedge UX -- "Turnover AI will handle 3 AI steps:" is the
		// at-a-glance confirmation before launching.
		expect(src).toMatch(/will handle/);
		expect(src).toMatch(/agentName/);
	});

	it("preview lists step titles (not just a count)", () => {
		// Showing the actual step titles is what makes the wedge concrete --
		// "Inspect rooms, Photo write-up" is more convincing than "3 steps".
		expect(src).toMatch(/handledSteps\.slice/);
		expect(src).toMatch(/s\.title/);
	});
});

describe("LauncherForm -- mode + agentId wiring (Phase 8 step 3)", () => {
	const src = readFileSync(FORM_PATH, "utf8");

	it("passes agentStepsEnabled to gate whether the mode picker renders", () => {
		// Gate at the page level; OFF -> no selector cards -> only human-mode behavior
		// (matches the pre-Pass-B form).
		expect(src).toMatch(/agentStepsEnabled\s*&&\s*\(\s*<LaunchModePicker/);
	});

	it("submit payload includes mode + agentId", () => {
		// Server defaults mode='human' for backward compat, but the form always sends
		// it explicitly so the wire payload is self-describing.
		expect(src).toMatch(/mode:\s*launchMode/);
		expect(src).toMatch(/agentId:\s*launchMode\s*===\s*"human"\s*\?\s*null\s*:\s*selectedAgentId/);
	});

	it("submit is DISABLED when mode != human but no agent picked (avoid MODE_REQUIRES_AGENT roundtrip)", () => {
		// Server would refuse the launch -- block on the client first.
		expect(src).toMatch(/modeNeedsAgent\s*=\s*launchMode\s*!==\s*"human"/);
		expect(src).toMatch(/missingAgent\s*=\s*modeNeedsAgent\s*&&\s*!selectedAgentId/);
		expect(src).toMatch(/submitDisabled[\s\S]{0,200}missingAgent/);
	});

	it("switching back to human clears the agent pick (avoids stale state)", () => {
		// Picking an agent under ai_assisted then flipping to human used to leave a
		// dead agentId in state; the on-change handler resets it on mode=human.
		expect(src).toMatch(/m\s*===\s*"human"[\s\S]*?setSelectedAgentId\(null\)/);
	});
});
