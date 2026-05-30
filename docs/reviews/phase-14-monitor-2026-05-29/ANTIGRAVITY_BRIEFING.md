# Antigravity Briefing — Phase 14 Lightweight Monitor

**Repo:** `c:\Projects\Virn\virn-ops`
**Branch:** `main` (HEAD at the latest commit; everything in scope is pushed)
**Date:** 2026-05-29

## What this is

Phase 14 (S-06, the Lightweight Monitor) shipped in one session as four slices —
A: generalized `runs.list` reader + SQL `EXISTS` subquery for blocked-step
detection; B: `/runs` org-level page replacing the prior `PlaceholderScreen`; D:
"Needs attention" view variant (overdue OR blocked-by-stop-task, computed in
SQL so the row count agrees with pagination); C: per-workflow Runs tab at
`/library/workflows/[workflowId]/runs`, sibling to Author/Read but explicitly
NOT a third segment of the view-switcher (PRD §1.2 / D-039 — three views of one
object stays clean).

All compiles, all unit tests green (650 across api+saas+auth), 7 new procedure
tests on `runs.list`. None of it has been exercised in a browser. The four
surfaces have meaningful failure modes that unit tests don't catch — empty
state copy, badge color/icon, URL-state hydration across refresh, the gating
threading (operators can see the Runs tab, builders can author + see runs,
members get nothing dishonest).

**The load-bearing scenario is B (Needs Attention bucket).** It's the only
filter where the SQL is non-trivial (the `EXISTS` subquery over
`step_dependency` + `run_step.status`). If that returns wrong rows — either
too few or too many — the "needs attention" view is misleading rather than
empty, and operators have no signal that the tab is broken.

## Goal

Validate that:

1. The org-level `/runs` page renders with all four tabs (All / Active / Needs
   Attention / Completed), the row table populates with seeded runs, status
   badges agree with the underlying state, and sort + pagination both work.
2. The Needs Attention tab correctly surfaces **overdue active runs** (run
   `dueAt < now`) AND **blocked active runs** (pending step has an incomplete
   stop-task dependency), with no false positives on Active runs that are
   neither overdue nor blocked.
3. The per-workflow `/library/workflows/[id]/runs` tab is reachable from both
   the Builder header AND the Read header, gates on `canSee(NAV_AREAS.runs)`
   (operators get it), and pre-scopes the row list to that workflow.
4. URL state (view / sort / page) hydrates from `?view=…&sort=…&page=…` and
   survives a hard refresh — shareable links work.
5. Permission honesty holds: a non-admin operator sees the Runs tab on
   `/library/workflows/[id]/runs` and on the Builder/Read headers, but no
   Author affordances they can't use.

## Prerequisites

### Dev server

The dev server reads its env from the **monorepo-root `.env.local`** (NOT
`apps/saas/.env.local`):

```bash
cd c:/Projects/Virn/virn-ops/apps/saas
pnpm exec dotenv -c -e ../../.env.local -- next dev --port 3000
```

Wait for "Local: http://localhost:3000" before navigating. If port 3000 is
already taken:

```bash
netstat -ano | grep ":3000" | grep LISTENING | awk '{print $5}' | xargs taskkill //F //PID
```

### Auth

Seeded admin: `pgrennell@gmail.com` in the org with slug `virn`. Magic-link
bypass pattern in `apps/saas/tests/dogfood-walkthrough.spec.ts` — copy that
approach exactly:

- Helper: `waitForVerificationForEmail` from `apps/saas/tests/__helpers/db.ts`
- Callback URL: `http://localhost:3000/api/auth/magic-link/verify?token={TOKEN}&callbackURL=http://localhost:3000/virn/runs`

### Seed data

The Needs Attention scenario (B) requires both an **overdue** active run and a
**blocked** active run. The seeded `virn` org from prior dogfooding should
already carry some active runs from STR Turnover seeds — but freshness varies.
Two reliable seeding paths:

1. **Easy path — backdate an existing run's `dueAt`:** pick any active run from
   the Active tab, note its id, and run:

   ```bash
   pnpm --filter @virn/database exec drizzle-kit studio
   ```

   Then in the `run` table, set `due_at = '2026-05-01 00:00:00'` for that
   id. Refresh `/virn/runs` and switch to Needs Attention — it should appear
   with an "Overdue" badge.

2. **Blocked path — uses an existing stop-task:** the STR Turnover seed
   workflow includes a stop-task gate on the final "mark ready" step
   (workflow id is queryable from `/virn/library/workflows`). Launch a new run
   of that workflow against any listing, then DO NOT complete the earlier
   steps. The run is blocked from completion by definition — every pending
   step beyond the stop-task is "blocked" by the stop-task's incomplete
   dependees. It should appear in Needs Attention with a "Blocked" badge.

If neither path is reachable (no STR runs, no stop-task in any seeded
workflow), report it and skip scenario B's blocked half — Overdue half alone
is still informative.

### Migrations

No new migrations land in Phase 14 (spec explicitly "no new schema"). The
prior cross-repo migrations should already be applied. Sanity-check with:

```bash
pnpm --filter @virn/database migrate
```

If anything migrates unexpectedly, note it in the report and re-confirm
scenarios.

## Test plan

Save artifacts under `docs/reviews/phase-14-monitor-2026-05-29/` and the spec
at `apps/saas/tests/phase-14-monitor-2026-05-29.spec.ts` following the
existing `getArtifactsDir` pattern.

Tag scenarios **P0 / P1 / P2** to prioritize when running out of time. All
P0 first; P1 if cycles remain; P2 is stretch. Sequential screenshot naming
`01-`, `02-`, ... across all scenarios.

---

### P0 — A. Org-level /runs renders + all four tabs work

**Scenario:** Confirm the `/runs` page replaces the placeholder, all four
tabs are reachable, and seeded runs appear in the right buckets.

1. Navigate to `http://localhost:3000/virn/runs`. Capture
   `01-runs-default-active.png` showing the table with the "Active" tab
   highlighted (default landing view).
2. Click each tab in order: **All**, **Needs attention**, **Completed**, then
   back to **Active**. Capture one screenshot per tab landing:
   `02-runs-all.png`, `03-runs-needs-attention.png`, `04-runs-completed.png`.
3. Pick a row in the Active tab and verify the status badge reads "Active"
   (or "Overdue"/"Blocked" — see scenario B). The badge background should
   match the semantic (info blue / error red / warning amber / success green).
4. Click a row's title link — should navigate to `/virn/runs/<runId>`. Back
   up to the index and confirm tab state persisted (still on Active).

**Capture:** `01-` through `04-` per step 2 above.

**Verify:**
- Page header reads "Runs" with a subtitle "Every run across the org. …"
- Sort selector (top-right) shows "Most recently started" by default.
- Active tab populates with rows OR shows the "No active runs across the
  org." empty state — neither is an error, just report which.
- Each row shows: Title (clickable link), workflow subtitle, status badge,
  Started (relative time), Due (relative time or "—"), Progress bar with
  "X/Y" count.
- Row hover → background tint changes (subtle).

**Report:**
- Per-tab row count (eyeball is fine).
- Any tab that produced a console error or visual glitch (paste verbatim).
- The default sort order — confirm rows are most-recently-started-first.

---

### P0 — B. Needs Attention bucket: overdue + blocked

**This is the load-bearing scenario for this briefing.** If the EXISTS
subquery for blocked-step detection returns the wrong rows, operators can't
trust the Needs Attention tab.

**Scenario:** Confirm Needs Attention shows both overdue runs AND
blocked-by-stop-task runs, with no false positives.

1. Use the "Easy path" from Seed data to backdate one active run's `due_at` to
   before today. Note its id and title.
2. Reload `/virn/runs`, click **Needs attention**. Capture `05-needs-attention-overdue.png`.
3. Verify the backdated run appears in the row list with an **"Overdue"
   badge** (red) and an `AlertTriangleIcon`.
4. Verify NO active-but-not-overdue runs from scenario A's list appear here
   (cross-reference the row ids). If any do, that's a false positive — note
   the row + the run's actual `due_at` value.
5. Use the "Blocked path" from Seed data — launch a fresh STR Turnover run
   without completing prerequisite steps. Reload Needs attention. Capture
   `06-needs-attention-blocked.png`.
6. Verify the new run appears with a **"Blocked" badge** (amber) and a
   `LockIcon`. The Overdue run from step 1 should still be there too.

**Capture:** `05-needs-attention-overdue.png`, `06-needs-attention-blocked.png`,
plus a `07-needs-attention-row-counts.txt` plain text note with eyeballed
counts per badge type.

**Verify:**
- Overdue badge: red treatment, "Overdue" text, `AlertTriangleIcon` prefix.
- Blocked badge: amber treatment, "Blocked" text, `LockIcon` prefix.
- The same run is NEVER both overdue AND blocked-badged at once (status cell
  picks one; the rule is overdue trumps blocked — that's intentional).
- Completed runs NEVER appear here.

**Report:**
- Confirmed overdue count + blocked count.
- Any run that appeared here but shouldn't have (false positive) — list its
  id + the actual reason it surfaced.
- Any run that SHOULD have appeared but didn't (false negative) — list its
  id + the seeding step you took.

---

### P0 — C. Per-workflow Runs tab from Builder + Read headers

**Scenario:** Confirm the new "Runs" pill is reachable from both Builder and
Read views of a workflow, and the destination is scoped to that workflow only.

1. Navigate to `/virn/library`, pick any workflow with at least one run
   (STR Turnover from prior seeding is a safe pick). Click into the
   Builder view.
2. Verify the workflow detail header shows: `[Author | Read]` segmented
   toggle (left), then a separate `Runs` pill (right). Capture
   `08-builder-header-with-runs-tab.png` — full header strip.
3. Click the `Runs` pill. URL should be
   `/virn/library/workflows/<id>/runs`. Capture `09-per-workflow-runs.png`.
4. Verify the row list is **scoped to this workflow only** — every row's
   workflow subtitle reads the same workflow title.
5. From `/library/workflows/<id>/runs`, the header should still show the
   `[Author | Read]` toggle (neither segment active — both are clickable)
   AND a "Runs" pill in the **active** treatment. Click "Read" — should
   navigate to `/read`; from there, click "Runs" again — back. Capture
   `10-read-header-with-runs-tab.png` of the Read header.

**Capture:** `08-` through `10-`.

**Verify:**
- Runs pill visible in Builder + Read + the Runs page itself.
- "Active" treatment on the Runs pill ONLY when on the `/runs` route.
- Row list strictly scoped — no foreign-workflow rows leak through.
- Page title and subtitle adapt: "Runs of this workflow" not "Runs" on the
  per-workflow page.

**Report:**
- Verdict per header (Builder, Read, Runs).
- Any visual misalignment between the segmented toggle and the Runs pill.
- Console errors on the new route (paste verbatim if any).

---

### P1 — D. URL state hydration across refresh

**Scenario:** Confirm `?view=…&sort=…&page=…` survives refresh and
shareable links land in the right state.

1. From `/virn/runs`, click **Completed** tab, change sort to "Recently
   completed". URL should update to include `?view=completed&sort=completed_desc`.
2. Hard-refresh the page (Ctrl+F5). Same tab + same sort should re-hydrate.
   Capture `11-url-state-after-refresh.png`.
3. Copy the URL, paste into a new tab. Same landing state. Capture
   `12-url-state-new-tab.png`.
4. If the row count exceeds 25, the pagination bar appears. Click "next"
   once. URL gains `&page=2`. Refresh — still on page 2.

**Capture:** `11-`, `12-`, plus `13-url-after-pagination.png` if pagination
was reachable.

**Verify:**
- View, sort, and page all hydrate from URL on refresh.
- Tab change resets page to 1 (the offset is meaningless when the filter
  shape moves under the user — by design).

**Report:**
- Pass/fail per state component.
- Any URL params silently dropped on refresh.

---

### P1 — E. Row click → run detail navigation

**Scenario:** Confirm row click reliably opens `/runs/<id>` without
intermediate redirects or broken routing.

1. From any tab on `/runs`, click any row's title.
2. Should land on `/virn/runs/<id>` (the existing Run view from Phase 7).
   Capture `14-run-detail-loaded.png`.
3. Click browser back. Should land back at `/runs` with the SAME tab + sort
   you came from (URL state intact).

**Verify:**
- Detail page loads, no 404 / 500.
- Back-button preserves filter state.

**Report:**
- Pass/fail.
- Any flicker on the back-nav (filter momentarily resets before re-hydrating).

---

### P2 — F. Empty states + non-admin permission honesty

**Scenario:** Confirm empty states render correctly and a non-admin member
sees the Runs surface honestly.

1. On `/virn/runs`, switch to the Completed tab. If empty, capture
   `15-completed-empty-state.png` and confirm the copy reads "No completed
   runs yet."
2. On `/library/workflows/<id>/runs` for a workflow with no runs, capture
   `16-per-workflow-empty.png`. Copy should read "No runs of this workflow
   yet."
3. (Stretch) If a non-admin test account is reachable, log in as that user
   and confirm:
   - `/virn/runs` is reachable.
   - The Builder header on a workflow detail page hides the `[Author | Read]`
     toggle (since they can't author) but still shows the Runs pill.
   - The Author route silently redirects to Read.

**Capture:** `15-`, `16-` per step 1 + 2. Step 3 only if reachable.

**Verify:**
- Empty-state copy matches the per-view variant (different copy for All /
  Active / Needs attention / Completed).
- No dishonest controls for non-admins.

**Report:**
- Empty-state copy verbatim per tab.
- Non-admin scenario: pass/fail if reachable, "skipped — no non-admin
  account available" if not.

---

## What to send back

A single markdown report at `docs/reviews/phase-14-monitor-2026-05-29/REPORT.md`
with:

- **Per-scenario verdict** (PASS / FAIL / PARTIAL) with the captured
  screenshots linked by filename.
- **The P0 — B verdict is load-bearing.** If the EXISTS subquery returns
  wrong rows (false positives or false negatives), report immediately with
  the run id(s) + the actual underlying state from the DB so the SQL can be
  patched before this lands in dogfood.
- **Any console errors** observed (paste verbatim, including stack).
- **Specific reproductions** for anything that didn't behave as described.
- **"Recommend amend"** markers on anything cheaper to patch than to fully
  verify — empty-state copy tweaks, badge color drift, etc.

The relevant HEAD commits to cite findings against:

- `5baf0a3` feat(runs,saas): Phase 14 — Lightweight Monitor (S-06). Single
  commit covers the runs.list procedure + EXISTS subquery for blocked
  detection AND the /runs page + RunsMonitorView + per-workflow Runs tab.

---

## Kickoff prompt (paste this to Antigravity)

```
I need browser-driven verification of Phase 14 (the Lightweight Monitor —
/runs org page + per-workflow Runs tab + Needs Attention bucket). The
full self-contained briefing is at:

  c:\Projects\Virn\virn-ops\docs\reviews\phase-14-monitor-2026-05-29\ANTIGRAVITY_BRIEFING.md

Read it first — it has prerequisites (dev server, magic-link auth, seeded
overdue/blocked runs), tagged scenarios (P0/P1/P2), capture targets, and
per-scenario reporting expectations.

Priorities: all P0 first, then P1 if cycles remain, P2 stretch.
P0 — B (Needs Attention bucket) is the load-bearing one: if the EXISTS
subquery for blocked-step detection returns wrong rows — either too few
or too many — the tab is misleading rather than empty. Report immediately
with run ids + actual DB state if so.

Save artifacts under `docs/reviews/phase-14-monitor-2026-05-29/` and write
the report at `docs/reviews/phase-14-monitor-2026-05-29/REPORT.md` — per-
scenario verdict (PASS / FAIL / PARTIAL), screenshots linked by filename,
console errors verbatim, "recommend amend" markers on anything cheaper to
patch than to fully verify.

The relevant HEAD commit(s) are listed at the bottom of the briefing. Repo
is on the `main` branch and up to date.

If any prerequisite fails (port 3000 taken, magic-link not landing, no
seed runs to backdate for Needs Attention) — STOP and report rather than
guessing. The briefing flags the known landmines in its Prerequisites
section.
```
