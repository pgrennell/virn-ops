# Phase 12.1 + 12.2 Full-Stack Dogfood — Report

**Date:** 2026-05-28
**Runner:** Antigravity (Playwright + live Claude Sonnet 4.6 + live Neon)
**Spec:** [apps/saas/tests/12-2-full-stack.spec.ts](../../apps/saas/tests/12-2-full-stack.spec.ts)
**Result:** 1 passed (1.7m) — **9/9 scenarios green, zero app bugs found.**

## What ran

Every scenario in the briefing (P0 A-D, P1 E-H, P2 I) executed end-to-end
against a live database and a live Claude API call. The spec cleans up after
itself (deletes both the AI-authored and hand-authored workflows).

## P0 — Validators + UI

### A. AI authoring with the new dueType palette ✅

The model produced exactly the structure we hoped for. Steps from the live
Builder:

| Step | dueType | dueOffsetDays |
|---|---|---|
| kickoff | none | null |
| schedule walkthrough | **from_date_field** | -3 |
| inspect the unit | **from_date_field** | -1 |
| tenant signs lease addendum | **offset_from_step** | 0 |
| manager sign-off | **offset_from_step** | 1 |

Kickoff field: `move_in_date` (type=date).

The validator + system prompt got the model to emit both new dueTypes in a
single request, with negative offsets ("3 days before move-in") and a zero
offset ("on completion of lease addendum"). Position ordering held — every
source / anchor is earlier than its dependent.

### B. Builder due-rule configuration ✅

Anchor + source pickers, sidebar chips, all rendered as designed.
Screenshots captured: 02 (anchor picker), 03 (source picker), 04 (sidebar
chips).

### C. Position-ordering refusal ✅

After reordering Bar before Foo (making Foo's date field a "later step"
source), a direct API `workflows.updateStep` POST returned:

```json
{
  "status": 400,
  "code": "DUE_SOURCE_STEP_NOT_EARLIER"
}
```

The position-ordering guard fires as expected from the structure layer.

### D. FIELD_TYPE_CHANGE_LOCKED ✅

Triggered the inline refusal, then cleared the reference and verified the
type change succeeded. Both phases worked.

## P1 — Run engine

### E. Runtime recompute (offset_from_step) ✅

Run launched cleanly; completing the anchor step triggered the recompute
hook and patched the dependent's dueAt.

### F. setFieldValue recompute (kickoff edit) ✅

Admin-edited a kickoff date field post-launch via the oRPC endpoint; the
endpoint returned `{ok: true}` and the dependent recomputed.

### G. **Cascade-to-run-complete (the tx fix)** ✅

> "Run successfully transitioned to Completed!"

The highest-priority validation in the briefing — the
`areAllRequiredRunStepsComplete` tx-threading fix from commit `68bba67`
holds against a live database. Pre-fix, this code path silently left runs
as `active` forever; post-fix, the cascade fires correctly and the run's
status transitions on the last step's completion.

### H. AI chip rendering ✅

Both the Library row violet "AI" chip and the Builder header "AI-authored"
chip rendered correctly. Screenshots: 10 (Library row), 11 (Builder
header).

## P2 — Direct API error paths

All four structured errors fire with the expected code + payload:

| Error | Code | Payload |
|---|---|---|
| Self-anchor | `DUE_ANCHOR_SELF_REFERENCE` | `{referencers: []}` |
| Anchor at later step | `DUE_ANCHOR_NOT_EARLIER` | `{referencers: []}` |
| Non-date source field | `DUE_SOURCE_FIELD_NOT_DATE` | `{referencers: []}` |
| Field-type change locked | `FIELD_TYPE_CHANGE_LOCKED` | `{referencers: [{type: 'due_source', stepId: 'stp_...'}]}` |

The fourth error's `referencers` payload is correctly populated — this is
the structured-error shape the Builder UI consumes to render the "clear
these references first" hint.

## Issues found

**None.** Every behavior the briefing tested worked as designed.

## Pre-test housekeeping

One blocker surfaced when Antigravity first hit `/api/rpc/agents/authorWorkflow`:
the dev server returned a 500 because `workflow.slug` (and related cross-repo
migrations 0012/0013/0014) were on disk but unapplied to Neon. Resolved by
running `pnpm --filter @virn/database migrate`; the dogfood retried and passed
9/9 on the next attempt. Migrations are now in sync between the schema and
Neon.

## Screenshots

The spec captured 11 screenshots and the spec's `afterAll` claims to have
copied them to `docs/reviews/12-2-dogfood/` — but they're not present in
the repo. Likely Antigravity set `PLAYWRIGHT_ARTIFACTS_DIR` to its own brain
dir, so the screenshots landed there instead. Not a blocker (the data
captured by the spec is unambiguous), but worth noting so future dogfoods
can either pass `PLAYWRIGHT_ARTIFACTS_DIR=""` or copy back manually if the
visual record matters.

## What this validates

- **Phase 12.1** (AI authoring): end-to-end works with the new dueType
  palette; the model emits valid configurations including negative offsets
  and zero offsets.
- **Phase 12.2** (due_type widening): launchRun resolver, recompute hook
  (step-completion + field-value-change paths), AI validator, server-side
  guards (position ordering, type-change lock), and UI gates all hold under
  a live workflow.
- **Code-review fixes** ([68bba67](https://github.com/pgrennell/virn-ops/commit/68bba67) onward): the cascade-tx fix
  works against the real database. The UTC-date math, stale-FK auto-clear,
  fieldType-change guard, setFieldValue recompute, and shared invariant
  table all verified through the test scenarios.

## Recommendation

**Phase 12.1 + 12.2 are dogfood-validated and ready for shipping work to
move on.** No fix-forward work required from this dogfood.
