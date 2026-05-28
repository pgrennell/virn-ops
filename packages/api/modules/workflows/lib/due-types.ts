// packages/api/modules/workflows/lib/due-types.ts
//
// Single source of truth for dueType invariants. Pre-fix, three layers each
// encoded their own copy of "which companion fields a given dueType uses":
//
//   - structure.ts (assertDueRefs at the API layer)
//   - ai-authoring/schema.ts (assertAuthoredWorkflowReferences validator)
//   - StepConfigForm.tsx (UI input visibility + value seeding)
//
// Now all three read from DUE_TYPE_INVARIANTS below. Adding a fifth dueType
// becomes a single-row edit to this table plus the per-layer special checks
// (cross-version anchor validation, position-ordering, etc.) that don't
// generalize.

/** The launchRun-resolvable due types. Mirrors the DB enum's subset that the
 * resolver + recompute hook handle today; ai-authoring/schema.ts re-exports
 * this as `AI_ALLOWED_DUE_TYPES` for backwards compatibility. */
export type DueType =
	| "none"
	| "offset_from_start"
	| "offset_from_step"
	| "from_date_field";

/** Companion fields a step row can carry alongside dueType. Keys mirror both the
 * AI authoring shape (dueOffsetDays + dueAnchorStepIndex + dueSourceFieldKey)
 * and the API/DB shape (dueOffsetDays + dueAnchorStepId + dueSourceFieldId);
 * the AUTHORING/API layers map the abstract keys onto their own field names. */
export type DueCompanion = "offset" | "anchor" | "source";

export interface DueTypeInvariant {
	/** Companions that MUST be present when this dueType is selected. */
	requires: ReadonlySet<DueCompanion>;
	/** Companions that MUST NOT be present when this dueType is selected. The
	 * complement of `requires` over the full companion set; computed once at
	 * module load. */
	forbids: ReadonlySet<DueCompanion>;
}

const ALL_COMPANIONS: ReadonlySet<DueCompanion> = new Set<DueCompanion>([
	"offset",
	"anchor",
	"source",
]);

function complement(used: ReadonlySet<DueCompanion>): ReadonlySet<DueCompanion> {
	const out = new Set<DueCompanion>();
	for (const c of ALL_COMPANIONS) if (!used.has(c)) out.add(c);
	return out;
}

const NONE = new Set<DueCompanion>();
const REQ_OFFSET_ONLY = new Set<DueCompanion>(["offset"]);
const REQ_OFFSET_ANCHOR = new Set<DueCompanion>(["offset", "anchor"]);
const REQ_OFFSET_SOURCE = new Set<DueCompanion>(["offset", "source"]);

/** The shared table. Indexed by DueType. If a future value lands in the DB enum
 * but isn't wired through launchRun, it stays out of this table until it is. */
export const DUE_TYPE_INVARIANTS: Record<DueType, DueTypeInvariant> = {
	none: { requires: NONE, forbids: complement(NONE) },
	offset_from_start: {
		requires: REQ_OFFSET_ONLY,
		forbids: complement(REQ_OFFSET_ONLY),
	},
	offset_from_step: {
		requires: REQ_OFFSET_ANCHOR,
		forbids: complement(REQ_OFFSET_ANCHOR),
	},
	from_date_field: {
		requires: REQ_OFFSET_SOURCE,
		forbids: complement(REQ_OFFSET_SOURCE),
	},
};

/** Convenience: returns whether this dueType uses (requires) the given
 * companion. Used by structure.ts's normalizeDuePatch to decide which patch
 * fields to null on dueType narrow. */
export function dueTypeUsesCompanion(
	dueType: DueType,
	companion: DueCompanion,
): boolean {
	return DUE_TYPE_INVARIANTS[dueType].requires.has(companion);
}
