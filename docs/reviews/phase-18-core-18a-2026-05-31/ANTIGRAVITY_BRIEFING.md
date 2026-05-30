# Antigravity Briefing — Phase 18 core + 18a (Inngest + Playbooks authoring)

**Repo:** `c:\Projects\Virn\virn-ops`
**Branch:** `main` (HEAD at the latest commit; everything in scope is pushed)
**Date:** 2026-05-31

## What this is

Phase 18 has four sub-phases in BUILD_PLAN. This session ships TWO of them
together:

- **Phase 18 core (slim)** — Inngest infrastructure installed for the first
  time + SLA sweep migrated from Vercel Cron to an Inngest scheduled function.
  Vercel Cron entry kept as a transition safety net (the SLA sweep's
  audit-log antijoin makes double-firing harmless).
- **Phase 18a** — Playbooks authoring: publish dance (publishVersion +
  editPublished + discardDraft), `/playbooks` list page, `/playbooks/[id]/builder`
  page with vertical step list + per-step Edit Action modal + Publish/Discard/
  Active controls, and `/playbooks/[id]/read` chronological timeline view.

**Deferred from Phase 18 core (separate follow-up):**
- `automation_rule` executor (event listener + action catalog).
- Event emission from existing chokepoints (run.completed / run.state_changed).
- `run_rule_fired` idempotency schema.

**Deferred from Phase 18a (separate polish pass):**
- Tri-column shell with persistent chat panel (R1).
- Template Variables sidebar (R4).
- Type-specific per-step config UIs (today's modal is a JSON textarea +
  type-aware default fallback).
- Dry-render preview.
- `/sop` integration for Playbooks (operators see workflows but not playbooks
  in /sop).
- Library tab integration (Playbooks live under their own sidebar item).

**Phase 18b** (execution: Inngest dispatcher + orchestrator + launchManual +
Active Run card widening) and **Phase 18c** (AI authoring: agents.authorPlaybook)
are NOT in scope this session.

**The load-bearing scenario is C (Publish dance).** It's the only flow that
TOUCHES the playbook schema's snapshot contract (D-018). If publish/edit/
discard misbehave, the Playbook authoring loop is broken.

## Goal

Validate that:

1. **Inngest is installed + the endpoint registers.** Hitting `/api/inngest`
   returns the function registry handshake (no 500); the SLA sweep Inngest
   function shows up in the local Inngest Dev Server (or the registry
   response if Dev Server isn't running).
2. **/playbooks list page** loads, the "New playbook" affordance creates a
   playbook + redirects to its Builder, and the row list reflects the new
   row immediately.
3. **Builder publish dance works end-to-end** (load-bearing): add a step →
   publish → state flips to "Published vN" + Discard/Add disappear → Edit
   forks a fresh draft (vN+1).
4. **Read view renders the published version** as a chronological timeline
   with type-aware step icons + the JSON config preview.
5. **Active toggle** flips `playbook.is_active` cleanly + persists across
   refresh.
6. **Discard draft** deletes the draft + steps; the page reflects the
   published state again.

## Prerequisites

### Dev server

```bash
cd c:/Projects/Virn/virn-ops/apps/saas
pnpm exec dotenv -c -e ../../.env.local -- next dev --port 3000
```

Wait for "Local: http://localhost:3000". If port 3000 is busy:

```bash
netstat -ano | grep ":3000" | grep LISTENING | awk '{print $5}' | xargs taskkill //F //PID
```

### Auth

Seeded admin: `pgrennell@gmail.com` in the org with slug `virn`. Magic-link
bypass pattern in `apps/saas/tests/dogfood-walkthrough.spec.ts`:
callback URL `http://localhost:3000/api/auth/magic-link/verify?token={TOKEN}&callbackURL=http://localhost:3000/virn/playbooks`.

### Inngest (scenario A only)

The Inngest function will register against the local Inngest Dev Server
when it's running. To exercise A end-to-end, in a separate terminal:

```bash
pnpm dlx inngest-cli@latest dev -u http://localhost:3000/api/inngest
```

This boots a local Dev Server at http://localhost:8288 and probes the saas
endpoint. The SLA sweep function should appear in the Dev Server's Functions
tab. **If the Dev Server isn't running, scenario A reduces to verifying the
/api/inngest endpoint returns a handshake response (GET).**

### Capability flips (none needed)

Phase 18a doesn't introduce a new capability flag (Playbooks are
unconditionally available to author-grade roles, mirroring Library). The
sidebar item is visible for builder/admin/owner; gated to admin/owner for
writes via adminOrgProcedure server-side.

### Seed data

None required. Scenario B will create a fresh playbook via the UI.

### Migrations

No new migrations in this phase (Phase 9.6 already landed the playbook
schemas). Sanity-check:

```bash
pnpm --filter @virn/database migrate
```

## Test plan

Save artifacts under `docs/reviews/phase-18-core-18a-2026-05-31/` and the
spec at `apps/saas/tests/phase-18-core-18a-2026-05-31.spec.ts` following
the existing `getArtifactsDir` pattern.

Tag scenarios **P0 / P1 / P2** to prioritize when running out of time. All
P0 first; P1 if cycles remain; P2 is stretch. Sequential screenshot naming
`01-`, `02-`, ... across all scenarios.

---

### P0 — A. Inngest endpoint registers + function visible

**Scenario:** Confirm `/api/inngest` returns a valid handshake + the SLA
sweep function is listed in the registry.

1. GET `http://localhost:3000/api/inngest` (browser or curl). Response should
   be a JSON body with `appName: "virn-ops"`, `functions: [...]` containing
   the `sla-sweep-scheduled` entry, and `hasEventKey`/`hasSigningKey` flags.
   Capture `01-inngest-handshake.txt` (paste the JSON).
2. If running the Inngest Dev Server (`pnpm dlx inngest-cli@latest dev -u
   http://localhost:3000/api/inngest`), navigate to
   http://localhost:8288/functions. The "SLA escalation sweep (hourly)"
   function should appear. Capture `02-inngest-devserver-functions.png`.
3. If NOT running the Dev Server: skip step 2 + note in REPORT that this
   was a registry-only verification.

**Verify:**
- Handshake response includes the function in the registry.
- No 500 error from the endpoint.
- (Stretch) Dev Server lists the function with the cron trigger `0 * * * *`.

**Report:**
- Per-step pass/fail.
- Whether the Dev Server was used (and the resulting function list).

---

### P0 — B. /playbooks list page + create new

**Scenario:** Confirm the new sidebar item works and create-new redirects
to the Builder.

1. Navigate to `/virn`. Sidebar should show "Playbooks" under the Build
   group (next to Library/Templates/Automations). Capture
   `03-sidebar-with-playbooks.png`.
2. Click "Playbooks". URL becomes `/virn/playbooks`. The list shows the
   org's existing playbooks (likely empty for the seeded org). Capture
   `04-playbooks-list-empty-or-populated.png`.
3. Click "New playbook" (admin only). Inline form appears with name
   textbox + Create/Cancel buttons. Capture `05-new-playbook-inline-form.png`.
4. Enter "STR post-stay review cadence" + click Create. Browser navigates
   to `/virn/playbooks/<newId>/builder`. Capture `06-builder-empty-state.png`.
5. Back-button → `/virn/playbooks`. The new playbook appears in the list
   with Status badge "Disabled" + Lifecycle badge "draft".

**Verify:**
- New playbook persists across refresh.
- Empty-state copy in Builder reads "No steps yet. Add the first step to
  give this playbook a body."

**Report:**
- Per-step pass/fail.
- Captured playbook id for the next scenarios.

---

### P0 — C. Builder publish dance end-to-end (LOAD-BEARING)

**This is the load-bearing scenario for this briefing.** Verifies the
publish dance against the actual schema constraints.

**Scenario:** Add steps → publish → edit (fork) → discard.

1. From the Builder of the newly-created playbook, click "Add step" (the
   button in the empty state). A Dialog opens with Type select + Config
   JSON textarea. Capture `07-add-step-dialog.png`.
2. Leave type = "Wait (duration)" (default) + config = `{"amount":1,"unit":"days"}`
   (default). Click Save. Dialog closes; the step appears in the list with
   icon + type label + JSON preview. Capture `08-step-added.png`.
3. Add a second step: type = "Send notification", config = `{"type":"ACKNOWLEDGMENT_DUE"}`.
4. Click Publish. The header transitions to "Published v1" badge. Edit/
   Add/Discard buttons disappear; only the Active toggle + a new Edit
   button (when admin) remain. Capture `09-published-state.png`.
5. Click Edit. Header flips back to "Draft v2" with full editing
   affordances. Re-add at least one step to v2 (e.g. another wait). The
   `forked` flag is true so this MUST be a fresh deep-copy of v1's steps
   (verify: the two original steps from v1 should be present + your new
   step). Capture `10-fork-result.png`.
6. Click Discard. Confirmation flow returns to the published v1 state
   (the draft v2 is gone). Capture `11-after-discard.png`.

**Verify:**
- Publish refuses on empty playbook (try clicking Publish before adding
  any steps — should error with VERSION_HAS_NO_STEPS).
- After publish, the step list is read-only (no edit buttons next to
  steps until Edit is clicked).
- Forked draft preserves all steps from the source published version
  (deep-copy semantics).
- Discard returns to the published state cleanly + the draft is gone
  from the DB (check via drizzle studio if helpful).

**Report:**
- Per-step pass/fail.
- **If publish/edit/discard misbehaves:** report immediately with the
  playbook id + the actual vs expected behavior. This blocks Phase 18b.

---

### P0 — D. Read view renders the published timeline

**Scenario:** Confirm the chronological timeline render on /read.

1. From the Builder, navigate to
   `/virn/playbooks/<id>/read` (manual URL — there's no view-switcher
   pill in this MVP slice; the page is reachable via the URL directly
   or from a future polish pass).
2. Capture `12-read-view.png`.
3. Verify:
   - Header shows the playbook name + Published version chip + Active
     status badge + "Triggers on manual launch" subtitle.
   - Each step renders as a timeline card with the type icon (Clock for
     waits, Send for notifications) + step index ("Step 01" etc) + the
     JSON config preview.
   - A connector line runs down between steps (the timeline visual).
4. Click "Open in Builder" in the header (admin only). Returns to
   `/builder`.

**Verify:**
- Empty-state ("This playbook hasn't been published yet.") appears
  correctly for a playbook with no published version.
- Step icons match the type (Wait → Clock, Send → Send, etc).

**Report:**
- Per-step pass/fail.

---

### P1 — E. Active toggle + persistence

**Scenario:** Flip Active on/off in the Builder header + verify
persistence.

1. From the Builder, click the Active/Disabled switch in the header. The
   label flips. Capture `13-active-toggled.png`.
2. Hard-refresh. State persists.
3. Navigate to `/virn/playbooks`. The row's Status badge should reflect
   the toggle state.

**Verify:**
- The toggle does NOT affect the published version (it's a playbook-level
  flag, not version-level).
- Dispatcher behavior is NOT exercisable yet (Phase 18b). Toggling is
  metadata-only today.

---

### P2 — F. Non-admin permission posture

**Scenario:** Verify non-admin members can't reach the create / publish
affordances.

1. If a non-admin test account is reachable, log in as that user.
2. Navigate to `/virn/playbooks`. Sidebar item is visible (builder/admin/
   owner ALL see it per nav.ts allowedRoles).
3. The "New playbook" button should NOT appear. Capture `14-non-admin-list.png`.
4. Navigate to an existing playbook's Builder. The Publish/Discard/Edit
   buttons should NOT appear; only the read display + Active toggle.
   Capture `15-non-admin-builder.png`.

**Verify:**
- Non-admins can READ but can't WRITE through the UI.
- (Defense-in-depth — out of scope for this scenario): direct API calls
  to `playbooks.publishVersion` should return FORBIDDEN.

**Report:**
- Per-step pass/fail.
- If no non-admin account exists, skip + note in REPORT.

---

## What to send back

A single markdown report at
`docs/reviews/phase-18-core-18a-2026-05-31/REPORT.md` with:

- **Per-scenario verdict** (PASS / FAIL / PARTIAL) with the captured
  screenshots linked by filename.
- **The P0 — C verdict is load-bearing.** If publish/edit/discard
  misbehaves, report immediately with playbook + version ids.
- **Any console errors** observed (paste verbatim, including stack).
- **Specific reproductions** for anything that didn't behave as described.
- **"Recommend amend"** markers on anything cheaper to patch than to fully
  verify.

The relevant HEAD commit:

- `199097f` feat(playbooks,inngest,saas): Phase 18 core (slim) + 18a —
  Inngest infra + Playbooks authoring. Single commit covers both
  sub-phases.

---

## Kickoff prompt (paste this to Antigravity)

```
I need browser-driven verification of Phase 18 core + 18a (Inngest
infrastructure + Playbooks authoring). The full self-contained briefing
is at:

  c:\Projects\Virn\virn-ops\docs\reviews\phase-18-core-18a-2026-05-31\ANTIGRAVITY_BRIEFING.md

Read it first — it has prerequisites (dev server, magic-link auth, the
optional Inngest Dev Server for scenario A), tagged scenarios (P0/P1/P2),
capture targets, and per-scenario reporting expectations.

Priorities: all P0 first, then P1 if cycles remain, P2 stretch.
P0 — C (Builder publish dance end-to-end) is the load-bearing one: it
touches the playbook snapshot-immutability contract (D-018). If publish/
edit/discard misbehaves, the Playbook authoring loop is broken and Phase
18b will inherit the bug.

Save artifacts under `docs/reviews/phase-18-core-18a-2026-05-31/` and write
the report at `docs/reviews/phase-18-core-18a-2026-05-31/REPORT.md` —
per-scenario verdict (PASS / FAIL / PARTIAL), screenshots linked by
filename, console errors verbatim, "recommend amend" markers on anything
cheaper to patch than to fully verify.

The relevant HEAD commit is listed at the bottom of the briefing. Repo is
on the `main` branch and up to date.

If any prerequisite fails (port 3000 taken, magic-link not landing) — STOP
and report rather than guessing. The briefing flags the known landmines in
its Prerequisites section.

Known scope: the Builder is intentionally minimal (no tri-column shell,
no Template Variables sidebar, no type-specific step config UIs). The
step Edit modal uses a JSON textarea with type-aware default fallback.
Don't block on these missing pieces.
```
