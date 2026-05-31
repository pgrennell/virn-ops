# Antigravity Briefing — Phase 18b (Playbooks execution: orchestrator + dispatch + UI)

**Repo:** `c:\Projects\Virn\virn-ops`
**Branch:** `main` (HEAD has 18b-1 + 18b-2 committed; 18b-3 UI is the commit under review)
**Date:** 2026-05-30

## What this is

Phase 18b makes published, `is_active` Playbooks actually **execute**. Three commits:

- **18b-1** (`c44bf66`) — durable Inngest orchestrator (step.sleep / step.waitForEvent
  for waits; all six step types) + `playbookRuns.launchManual` + `cancel`. Backend, fully
  unit/contract-tested (`@virn/api` 544 tests green).
- **18b-2** (`d9bdb56`) — the dispatcher: emits `run.completed` / `run.state_changed` from
  the run-completion chokepoint and fans matching active playbooks out into runs. Pure
  matching + fingerprint logic unit-tested.
- **18b-3** (this commit) — the two UI surfaces: a **"Run playbook"** button + **execute-view**
  banner on the Read view, and **Active Run card widening** (playbook rows + a type chip).

This briefing verifies the **UI surfaces** in a real browser (the backend is already
green via unit tests). The headline is **Scenario B** — manual launch driving a run to
completion through a real durable wait.

## Goal

1. The Inngest endpoint registers all three functions (sla-sweep + orchestrator + dispatcher).
2. A published playbook can be **launched from the Read view**, and the execute-view banner
   shows live status + a next-wake countdown that advances to **completed** after the wait.
3. **Cancel** from the execute-view stops the run.
4. The **Active Run card** on a listing surfaces playbook runs with a "Playbook" type chip
   alongside workflow runs.

## Prerequisites

### Dev server
```bash
cd c:/Projects/Virn/virn-ops/apps/saas
pnpm exec dotenv -c -e ../../.env.local -- next dev --port 3000
```
Wait for "Local: http://localhost:3000". If 3000 is busy, kill the listener and retry.

### Inngest Dev Server (REQUIRED for B/C — this is what runs the orchestrator locally)
In a separate terminal:
```bash
pnpm dlx inngest-cli@latest dev -u http://localhost:3000/api/inngest
```
Boots the Dev Server at http://localhost:8288 and probes the saas endpoint. Without it,
manual launch seeds the `playbook_run` row but nothing advances it (no orchestrator runtime).

### Auth
Seeded admin `pgrennell@gmail.com`, org slug `virn`. Magic-link DB-bypass pattern is in
`apps/saas/tests/dogfood-walkthrough.spec.ts` (callback URL with the token from the
`verification` table).

### drizzle studio (for the DB-assisted steps in D + the optional E)
```bash
pnpm --filter @virn/database studio
```

---

## Test plan

Save artifacts under `docs/reviews/phase-18b-2026-05-30/`. Sequential screenshot naming
`01-`, `02-`, … P0 first, then P1, P2 stretch.

### P0 — A. Inngest functions register
1. GET `http://localhost:3000/api/inngest` → JSON with `function_count >= 3`. Capture
   `01-inngest-handshake.txt`.
2. If the Dev Server is up, open http://localhost:8288/functions — "Playbook orchestrator"
   and "Playbook dispatcher" appear alongside "SLA escalation sweep". Capture
   `02-inngest-functions.png`.

### P0 — B. Manual launch + execute-view + completion (LOAD-BEARING)
1. Create a playbook (`/virn/playbooks` → New playbook → "E2E Exec Demo").
2. In the Builder, add **two steps**:
   - Step 1: type **Wait (duration)**, config `{"amount":1,"unit":"minutes"}`.
   - Step 2: type **Send notification**, config `{"userId":"<the admin user id>","type":"APP_UPDATE"}`
     (grab the admin user id from drizzle studio's `user` table; if unsure, leave config `{}` —
     the step then completes as a no-op "skipped: no recipient", which still proves the walk).
3. **Publish**. Then open the Read view (`/virn/playbooks/<id>/read`).
4. Click **"Run playbook"**. The URL becomes `…/read?runId=<id>` and a **Run banner** appears:
   status **waiting**, with **"next wake in ~1m"**. Capture `03-execute-view-waiting.png`.
5. Watch the Dev Server (http://localhost:8288) — the orchestrator run advances: step 1 sleeps
   ~1 minute, then step 2 runs. Capture `04-devserver-run-advancing.png`.
6. After the wait, reload the Read view — the banner status flips to **completed** (no Cancel
   button). Capture `05-execute-view-completed.png`.
7. In drizzle studio, confirm one `playbook_run` (status `completed`) + two `playbook_run_step`
   rows (both `completed`).

**Verify:** the wait actually delays ~1 minute (durable sleep, not instant); the run reaches
`completed`; the run-step rows reflect each step.

### P0 — C. Cancel from the execute-view
1. Launch the same playbook again ("Run playbook"). While it's **waiting** (during the 1-min
   sleep), click **"Cancel run"** in the banner. Capture `06-cancel-clicked.png`.
2. The banner status flips to **cancelled**; the Cancel button disappears. The orchestrator
   stops at the next step boundary (it won't run step 2). Capture `07-cancelled.png`.

### P1 — D. Active Run card widening (DB-assisted)
The Read-view launch creates an **entity-less** run, so to see it on a listing card we stamp
an entity directly (manual launch has no entity picker in v1).
1. Launch a playbook (leave it running, or use a fresh one with a longer first wait, e.g.
   `{"amount":1,"unit":"hours"}` so it stays `waiting`).
2. In drizzle studio, open the `playbook_run` row and set `trigger_entity_type = 'listing'`
   and `trigger_entity_id = <an existing listing id>` (from the `listing`/`template_listing`
   table). Save.
3. Navigate to that listing's detail page. The **Active Run** right-rail card now shows a
   **violet "Playbook" chip** row (with a "wakes in …" hint) alongside any workflow runs.
   Capture `08-active-run-card-playbook-chip.png`.
4. Click the playbook row → it opens `/virn/playbooks/<id>/read?runId=<id>` (the execute view).

**Verify:** the card shows BOTH workflow + playbook rows when both exist, each with the
correct type chip; the playbook row links to the execute view.

### P2 — E. Auto-dispatch end-to-end (stretch; needs a DB trigger tweak)
Trigger-authoring UI isn't built yet, so every authored playbook is `trigger_type='manual'`
and the dispatcher won't fire it. To prove auto-dispatch:
1. In drizzle studio, on a **published** playbook version row, set `trigger_type =
   'lifecycle_event'` and `trigger_event = 'run.completed'`. Ensure the parent playbook
   `is_active = true` (toggle it on in the Builder). Leave `entity_set_ids` empty (match-any).
2. Launch + **complete** any workflow run (all required steps). On completion, the run emits
   `run.completed` → the dispatcher seeds a `playbook_run` for the active playbook → the
   orchestrator runs it.
3. Confirm a new `playbook_run` appeared with `trigger_payload.runId` = the completed run's id.
   Capture `09-auto-dispatch-run.png`.

**Note in the REPORT** that trigger-authoring UI is a follow-up; auto-dispatch is unit-tested
but only reachable via this DB tweak today.

---

## What to send back

`docs/reviews/phase-18b-2026-05-30/REPORT.md` — per-scenario verdict (PASS / FAIL / PARTIAL),
screenshots linked by filename, console errors verbatim, and "recommend amend" markers.
**B is load-bearing** — if manual launch doesn't drive a run to completion through the
durable wait, report immediately with the playbook + run ids.

Known scope (don't block on these): no trigger-authoring UI (manual is the only authorable
trigger); manual launch has no entity picker (entity-stamped runs come from the dispatcher);
per-step actual-timing overlay on the execute view is a follow-up (the banner is run-level).
