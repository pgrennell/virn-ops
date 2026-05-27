// apps/saas/modules/library/lib/library-row-action.ts
//
// Pure row-action resolver -- the load-bearing correctness piece of UX_SPEC §4.2.
// Maps a workflow's real state (hasDraft, latestPublishedVersionNumber, isActive,
// type) + the caller's permissions (isAdminOrOwner, canRun) to a discriminated-union
// row-action descriptor. The Library row component is then a thin painter of the
// descriptor; the test asserts the matrix directly without React render.
//
// Why a pure function:
//   - Catches the "Run on a workflow with no published version" regression directly
//     (the integrity rule from the prompt).
//   - Future row-state additions extend the union -- TypeScript surfaces every
//     consumer that needs to handle the new variant.
//   - Decouples row-painting from gating; UI changes don't risk drifting the rule.
//
// `deletedAt` is intentionally absent: workflows.list filters archived rows out by
// default and the payload doesn't surface deletedAt at all today. Adding an
// `archived` branch here would be dead code; flagged for Pass 2+ when Library
// surfaces archived state.

/** Re-export of the @virn/database WorkflowListRow shape, narrowed for the resolver.
 * Trimmed to just the fields the resolver reads so future payload extensions don't
 * require resolver changes. */
export interface WorkflowListRow {
	id: string;
	type: "procedure" | "document" | "policy" | "form";
	title: string;
	description: string | null;
	isActive: boolean;
	createdAt: Date | string;
	updatedAt: Date | string;
	hasDraft: boolean;
	latestPublishedVersionNumber: number | null;
	latestPublishedAt: Date | string | null;
}

export interface RowPermissions {
	/** True when the caller is admin/owner of the active org. Gates Continue editing
	 * + (Pass 2+) Archive. Already threaded from assertCanSee's snapshot. */
	isAdminOrOwner: boolean;
	/** True when the caller has Runs permission. Derived from canSee(NAV_AREAS.runs,
	 * snapshot) at the page level. Today every preset role that sees Library also has
	 * Runs access -- but the custom-role layer (ADR-004) is reserved, and the resolver
	 * being permission-aware now is a one-line wiring change later instead of a
	 * matrix-rewrite. */
	canRun: boolean;
}

export type LibraryRowAction =
	| {
			kind: "run";
			/** When a published-and-draft row exists, the kebab/secondary surface offers
			 * "Continue editing" routed through workflows.editPublished (D-018 resume-
			 * or-fork). Members never see it. */
			secondary: "continue-edit" | null;
	  }
	| {
			kind: "run-disabled";
			reason: "inactive";
			secondary: "continue-edit" | null;
	  }
	| {
			kind: "open";
			secondary: "continue-edit" | null;
	  }
	| { kind: "continue-edit" }
	| {
			kind: "none";
			reason:
				| "draft-only-for-member"
				| "no-run-permission"
				| "inactive-no-published";
	  };

const EXECUTABLE_TYPES: ReadonlySet<WorkflowListRow["type"]> = new Set([
	"procedure",
	"form",
]);

/** Resolve the row action for a workflow + caller permissions.
 *
 * Decision matrix (UX_SPEC §4.2 + integrity #1 of the Library prompt):
 *
 *   draft-only (no published version yet)
 *     admin -> { kind: "continue-edit" }
 *     member -> { kind: "none", reason: "draft-only-for-member" }
 *
 *   published, executable type (procedure / form)
 *     active  + canRun  -> { kind: "run", secondary: hasDraft && admin ? "continue-edit" : null }
 *     active  + !canRun -> { kind: "none", reason: "no-run-permission" }
 *     inactive (any canRun) -> { kind: "run-disabled", reason: "inactive", secondary: ... }
 *
 *   published, document / policy
 *     -> { kind: "open", secondary: hasDraft && admin ? "continue-edit" : null }
 *
 * isActive=false on a doc/policy is intentionally NOT a disabled-open. The
 * `Inactive` pill still paints (it's a separate concern, rendered by the row
 * component), but reading inactive SOP content remains useful. Inactivation
 * blocks new RUNS, not READS.
 */
export function resolveLibraryRowAction(
	row: WorkflowListRow,
	perms: RowPermissions,
): LibraryRowAction {
	const isExecutable = EXECUTABLE_TYPES.has(row.type);
	const isPublished = row.latestPublishedVersionNumber !== null;
	const showSecondary: "continue-edit" | null =
		row.hasDraft && perms.isAdminOrOwner ? "continue-edit" : null;

	// 1. Draft-only path -- never published.
	if (!isPublished) {
		return perms.isAdminOrOwner
			? { kind: "continue-edit" }
			: { kind: "none", reason: "draft-only-for-member" };
	}

	// 2. Published doc/policy -- Open is always available (inactive doesn't block reads).
	if (!isExecutable) {
		return { kind: "open", secondary: showSecondary };
	}

	// 3. Published executable -- isActive gates Run, then canRun gates further.
	if (!row.isActive) {
		// Inactive published executable: show Run disabled with a tooltip. We do NOT
		// fall through to no-run-permission here because the inactive reason is the
		// stronger one for the user to see.
		return { kind: "run-disabled", reason: "inactive", secondary: showSecondary };
	}

	if (!perms.canRun) {
		return { kind: "none", reason: "no-run-permission" };
	}

	return { kind: "run", secondary: showSecondary };
}

// ---------------------------------------------------------------------------
// Status pill copy -- derived from the same state the resolver reads. Lives here so
// the row component + the empty state / future search-result list use one source.
// ---------------------------------------------------------------------------

export interface StatusPill {
	label: string;
	tone: "published" | "draft" | "draft-only";
}

export function deriveStatusPill(row: WorkflowListRow): StatusPill | null {
	const pubV = row.latestPublishedVersionNumber;
	if (pubV !== null && row.hasDraft) {
		// Draft is, by convention, the next version (Pass 1 fork-or-resume returns
		// `versionNumber + 1`). We don't have the draft's actual versionNumber in the
		// list payload, so we infer N+1 -- the only way it could be wrong is if the
		// draft was created before publish in the source DB, which the publish path
		// makes impossible (createWorkflow + editPublished both produce a version
		// strictly greater than the latest published).
		return {
			label: `Published v${pubV} · Draft v${pubV + 1}`,
			tone: "draft",
		};
	}
	if (pubV !== null) {
		return { label: `Published v${pubV}`, tone: "published" };
	}
	if (row.hasDraft) {
		// Draft-only: no published predecessor. v1 is the only draft this can be.
		return { label: "Draft v1", tone: "draft-only" };
	}
	return null; // No versions at all -- shouldn't happen post-create, defensive.
}
