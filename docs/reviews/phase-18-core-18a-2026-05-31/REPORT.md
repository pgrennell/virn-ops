# Verification Report — Phase 18 core + 18a (Inngest + Playbooks authoring)

**Date:** 2026-05-31
**HEAD commit in scope:** `199097f` feat(playbooks,inngest,saas): Phase 18 core (slim) + 18a
**Verified by:** Claude Code — **deterministic headless Playwright** (not an Antigravity
browser session). Spec: [`apps/saas/tests/phase-18-core-18a-2026-05-31.spec.ts`](../../../apps/saas/tests/phase-18-core-18a-2026-05-31.spec.ts).
Re-runnable for **zero Antigravity credits** via `pnpm --filter saas exec playwright test phase-18-core-18a-2026-05-31.spec.ts`.

**Result:** 5 passed, 1 deferred (skipped). All P0 + P1 scenarios PASS, including the
load-bearing publish dance.

| Scenario | Pri | Verdict | Notes |
|---|---|---|---|
| A — Inngest endpoint registers | P0 | **PASS** | `/api/inngest` GET → 200, `function_count: 1`, `mode: "dev"` |
| B — /playbooks list + create | P0 | **PASS** | Create → redirect to Builder; new row shows Disabled + draft |
| C — Builder publish dance | P0 | **PASS** (load-bearing) | add → publish → fork(deep-copy) → discard, all clean |
| D — Read view timeline + empty state | P0 | **PASS** | timeline + "manual launch" + empty-state copy |
| E — Active toggle + persistence | P1 | **PASS** | toggle persists across refresh + reflects on list row |
| F — Non-admin posture | P2 | **DEFERRED** (browser) → **COVERED** (contract) | UI skip; gate asserted in `playbooks-authz.test.ts` |

---

## Per-scenario detail

### A — Inngest endpoint registers + function visible — PASS
- `GET /api/inngest` → **HTTP 200** (no 500, no Next error page).
- Introspection body ([`01-inngest-handshake.txt`](01-inngest-handshake.txt)):
  `{"has_event_key":false,"has_signing_key":false,"function_count":1,"mode":"dev","schema_version":"2024-05-24"}`
- `function_count: 1` confirms the `sla-sweep-scheduled` function is registered against
  the serve handler.
- **Note:** the unauthenticated dev-mode introspection does **not** echo the function
  list/ids (only `function_count`), so this is a registry-count verification. The Inngest
  Dev Server step (`02-inngest-devserver-functions.png` in the briefing) was **not** run —
  it requires a separately-launched `inngest-cli dev` process; the registry handshake is
  sufficient to confirm the endpoint registers cleanly.

### B — /playbooks list page + create new — PASS
- List header renders ([`02`](02-playbooks-list-landed.png)); "New playbook" inline form
  ([`03`](03-new-playbook-inline-form.png)).
- Create navigates to `/virn/playbooks/<id>/builder`; empty-state copy verified verbatim:
  *"No steps yet. Add the first step to give this playbook a body."* ([`04`](04-builder-empty-state.png)).
- New row appears with **Disabled** + **draft** badges ([`05`](05-list-with-new-row.png)).
- **Delta (selectors):** the inline **Create** button collides with the global TopBar
  **Create** menu stub — the spec scopes it to `getByRole("main")`. (Known pattern: the
  TopBar Create menu is a stub; real wiring lives in page content.)

### C — Builder publish dance (LOAD-BEARING) — PASS
- add step 1 (Wait/duration) → add step 2 (Send notification) → **Publish** → header flips
  to **Published v1**, Publish/Discard disappear, **Edit** appears
  ([`06`](06-publish-disabled-empty.png) → [`10`](10-published-state.png)).
- **Edit** forks **Draft v2** and **deep-copies both v1 steps** (verified both type labels
  present in the fork) ([`11`](11-fork-draft-v2.png)) — D-018 snapshot contract holds.
- **Discard draft** returns cleanly to **Published v1** ([`12`](12-after-discard.png)).
- **Delta vs briefing (recommend amend the briefing):** the briefing's "click Publish on an
  empty playbook → `VERSION_HAS_NO_STEPS` toast" is **not reachable via the UI** — the
  Publish button is client-side `disabled` while `draftSteps.length === 0`
  ([PlaybookBuilderView.tsx:204](../../../apps/saas/modules/playbooks/components/PlaybookBuilderView.tsx#L204)).
  The spec asserts the **disabled** state instead. (The server precondition still exists for
  API callers; it's just not UI-reachable.)
- **Delta:** **Discard draft fires immediately** — no confirmation dialog (unlike the
  per-step delete, which uses `confirm()`).

### D — Read view renders the published timeline — PASS
- Empty-state on an unpublished playbook: *"This playbook hasn't been published yet."*
  ([`13`](13-read-empty-state.png)).
- Published timeline: **Published v1** chip, **Active/Disabled** badge,
  *"Triggers on `manual launch`"*, step cards **Step 01 / Step 02** with type-aware icons
  ([`14`](14-read-timeline.png)).
- **Open in Builder** navigates back to `/builder`.

### E — Active toggle + persistence — PASS
- Header switch (`aria-label="Enable playbook"`) flips Disabled → **Active**
  ([`15`](15-active-toggled.png)); persists across hard refresh
  ([`16`](16-active-after-refresh.png)); list row badge reflects **Active**
  ([`17`](17-list-active-badge.png)).
- **Note (cosmetic):** the header toggle label reads **"Enabled/Disabled"** while the badge
  beside it (and the list row badge) reads **"Active/Disabled"** — two labels for one flag.
  Harmless; flagged for consistency.

### F — Non-admin (builder) read-but-not-write posture — DEFERRED
- **Skipped in the spec.** The briefing sanctions this: *"If no non-admin account exists,
  skip + note in REPORT."*
- **Why deferred:** a freshly-seeded `builder`-role member cannot be driven through a
  deterministic browser session here. Even with `onboardingComplete = true`, the magic-link
  login does **not** resolve an **active** better-auth organization, so `/virn/playbooks`
  returns **404** in a personal-account context rather than rendering the org-scoped view.
  Establishing an activated org session for a seeded non-admin is out of scope for this slice.
- **Coverage is not lost:** the write-gate is enforced **server-side** — every mutating
  playbook procedure is an `adminOrgProcedure`
  (`create` / `publishVersion` / `editPublished` / `discardDraft` / `setActive` / `createStep`), and the
  page itself is gated by `assertCanSee(NAV_AREAS.playbooks)`. The UI affordances key off the
  same `snapshot.isAdminSuperset` value.
- **Now covered by a contract test** (added as a follow-up):
  [`packages/api/modules/playbooks/procedures/playbooks-authz.test.ts`](../../../packages/api/modules/playbooks/procedures/playbooks-authz.test.ts)
  — asserts UNAUTHORIZED with no session, FORBIDDEN for a `member` role across all six
  mutating procedures, and read access (`list`) for members. 8 tests, green.

---

## Console errors
None observed beyond benign dev noise (React DevTools hint, Fast Refresh / HMR logs).

## Recommend-amend summary
1. **Briefing (Scenario C):** change "click Publish → error toast" to "Publish button is
   **disabled** until ≥1 step" — matches the implementation.
2. **Briefing (Scenario C):** note Discard has **no confirm dialog**.
3. **UI (cosmetic) — DONE:** the Builder toggle label now reads **"Active/Disabled"** to
   match the status badges (was "Enabled/Disabled").
4. **Briefing (Scenario F) — DONE:** non-admin posture is now covered by the server-side
   authz contract test `playbooks-authz.test.ts` instead of a browser walkthrough.
