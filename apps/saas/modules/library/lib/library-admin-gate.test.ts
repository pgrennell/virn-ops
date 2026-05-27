// library-admin-gate.test.ts
//
// Structural source assertion (same pattern as the Builder's preview-callbacks test).
// The Pass-2.5 lesson, applied to Library: don't show buttons that bounce off the
// server. Caught regression would be (a) the page failing to destructure the snapshot,
// (b) Create rendering for non-admin members, or (c) the Run gate flag dropped from
// the resolver wiring.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const PAGE_PATH = path.resolve(
	import.meta.dirname,
	"..",
	"..",
	"..",
	"app",
	"(authenticated)",
	"(main)",
	"(organizations)",
	"[organizationSlug]",
	"library",
	"page.tsx",
);
const VIEW_PATH = path.resolve(import.meta.dirname, "..", "components", "LibraryView.tsx");
const EMPTY_PATH = path.resolve(
	import.meta.dirname,
	"..",
	"components",
	"LibraryEmptyState.tsx",
);

describe("Library page threads the gating snapshot honestly", () => {
	const pageSrc = readFileSync(PAGE_PATH, "utf8");

	it("destructures { snapshot } from assertCanSee (doesn't drop it like the original placeholder did)", () => {
		expect(pageSrc).toMatch(/const\s*\{\s*snapshot\s*\}\s*=\s*await\s+assertCanSee/);
	});

	it("passes BOTH isAdminOrOwner AND canRun to LibraryView", () => {
		// isAdminOrOwner comes straight from the snapshot. canRun is derived from
		// canSee(NAV_AREAS.runs, snapshot) so the resolver's permission contract
		// holds when the custom-role layer lands (today every preset role that
		// sees Library also has Runs access, so canRun = true for every reachable
		// caller -- but designed in now is cheaper than retrofit).
		expect(pageSrc).toMatch(/isAdminOrOwner={snapshot\.isAdminSuperset}/);
		expect(pageSrc).toMatch(/canRun={canSee\(NAV_AREAS\.runs,\s*snapshot\)}/);
	});
});

describe("LibraryView gates admin-only affordances on the isAdminOrOwner prop", () => {
	const viewSrc = readFileSync(VIEW_PATH, "utf8");

	it("CreateWorkflowMenu only renders when isAdminOrOwner is true", () => {
		// The trigger must be wrapped in an `isAdminOrOwner &&` guard somewhere
		// in the header. A regression that hoists it out (hardcoded visible)
		// would let members click Create and 403 against adminOrgProcedure.
		expect(viewSrc).toMatch(/isAdminOrOwner\s*&&\s*\(\s*<CreateWorkflowMenu/);
	});

	it("threads canRun + isAdminOrOwner into per-row permissions for the resolver", () => {
		// The row-action resolver takes both flags; LibraryView builds the perms
		// object from props and passes it down. If a future refactor drops either
		// flag, the resolver still compiles but silently degrades to all-permitted.
		expect(viewSrc).toMatch(
			/perms\s*=\s*useMemo\(\s*\(\)\s*=>\s*\(\s*\{\s*isAdminOrOwner,\s*canRun\s*\}/,
		);
	});
});

describe("LibraryEmptyState honors the admin gate on the Create CTA", () => {
	const emptySrc = readFileSync(EMPTY_PATH, "utf8");

	it("conditionally renders the Create button on isAdminOrOwner", () => {
		// Members on a fresh org see a "no workflows yet" message but no Create
		// button (the page is reachable by builders, but creating is admin-only
		// per adminOrgProcedure on workflows.create).
		expect(emptySrc).toMatch(/isAdminOrOwner\s*&&\s*\(/);
	});
});
