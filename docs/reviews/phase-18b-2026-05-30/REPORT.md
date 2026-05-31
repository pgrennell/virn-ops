# Verification Report — Phase 18b-3 (Playbooks execution UI)

**Date:** 2026-05-30
**Method:** **Deterministic headless Playwright** (no Antigravity), per the `agents.md`
verification rule. Spec: [`apps/saas/tests/phase-18b-2026-05-30.spec.ts`](../../../apps/saas/tests/phase-18b-2026-05-30.spec.ts).
Re-run: `pnpm --filter saas exec playwright test phase-18b-2026-05-30.spec.ts`.

**Result:** 3 passed (24.6s). The execute-view surfaces are verified deterministically;
the runtime-dependent advance + the entity-card chip are covered as noted below.

| Scenario | Verdict | Notes |
|---|---|---|
| A — execute-view banner (waiting + countdown + Cancel) | **PASS** | seeded waiting run, `?runId` |
| B — Cancel run → banner flips to `cancelled` (persists) | **PASS** | pure DB op, no runtime |
| C — "Run playbook" button renders on published Read view | **PASS** | |
| Active Run card "Playbook" chip | **covered indirectly** | see below |
| Durable launch → advance → complete | **smoke (manual)** | see below |

## What the headless spec pins
- **A** ([01](01-execute-view-waiting.png)) — with a seeded `waiting` playbook_run, the Read
  view at `?runId=` renders the execute banner: status badge `waiting`, a **"next wake in …"**
  countdown, and a **Cancel run** button.
- **B** ([02](02-execute-view-cancelled.png)) — clicking **Cancel run** flips the run to
  `cancelled` (the `cancel` procedure is a pure DB transition — no orchestrator needed) and the
  Cancel button disappears; a reload still shows `cancelled` (persisted).
- **C** ([03](03-run-button.png)) — the **Run playbook** button renders on a published
  playbook's Read view.

The spec deliberately does **not click** "Run playbook": `launchManual` emits an Inngest event,
which needs the runtime (below). That path is covered by the `launchManual` contract test
(`playbook-runs-authz.test.ts`) + the smoke.

## Active Run card "Playbook" chip — covered indirectly
Rendering the chip requires loading a listing detail page with a playbook run stamped to that
listing; the org has no seeded listing + the listing route isn't a simple `listings/[id]`, so a
full headless path was out of scope here. Coverage instead:
- `listActivePlaybookRunsForEntity` query + `playbookRuns.listActiveForEntity` procedure are
  type-checked and wired (`@virn/api` 544 tests green).
- The card change is presentational — a second `<ul>` section mirroring the existing
  workflow-run rows, with a `TypeChip`. Both `database` + `saas` type-check clean.
- **Follow-up:** fold a chip assertion into a listing-scoped spec once a listing fixture exists.

## Durable launch → advance → complete — local Inngest smoke (no Antigravity)
The orchestrator's per-step logic is unit-tested (`orchestrator.test.ts`, 13 tests). The only
un-unit-tested piece is the durable Inngest wrapper (step.sleep / step.waitForEvent), which needs
a live runtime. To smoke it locally (no Antigravity, no cloud):
```bash
# terminal 1: app          terminal 2: inngest runtime
pnpm --filter saas dev     pnpm dlx inngest-cli@latest dev -u http://localhost:3000/api/inngest
```
Then author a 2-step playbook (a short `wait_for_duration` + `send_notification`), publish, open
the Read view, click **Run playbook**, and watch the run advance on http://localhost:8288 until
`playbook_run.status = completed`. This is a one-off manual smoke; the deterministic UI is the
spec above.

## Recommend-amend / known gaps
1. **No trigger-authoring UI** — every authored playbook is `trigger_type='manual'`, so the
   18b-2 dispatcher (built + unit-tested) only fires via a DB tweak today. Trigger-authoring is
   the natural next slice.
2. Manual launch has no entity picker (entity-stamped runs come from the dispatcher).
3. Execute-view banner is run-level; a per-step actual-timing overlay is a follow-up.
