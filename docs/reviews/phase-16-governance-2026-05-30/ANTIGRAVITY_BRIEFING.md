# Antigravity Briefing — Phase 16 Governance Flows

**Repo:** `c:\Projects\Virn\virn-ops`
**Branch:** `main` (HEAD at the latest commit; everything in scope is pushed)
**Date:** 2026-05-30

## What this is

Phase 16 (governance flows) is the active-side complement to Phase 15's
read-only compliance reader. Four slices shipped in one session, each
behind its respective capability flag:

- **Slice A — Ack WRITE.** Phase 15 shipped read-only acknowledgment
  evidence; Phase 16 adds the actual "Acknowledge" button on the Read view
  footer + an "Acknowledged" badge once the user has signed off.
- **Slice B — Approvals UI.** Per-version `version_approval` lifecycle:
  request → decide → publish-gate. `/compliance/approvals` dashboard
  for reviewers. The publish flow now refuses when capability is on AND
  no approved row exists.
- **Slice C — Suggestions.** "Suggest improvement" button on the Read view
  footer; admin triage at `/compliance/suggestions` with accept/reject/
  merge actions.
- **Slice D — Re-attestation.** Workflows now accept a
  `reviewIntervalDays` cadence via `workflows.update`. A Vercel Cron sweep
  at `/api/cron/reattestation-sweep` (daily 06:00 UTC) finds workflows
  past `next_review_at`, advances the date forward, writes an audit row.

29 new tests in this phase (9 ack lib + 13 approval lib + 7 suggestion
lib) on top of the prior baseline — 496 total API tests passing.

**The load-bearing scenario is C (Approvals publish-gate).** It's the
only flow that MODIFIES an existing critical path (the publish action).
If the gate is wrong — refusing when it shouldn't, or letting through
when capability is on — workflow publishing is broken for compliance
orgs. Verification should cover both directions: gate fires correctly
when cap on + no approved row, AND publish proceeds correctly when cap
on + approved row exists.

**Known scope gap (documented).** Slice B has no in-Builder "Request
approval" button — modifying BuilderTopBar's complex state machine was
out of scope. The procedure (`approvals.request`) exists; admins set
approval rows via direct API call OR via a future polish pass. The
verification should NOT block on the missing button.

**Pre-existing untracked file warning.** `apps/saas/tests/phase-12-reverification-2026-05-29.spec.ts`
is an orphaned spec from a prior incomplete Antigravity run. It has 3
type errors (Playwright `.click()` on SVGElement union). The saas
type-check fails on this file alone; nothing in Phase 16 introduces
new type errors. Verification should either (a) delete the orphan and
re-attempt Phase 12 verify in a fresh session, or (b) leave it +
ignore.

## Goal

Validate that:

1. **Slice A — Ack WRITE.** With `governance.acknowledgments` ON, the
   Read view footer shows an "Acknowledge" button; clicking it inserts
   a row + replaces the button with "Acknowledged on …" copy + lights
   up the indigo "Acknowledged" badge in the header chips.
2. **Slice B — Approvals.** With `governance.approvals` ON, the publish
   flow refuses with `APPROVAL_REQUIRED` for unapproved versions;
   inserting a `version_approval` row with `decision='approved'` (via
   the dashboard's decide action OR via SQL) lets publish succeed.
   `/compliance/approvals` lists pending rows and the inline decide
   actions transition pending → approved/rejected.
3. **Slice C — Suggestions.** With `governance.suggestions` ON, the
   Read view footer shows "Suggest improvement"; submitting opens a
   dialog → inserts a row → success state. `/compliance/suggestions`
   lists all rows with status tabs; decide actions (accept/reject/
   merge) transition open → resolved.
4. **Slice D — Re-attestation.** A workflow with
   `reviewIntervalDays` set + `next_review_at < now` is picked up by
   the sweep, advances forward by the interval, and writes a
   `workflow.reattestation_due` audit row visible on the per-workflow
   Audit tab (Phase 15).
5. **Capability gating composes.** All four flows respect their gates:
   surfaces stay hidden, procedures refuse with
   `CAPABILITY_DISABLED`, when the respective capability is off.

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
- Callback URL: `http://localhost:3000/api/auth/magic-link/verify?token={TOKEN}&callbackURL=http://localhost:3000/virn/library`

### Capability flips (per-scenario)

This phase exercises FOUR capability flags. Set up each via
`/virn/settings/configuration`:

- **Slice A:** `governance.acknowledgments` ON
- **Slice B:** `governance.approvals` ON + ALSO `compliance.pack` ON
  (the dashboard lives under `/compliance`)
- **Slice C:** `governance.suggestions` ON + ALSO `compliance.pack` ON
  (the triage surface lives under `/compliance`)
- **Slice D:** No new capability — uses the existing `workflow.review_*`
  columns. `compliance.pack` ON to see the audit tab.

For a single-pass verification, flip all four capabilities ON at the
start. The verification expects each surface to behave correctly when
its cap is on.

### Seed data

- **Slice A:** Need at least one published workflow_version. The STR
  Turnover seed from prior dogfooding is a good target.
- **Slice B:** Need at least one DRAFT workflow_version that hasn't
  been published yet. Create one by clicking "Edit" on an existing
  published workflow in `/virn/library` (this resumes-or-forks per
  D-018; the result is a draft you can target).
- **Slice C:** Any workflow will do — the submit button just writes
  a suggestion against the workflow id.
- **Slice D:** A workflow with `review_interval_days` set + a
  `next_review_at` in the past. Easiest seed path (drizzle studio):
  ```sql
  UPDATE workflow
  SET review_interval_days = 30,
      next_review_at = now() - interval '1 day'
  WHERE organization_id = (SELECT id FROM organization WHERE slug='virn')
  LIMIT 1;
  ```

### Migrations

No new migrations in Phase 16 (all four slices use existing schema). Sanity-
check:

```bash
pnpm --filter @virn/database migrate
```

## Test plan

Save artifacts under `docs/reviews/phase-16-governance-2026-05-30/` and the
spec at `apps/saas/tests/phase-16-governance-2026-05-30.spec.ts` following
the existing `getArtifactsDir` pattern.

Tag scenarios **P0 / P1 / P2** to prioritize when running out of time. All
P0 first; P1 if cycles remain; P2 is stretch. Sequential screenshot naming
`01-`, `02-`, ... across all scenarios.

---

### P0 — A. Ack WRITE: button + badge end-to-end

**Scenario:** With `governance.acknowledgments` ON, the Read view's
Acknowledge button works end-to-end.

1. Flip `governance.acknowledgments` ON via `/virn/settings/configuration`.
2. Navigate to any published workflow's Read view
   (`/virn/library/workflows/<id>/read`).
3. Scroll to the footer. Expect: "Mark as read" button + "Acknowledge"
   button side-by-side. Capture `01-readview-footer-buttons.png`.
4. Click "Acknowledge". Expect: button replaced with "Acknowledged on
   <today>" copy + indigo "Acknowledged" badge in the header chips row.
   Capture `02-acknowledged-state.png`.
5. Refresh the page. State persists (badge still shows). Capture
   `03-acknowledged-after-refresh.png`.
6. Navigate to `/virn/compliance/acknowledgments`. The new acknowledgment
   row appears in the list (Phase 15 read surface, now populated by
   real user action). Capture `04-acknowledgments-index-populated.png`.

**Verify:**
- Idempotency: clicking Acknowledge twice doesn't error (the second
  call is a no-op against the unique constraint).
- The badge has a tooltip with the timestamp.
- The procedure refuses with `CAPABILITY_DISABLED` if you try direct
  API call with the cap off.

**Report:**
- Per-step pass/fail.
- Receipt id from `/compliance/acknowledgments` so the spec can re-target.

---

### P0 — B. Approvals: dashboard decide flow

**Scenario:** Reviewer triages a pending approval inline from the
dashboard.

1. Flip `governance.approvals` ON + `compliance.pack` ON.
2. Create a pending approval via direct API call (no in-Builder UI yet —
   see "Known scope gap" above). From the browser console on `/virn`:
   ```js
   await fetch('/api/rpc/approvals.request', {
     method: 'POST',
     headers: { 'content-type': 'application/json' },
     body: JSON.stringify({ workflowVersionId: '<DRAFT_VERSION_ID>' })
   }).then(r => r.json());
   ```
   (Or hit the procedure via your preferred client.)
3. Navigate to `/virn/compliance/approvals`. The pending row appears
   with workflow title + requester + timestamp. Capture `05-pending-approvals.png`.
4. Click "Review" → inline note textarea + Approve/Reject buttons appear.
   Capture `06-decide-form-open.png`.
5. Add a note + click "Approve". Row disappears from pending list (status
   moved to `approved`). Capture `07-after-approve.png`.

**Verify:**
- Empty state when no pending rows.
- CONFLICT alert if you decide a row that's already decided (race scenario
  — can simulate by opening two tabs).
- Note text is optional — submit with empty textarea works.

**Report:**
- Per-step pass/fail.
- Any console error during decide.

---

### P0 — C. Approvals: publish gate (LOAD-BEARING)

**This is the load-bearing scenario for this briefing.** If the gate is
wrong, workflow publishing breaks for compliance orgs.

**Scenario:** With `governance.approvals` ON, publishing refuses without
an approved row + succeeds with one.

1. Confirm `governance.approvals` ON.
2. Find a workflow with an open draft. Click Edit → land in Builder on
   the draft.
3. Click "Publish". Expect refusal: error toast / alert showing
   `APPROVAL_REQUIRED` (mapped to FORBIDDEN). Capture
   `08-publish-refused.png` showing the error.
4. Navigate to `/virn/compliance/approvals`. Request approval for the
   same draft (via console as in scenario B). Approve it.
5. Go back to the Builder. Click "Publish" again. Expect success — the
   version transitions to published. Capture `09-publish-success.png`.
6. **Negative control:** Flip `governance.approvals` OFF. Publishing
   any draft (no approval needed) should work normally. Capture
   `10-publish-cap-off.png`.

**Verify:**
- The error message is human-readable, not a raw error code.
- The gate fires for EVERY caller including admins/owners (no role-based
  bypass — strict per design).
- Existing publish paths (non-compliance orgs) are untouched.

**Report:**
- Per-step pass/fail.
- **If the gate is wrong:** report the workflow + version ids + the actual
  vs. expected behavior. This blocks the rollout.

---

### P0 — D. Suggestions: submit + triage

**Scenario:** Operator submits a suggestion from the Read view; admin
triages it from /compliance/suggestions.

1. Flip `governance.suggestions` ON + `compliance.pack` ON.
2. Navigate to any published workflow's Read view.
3. Scroll to footer. Expect "Suggest improvement" button. Capture
   `11-suggest-button.png`.
4. Click it. Dialog opens with textarea. Capture `12-suggest-dialog.png`.
5. Type "Add a stop-task after step 3." and click Submit. Expect success
   state, then dialog closes. Capture `13-suggest-success.png`.
6. Navigate to `/virn/compliance/suggestions`. The new suggestion appears
   in the "Open" tab. Capture `14-suggestions-open-tab.png`.
7. Click "Accept" on the row. Status transitions to accepted; row moves
   to "Accepted" tab. Capture `15-suggestions-accepted.png`.

**Verify:**
- Empty textarea / whitespace-only blocks the Submit button.
- Status tabs filter correctly (Open / Accepted / Rejected / Merged / All).
- Resolved suggestions hide the decide buttons.
- CONFLICT alert if you decide a row that's already decided.

**Report:**
- Per-step pass/fail.
- Any visual glitch on the dialog success state (1200ms close delay).

---

### P1 — E. Re-attestation: cron sweep end-to-end

**Scenario:** A workflow with a stale `next_review_at` is picked up by
the sweep, advances forward, audit fires.

1. Seed a workflow with a past-due `next_review_at` per the Prerequisites
   SQL block.
2. Note the workflow id + the current `next_review_at` value.
3. Fire the cron endpoint manually:
   ```bash
   curl -H "Authorization: Bearer ${CRON_SECRET}" http://localhost:3000/api/cron/reattestation-sweep
   ```
4. Response should be JSON with `{ ok: true, scanned: <N>, advanced: <N>, elapsedMs: … }`.
5. Re-query the workflow in drizzle studio: `next_review_at` is now
   `previous + reviewIntervalDays` (NOT `now + reviewIntervalDays` —
   cycle-grid alignment, see lib comment).
6. Navigate to `/virn/library/workflows/<id>/audit` (Phase 15 surface).
   The latest entry is `workflow.reattestation_due` with the previous +
   new dates in `changes`. Capture `16-reattestation-audit-entry.png`.
7. Run the cron again immediately. Expect `scanned=0, advanced=0` (the
   row dropped out of the candidate set after the first sweep advanced
   it). Capture the JSON response in `17-second-sweep-empty.txt`.

**Verify:**
- The cron endpoint refuses with 401 if `Authorization` header is wrong/
  missing.
- The cron endpoint returns 500 if `CRON_SECRET` env var isn't set.

**Report:**
- Per-step pass/fail.
- Any per-row failure that surfaced (the sweep continues; `advanced` <
  `scanned` if so).

---

### P2 — F. Capability gating: surfaces hidden when off

**Scenario:** Confirm each surface disappears when its capability is OFF.

1. Flip ALL four capabilities OFF.
2. Read view footer: NO Acknowledge button, NO Suggest button (only
   "Mark as read" remains).
3. `/virn/compliance/approvals`: page still loads (compliance.pack
   gates it), but the procedure refuses with `CAPABILITY_DISABLED`
   if called directly. The dashboard's empty state shows. Capture
   `18-approvals-cap-off.png`.
4. `/virn/compliance/suggestions`: same posture. Capture
   `19-suggestions-cap-off.png`.
5. Workflows continue to publish without approval-gate refusal.

**Verify:**
- Direct procedure calls (acknowledge, request, decide, submit) all
  refuse with `FORBIDDEN/CAPABILITY_DISABLED` when the relevant cap
  is off.

**Report:**
- Per-surface pass/fail.

---

## What to send back

A single markdown report at `docs/reviews/phase-16-governance-2026-05-30/REPORT.md`
with:

- **Per-scenario verdict** (PASS / FAIL / PARTIAL) with the captured
  screenshots linked by filename.
- **The P0 — C verdict is load-bearing.** If the publish gate is wrong —
  refusing when it shouldn't, or letting through when capability is on —
  report immediately with the workflow + version ids + the actual vs.
  expected behavior.
- **Any console errors** observed (paste verbatim, including stack).
- **Specific reproductions** for anything that didn't behave as described.
- **"Recommend amend"** markers on anything cheaper to patch than to
  fully verify.
- **Pre-existing orphan file note:** if you find
  `apps/saas/tests/phase-12-reverification-2026-05-29.spec.ts` blocks
  type-check, note whether you cleaned it up or left it.

The relevant HEAD commit:

- `e5ac58e` feat(acknowledgments,approvals,suggestions,workflows): Phase 16
  — Governance flows. Single commit covers all four slices.

---

## Kickoff prompt (paste this to Antigravity)

```
I need browser-driven verification of Phase 16 (governance flows —
Ack WRITE + Approvals UI + Suggestions + Re-attestation). The full
self-contained briefing is at:

  c:\Projects\Virn\virn-ops\docs\reviews\phase-16-governance-2026-05-30\ANTIGRAVITY_BRIEFING.md

Read it first — it has prerequisites (dev server, magic-link auth,
capability flips for all four flows, seed data per slice), tagged
scenarios (P0/P1/P2), capture targets, and per-scenario reporting
expectations.

Priorities: all P0 first, then P1 if cycles remain, P2 stretch.
P0 — C (Approvals publish-gate) is the load-bearing one: if the gate
is wrong, publishing breaks for compliance orgs. Verify both directions
(refuses without approval, succeeds with).

Known scope gap: Slice B has no in-Builder "Request approval" button —
admins create approval rows via direct API call. The briefing has the
exact fetch() invocation. Don't block on the missing UI.

Save artifacts under `docs/reviews/phase-16-governance-2026-05-30/` and
write the report at `docs/reviews/phase-16-governance-2026-05-30/REPORT.md`
— per-scenario verdict (PASS / FAIL / PARTIAL), screenshots linked by
filename, console errors verbatim, "recommend amend" markers on anything
cheaper to patch than to fully verify.

The relevant HEAD commit is listed at the bottom of the briefing. Repo
is on the `main` branch and up to date.

If any prerequisite fails (port 3000 taken, magic-link not landing, any
capability seed not applied, draft version doesn't exist for the
approval flow) — STOP and report rather than guessing. The briefing flags
the known landmines in its Prerequisites section.
```
