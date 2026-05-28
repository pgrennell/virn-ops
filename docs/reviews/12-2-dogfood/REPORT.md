# Phase 12.1 + 12.2 Full-Stack Dogfood — Report (revised)

**Date:** 2026-05-28
**Runner:** Antigravity (Playwright + live Claude Sonnet 4.6 + live Neon)
**Spec:** [apps/saas/tests/12-2-full-stack.spec.ts](../../apps/saas/tests/12-2-full-stack.spec.ts)
**Result:** 1 passed (1.7m). Headline: the load-bearing correctness fixes work
against the live database. Caveat: several briefing requirements weren't
programmatically asserted (only screenshotted), so the headline overstates
coverage — see "Coverage gaps" below.

## Programmatic assertions that fired and passed

These are the parts where the spec did `expect(...).toBe(...)` against real
behavior, not just `screenshot(...)`.

### Run engine (most important)

- **P1-E — `from_date_field` at launch (kickoff source).** Step C's deadline
  displayed as "due Jun 10" when launched with `arrival_date = 2026-06-11`.
  Verifies launch-time resolution against a kickoff date field.
- **P1-E — `offset_from_step` recompute on anchor completion.** After
  completing Step A, Step B's deadline appeared as "due May 30" (today + 2).
  Verifies the step-completion recompute hook patches dueAt for
  `offset_from_step` dependents.
- **P1-F — `setFieldValue` recompute on kickoff edit.** After PATCHing
  `arrival_date` to `2026-06-18` via the oRPC endpoint, Step C's deadline
  updated to "due Jun 17". Verifies the setRunFieldValue → recompute hook
  the code review surfaced as missing.
- **P1-G — cascade-to-run-complete.** After completing all 3 required steps,
  the visible "Completed" status badge appeared. Verifies the
  `areAllRequiredRunStepsComplete` tx-threading fix from [68bba67](https://github.com/pgrennell/queen-virn-ops/commit/68bba67)
  against a real pg pool. **This is the load-bearing validation in the
  briefing.**

### Builder UI behavior

- **P0-B — sidebar chip text correctness.** Asserted exact strings for
  `offset_from_step` ("due 2d after Step A"), `from_date_field` with
  negative offset ("due 1d before {{arrival_date}}"), `offset_from_start`
  after dueType switch ("due 2d after launch"), incomplete-config state
  ("due rule incomplete" after switching dueType clears stale companions),
  and zero-offset ("due on Step A"). Confirms `formatDueRule` formatter +
  normalize-duePatch + UI seed values are all aligned.
- **P0-B — empty-input-clears-to-zero.** Selected the offset input,
  pressed `Backspace`, blurred; expected value to be "0". The
  empty-string → 0 fix from commit `fca0d94` works.
- **P0-D — FIELD_TYPE_CHANGE_LOCKED inline UI.** Asserted that the Alert
  reads "Type change refused -- clear these references first: step
  due-rule" when changing type on a referenced date field, and that the
  Alert hides after clearing the reference.

### AI authoring

- **P0-A — AI emitted both new dueTypes.** Asserted at least one
  `from_date_field` step with `dueOffsetDays < 0` AND at least one
  `offset_from_step` step exist in the AI-generated workflow. Kickoff date
  field exists.

### Structured error codes (P2-I)

All four error codes came back with the expected shape:
- `DUE_ANCHOR_SELF_REFERENCE`
- `DUE_ANCHOR_NOT_EARLIER`
- `DUE_SOURCE_FIELD_NOT_DATE`
- `FIELD_TYPE_CHANGE_LOCKED` (with the referencers array populated:
  `[{type: 'due_source', stepId: 'stp_...'}]`)

### Position-ordering server guard

- **P0-C — DUE_SOURCE_STEP_NOT_EARLIER.** After drag-reordering Bar before
  Foo, a direct PATCH that tries to source Bar's deadline from Foo's date
  field returned `DUE_SOURCE_STEP_NOT_EARLIER`. Confirms the structure-layer
  position-ordering check (commit `d562f70`) fires from the live API.

### Chips

- **P1-H — visible "AI" chip on Library row** for the AI-authored workflow.
- **P1-H — visible "AI-authored" chip in Builder header** when opening the
  AI workflow.

## Coverage gaps (briefing requirements not programmatically verified)

These items were in the briefing but the spec only screenshotted them — no
`expect(...)` assertion against the picker contents.

1. **Anchor picker filtering** (P0-B). Briefing: "The anchor dropdown should
   show only Step A (NOT Step B or Step C)." Spec opens the dropdown and
   picks Step A, but doesn't assert the dropdown options list. A regression
   where the picker showed all steps would have passed this test.

2. **Source-field picker filtering** (P0-A, P0-B). Same shape — the spec
   picks the right option but doesn't enumerate dropdown options. A
   regression that showed later-step or same-step date fields wouldn't have
   been caught.

3. **AI workflow position ordering** (P0-A). Briefing asked to verify all
   AI-generated sources/anchors are at earlier positions than their
   dependents. Spec only asserts dueType counts + negative-offset existence;
   doesn't walk the position graph.

4. **AI workflow sidebar chip accuracy** (P0-A). Briefing's example chip
   text ("due 1d before {{move_in_date}}") wasn't asserted for the
   AI-generated workflow — only for the hand-authored one in P0-B.

5. **Post-reorder picker stale state** (P0-C). Briefing: "After reorder,
   open Bar's config panel. The source picker should now show the field as
   a stale/unavailable option." Spec screenshots the picker but doesn't
   assert what it shows.

6. **Update-during-stale-state side effects** (P0-C). Briefing asked to try
   making any other change on Bar (e.g., toggle required) after the reorder
   to see if anything re-validates. Not exercised.

7. **Screenshots not in the repo.** The spec's afterAll claims to have
   copied 11 screenshots to `docs/reviews/12-2-dogfood/` but they're not
   present. Antigravity likely set `PLAYWRIGHT_ARTIFACTS_DIR` to its own
   brain dir, so they landed there. No way to visually re-verify from the
   committed artifacts.

## Anomaly worth investigating

**P2-I uses IDs of deleted steps.** The spec deletes Foo and Bar at line
392 (`db.delete(step).where(or(eq(step.id, fooStep.id), eq(step.id,
barStep.id)))`) BEFORE publishing the workflow. Then in P2-I it PATCHes
`/api/rpc/workflows/steps/<barStep.id>` four times and asserts that each
returns a specific dueRule-related error code (`DUE_ANCHOR_SELF_REFERENCE`,
etc.).

For the API to reach the dueRule validation, `assertStepEditable(barStep.id)`
must resolve to a row. If Bar was actually deleted, that lookup would throw
`STEP_NOT_FOUND` and the test would fail with the wrong error code.

The test PASSED, which means either:
- (a) The cleanup didn't actually execute (the `db.delete` matched zero rows
  somehow);
- (b) Bar still exists in the DB at P2-I time for some reason I'm not
  seeing;
- (c) The error format I'm reading isn't from `assertStepEditable` and the
  real codepath bypasses it.

I haven't been able to determine which. The structured error codes still
match what the briefing asked for, so the test's pass is honest in terms of
"the right error came back for the right shape of bad input." But it may
not be the same codepath we'd hit with a fresh, live workflow draft. Worth
re-running with explicit logging in `assertStepEditable` to confirm.

## Pre-test housekeeping

When Antigravity first hit `/api/rpc/agents/authorWorkflow`, the dev server
returned 500: `column "slug" of relation "workflow" does not exist`.
Cross-repo migrations 0012/0013/0014 (`workflow.slug` + `run.callback_*` +
`outbound_webhook_credential`) were on disk but unapplied to Neon. Resolved
by running `pnpm --filter @virn/database migrate`. The dogfood retried and
passed on the next attempt. Migrations are now in sync with the schema.

## What this validates

Strong claims:
- The cascade-tx fix works against the live database.
- The two recompute paths (step-completion + setFieldValue) both fire and
  patch dueAt correctly with the right values.
- The shared invariant table + position-ordering guard return the right
  structured error codes.
- The sidebar chip formatter handles all dueTypes + edge cases (zero,
  negative, incomplete-config) correctly.

Weaker claims (only screenshotted, not asserted):
- Anchor/source picker filtering by position.
- Position ordering of AI-generated workflows.
- Post-reorder UI behavior.

Unverified:
- Whether P2-I's structured errors fire for the codepath we think they do
  (the deleted-IDs anomaly).

## Recommendation

The major correctness fixes from the code review are dogfood-verified. The
spec is a useful regression net for those.

**Before declaring Phase 12.1 + 12.2 fully validated**, consider:
1. Add picker-content assertions in P0-A and P0-B (3 lines per picker:
   `expect(dropdown options).toEqual([...])`).
2. Walk the AI workflow's step graph in P0-A to assert position ordering.
3. Resolve the P2-I deleted-IDs anomaly — either by structuring the test
   to use a fresh draft workflow, or by adding instrumentation to
   `assertStepEditable` to confirm which codepath runs.

These are tightening items, not new bugs. Nothing in this dogfood surfaced
an actual app bug.
