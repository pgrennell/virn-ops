# Antigravity Briefing — Phase 12 Re-Verification (12.1 + 12.2 + follow-ups)

**Repo:** `c:\Projects\Virn\virn-ops`
**Branch:** `main` (HEAD at the latest commit; everything in scope is pushed)
**Date:** 2026-05-29

## What this is

Phase 12.1 (AI authoring MVP) and Phase 12.2 (due-rule palette widening) both shipped
with full Antigravity dogfood verification on 2026-05-27 and 2026-05-28 respectively
(see `docs/reviews/12-1-dogfood/` and `docs/reviews/12-2-dogfood/`). Since then a
six-commit follow-up sequence has landed on top:

- `601dac0` agents.getAuthoringPrompt procedure + AuthoringPromptDialog wired into
  Builder/ReadView AI chips
- `d632805` LibraryRow AI chip wired into the same dialog
- `8485989` `entitySetHints` param on `agents.authorWorkflow` + dialog scope picker
- `587fa2e` `templateHintId` param + dialog template select (structural reference)
- `ef1b4e7` `templateMode` (`reference` | `adapt`) + TemplateModeRadio
- `0318ef9` Two-pane AI authoring review surface at
  `/library/workflows/[id]/builder?aiAuthored=1`

All compile, all unit tests green, none of it has been exercised in a browser. This
session has two goals: **(1)** re-run the existing 12.1 + 12.2 specs to prove the
follow-ups didn't regress prior behavior, and **(2)** verify each follow-up commit's
new behavior end-to-end against the live DB and the live Claude API.

The load-bearing scenario is the **two-pane review surface** (commit `0318ef9`). It
changes where AI-authored drafts land — if it's broken, users get dropped into a
half-rendered review view they can't escape from, and the regenerate-step path
(which is the riskiest of the new affordances, see [[D-040]]) is reachable only
through it.

## Goal

Validate that:

1. The existing `12-1-ai-authoring.spec.ts` and `12-2-full-stack.spec.ts` specs still
   pass green on current `main` (no regressions from the six follow-up commits).
2. The two-pane AI review surface renders correctly after AI generation, each
   per-step affordance (Accept/Edit/Regenerate) behaves as designed, and Finish
   review lands cleanly in the normal Builder.
3. The View-originating-prompt dialog opens from all three AI chip surfaces (Builder
   header, Read view header, Library row) with the correct content and copy
   affordances, and the cross-org isolation guard holds.
4. The `entitySetHints` param scopes the resulting workflow's `entity_set_ids`
   correctly, and invalid hint ids surface the structured error to the dialog.
5. The `templateHintId` + `templateMode` combination changes the structural shape of
   the AI's output as designed, and each new structured-error code (NO_PUBLISHED_VERSION,
   ADAPT_REQUIRES_HINT, cross-org NOT_FOUND) fires from the live API.

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

### Anthropic API key

Required for scenarios A (re-run includes AI calls), B (Regenerate exercises the
model), D (entitySetHints generation), and E (templateHintId generation). Must be
in `.env.local` as `ANTHROPIC_API_KEY`. If missing, the relevant Alert will surface
`AI_AUTHORING_MODEL_ERROR`; stop and report rather than guessing.

### Seed data

- The seeded `virn` org should have at least one entity set already (default STR
  scope from previous dogfooding). If it doesn't, create two quickly via
  `/virn/settings/general` → Entity Sets before scenario D.
- At least one published workflow needs to exist in the org for scenario E's template
  picker to have anything to show. The AI-authored workflow from scenario A's re-run
  will probably suffice; if not, publish one manually before E.

### Migrations

The 12.2 re-run report noted that cross-repo migrations 0012/0013/0014 had to be
applied to Neon mid-run last time. Check before starting:

```bash
pnpm --filter @virn/database migrate
```

If anything migrates, note it in the report and re-confirm the affected scenarios.

## Test plan

Save artifacts under `docs/reviews/phase-12-reverification-2026-05-29/` and the
spec at `apps/saas/tests/phase-12-reverification-2026-05-29.spec.ts` following the
existing `getArtifactsDir` pattern (see `12-2-full-stack.spec.ts`).

Tag scenarios **P0 / P1 / P2** to prioritize when running out of time. All
P0 first; P1 if cycles remain; P2 is stretch. Sequential screenshot naming
`01-`, `02-`, ... across all scenarios.

---

### P0 — A. Re-run existing Phase 12 specs (the floor)

**Scenario:** Confirm the prior dogfood specs still pass green on current `main`.
No new behavior tested here — this is the regression floor.

1. From the repo root, run both specs explicitly:

   ```bash
   cd c:/Projects/Virn/virn-ops/apps/saas
   pnpm exec playwright test tests/12-1-ai-authoring.spec.ts tests/12-2-full-stack.spec.ts --reporter=list
   ```

2. Capture the terminal output verbatim into the report (full pass/fail summary
   with timing).

3. If either spec fails:
   - **STOP** the rest of the briefing.
   - Capture the failure message + the failing step.
   - Report which of the six follow-up commits is most likely the regressor (file
     paths in the failure trace will give a strong hint).

**Capture:** `01-12-1-spec-output.txt` and `02-12-2-spec-output.txt` (paste the
two spec outputs into the report; no screenshots needed for this scenario).

**Verify:**
- Both specs PASS green.
- No new console errors introduced by the follow-ups (the specs already assert
  this).

**Report:**
- PASS/FAIL for each spec.
- Total runtime per spec (for drift detection — the 12-1 spec was 1.5min, the
  12-2 spec was 1.7min last time).
- Any new flakiness observed.

---

### P0 — B. Two-pane AI authoring review surface

**This is the load-bearing scenario for this briefing.** If the review surface is
broken or unrecoverable, the entire AI authoring path is degraded for end users.

**Scenario:** AI generation now redirects to `?aiAuthored=1` which renders the
two-pane review surface instead of the normal Builder. Verify the surface
renders correctly and each per-step affordance behaves as designed.

1. From `/virn/library`, open the page-header `+ Create` menu (NOT the global
   TopBar — scope via `header.filter({hasText: "Library"})` per the prior
   dogfood polish note).
2. Click "Author with AI…".
3. Submit this prompt:

   > "Build a guest-arrival prep workflow for a short-term rental: check the
   > smart lock code, stock toiletries, run the dishwasher, set the thermostat,
   > and final walk-through. Each step is a task with a photo and a note."

4. Wait for generation. The browser should navigate to
   `/virn/library/workflows/<id>/builder?aiAuthored=1` — NOT the bare `/builder`
   route. Capture `03-review-surface-landed.png` showing the full two-pane view.

5. **Verify the layout:**
   - Header: workflow title + "Reviewing AI draft" badge + model chip (e.g.
     "claude-sonnet-4-6") + "Finish review" primary button (top-right).
   - Left pane (~40% width on lg+): the original prompt rendered in a copyable
     block, optional source text (collapsed if empty), entity-schema snapshot
     (collapsible details). Left pane is sticky on wide viewports.
   - Right pane (~60% width on lg+): kickoff fields + sections + steps + step
     fields, all read-only. Each step row has three inline affordances:
     **Accept**, **Edit**, **Regenerate**.

6. **Per-step Accept:** Click "Accept" on one step. Capture
   `04-step-accepted.png`.
   - Verify the row's visual state changes to emerald/green-tinted.
   - This is local-only; no network call. A page reload should reset the state.

7. **Per-step Edit:** Click "Edit" on a different step.
   - Verify the URL changes to `/virn/library/workflows/<id>/builder#step-<id>`
     (the `?aiAuthored=1` flag is dropped).
   - Verify the normal Builder loads and scrolls to / focuses the step
     referenced by the hash. Capture `05-edit-jumped-to-step.png`.
   - Navigate back to the review surface for the next assertion:
     `/virn/library/workflows/<id>/builder?aiAuthored=1`.

8. **Per-step Regenerate:** Click "Regenerate" on a different step (NOT one you
   just Accepted).
   - Verify an inline textarea appears with a Submit button. Capture
     `06-regenerate-textarea-open.png`.
   - Type a refinement: "Make this step require manager approval instead of
     just a note."
   - Submit. Wait for the row to re-render (the dialog should NOT close — it
     stays inline; the step row's title/description update in place).
   - Capture `07-regenerate-step-after.png` showing the new step content.
   - Verify the workflow's other steps are NOT changed (this is the D-040
     sibling-isolation invariant — only the targeted step should mutate).
     Worth eyeballing the step titles before/after to confirm.

9. **Finish review:** Click the "Finish review" button in the header.
   - Verify navigation to `/virn/library/workflows/<id>/builder` (NO
     `?aiAuthored=1` flag).
   - Verify the normal Builder renders. Capture `08-finish-review-builder.png`.

10. **Stale link defensive state:** Pick a hand-authored workflow from the
    Library (one with no AI provenance — any workflow created via "+ Create →
    Workflow" qualifies). Navigate directly to
    `/virn/library/workflows/<that-id>/builder?aiAuthored=1`.
    - Verify the empty state renders with an "Open in Builder" CTA (not the
      two-pane view). Capture `09-stale-link-empty-state.png`.
    - Click the CTA. Verify it lands in the normal Builder.

**Verify:**
- Two-pane layout renders as described on a wide viewport.
- Accept is local-only and visually distinct.
- Edit drops the flag and lands at the right hash anchor.
- Regenerate mutates ONLY the targeted step (D-040 invariant holds).
- Finish review cleanly exits.
- Stale link path doesn't blow up; renders the empty state.

**Report:**
- PASS / PARTIAL / FAIL with notes on each numbered step above.
- If Regenerate affected sibling steps, **flag immediately** — that's a D-040
  regression and needs a stop-and-report.
- Any console errors during navigation transitions.

---

### P0 — C. View-originating-prompt dialog (three surfaces)

**Scenario:** The AI chip on the Builder header, Read view header, and Library
row should all open the same `AuthoringPromptDialog` showing the prompt that
produced the workflow.

1. **Builder surface:** Open the AI-authored workflow from scenario B in the
   normal Builder (`/virn/library/workflows/<id>/builder`).
   - Find the "AI-authored" chip near the version status in the header.
   - Click it. Capture `10-builder-prompt-dialog.png`.
   - Verify the dialog contains:
     - Model id (e.g. `claude-sonnet-4-6`) + author timestamp at the top.
     - The original prompt in a copyable code block (max-h-64; should scroll
       if long).
     - Source text section (collapsed by default; expand to verify it works).
     - Entity schema snapshot (collapsible details).
   - Click the Copy button on the prompt block. Verify clipboard has the prompt
     content (paste into a temporary location to confirm).
   - Close the dialog.

2. **Read view surface:** Navigate to the workflow's Read view —
   `/virn/library/workflows/<id>/read` (or via `/sop/<workflowId>` if the
   workflow is published; the Read view is the canonical read surface).
   - Find the inline AI chip in the read header. Click it.
   - Verify the same dialog opens with the same content. Capture
     `11-readview-prompt-dialog.png`.

3. **Library row surface:** Navigate back to `/virn/library`. Find the
   AI-authored workflow's row.
   - The small violet "AI" chip on the row should be CLICKABLE (not just
     decorative). Click it.
   - Verify the dialog opens. Capture `12-library-row-prompt-dialog.png`.
   - **Critical:** verify the URL did NOT change. The row itself navigates to
     the workflow when clicked; the chip's stopPropagation must prevent the
     row click from firing simultaneously. If the URL changed to the
     workflow's detail page AND the dialog opened, that's the race condition
     d632805's stopPropagation was meant to prevent — report it.

4. **SOP index chip is intentionally non-clickable:** Navigate to `/sop`. Find
   the same AI-authored workflow if it's published (or any AI workflow in
   the org).
   - The "AI" chip on the SOP row should appear but should NOT be clickable
     (it's decorative on this surface per d632805's commit message). The row
     itself is the anchor; clicking anywhere on the row should open the SOP
     read view.
   - This is the documented decision — confirm it holds, don't flag as a bug.
     Capture `13-sop-chip-not-clickable.png` (just for record).

5. **Cross-org isolation guard (direct API):** Inside the Playwright spec,
   take a known promptId from a foreign org (you'll need a second org in the
   DB, or construct an obviously-foreign cuid). Fetch
   `/api/rpc/agents/getAuthoringPrompt?input=<encoded-foreign-id>`.
   - Expect HTTP 404 with structured error code `NOT_FOUND` (NOT a 500 leaking
     internals, NOT a row returned).

**Verify:**
- Same dialog component opens from all three clickable surfaces (Builder, Read
  view, Library row).
- Dialog content matches expected shape.
- Copy buttons functional.
- Library row click doesn't navigate the underlying row.
- SOP chip is decoration only (no click handler).
- Cross-org fetch returns NOT_FOUND, not 500 / not row data.

**Report:**
- PASS / PARTIAL / FAIL on each surface.
- Any layout drift between the three surfaces (the dialog should look identical
  from each entry point).
- Whether the cross-org guard returned the correct shape.

---

### P1 — D. entitySetHints scopes the generated workflow

**Scenario:** The AI dialog has a new "Scope to entity sets" collapsible. Picking
sets should cause the resulting workflow to have `entity_set_ids` populated, which
narrows the Launch dialog's `listForEntity` filter.

1. Library → `+ Create` → "Author with AI…".
2. Expand "Scope to entity sets". Capture `14-dialog-scope-picker-open.png`.
3. Select 1-2 entity sets from the chip multi-select. Verify the summary line
   updates with the selected count (e.g. "Scope: 2 sets").
4. Submit this prompt: "Build a quick weekly safety check for these properties:
   check smoke detectors and replace batteries if needed."
5. Wait for generation (lands on the review surface — fine, that's covered in
   scenario B; here we care about post-generation DB state).
6. Click "Finish review" to land in the Builder.
7. Open the workflow's Configure panel (or check the Library row's entity-set
   chips). **Verify the workflow's `entity_set_ids` matches the picked sets.**
   Capture `15-workflow-entity-sets-applied.png`.

8. **Validation guard (direct API):** Inside the Playwright spec, call
   `agents.authorWorkflow` with `entitySetHints: [<bogus-cuid>]`:
   - Expect BAD_REQUEST with `data.code = AI_AUTHORING_INVALID_ENTITY_SET_HINTS`
     + an `unknownIds` array.
9. Repeat with a known foreign-org entity set id:
   - Expect the same structured error (cross-org should be treated as
     not-found, same as scenario C's pattern).

**Verify:**
- Picker renders + selection state visible in summary.
- Generated workflow has `entity_set_ids` matching the picked sets.
- Invalid + cross-org hints both reject with the correct structured error code.

**Report:** PASS / PARTIAL / FAIL with notes. Paste the structured error JSON
for the API guard checks.

---

### P1 — E. templateHintId + templateMode (combined)

**Scenario:** Picking a template biases the AI's structural output; the
templateMode toggle changes how strictly the template is followed.

1. **Pre-req:** Ensure at least one published workflow exists in the org. The
   workflow created in scenario A's 12-1 re-run probably qualifies; if not,
   manually publish one.
2. Library → `+ Create` → "Author with AI…".
3. Expand "Start from a template". Capture
   `16-dialog-template-picker-open.png`. Verify the select lists published
   workflows (procedures/forms only — documents/policies are filtered out).
4. Pick a template. Verify a "Picked" badge appears in the summary line, and
   the **TemplateModeRadio** appears with two options:
   - "Use as reference" (default, selected)
   - "Adapt this template"
   Capture `17-template-mode-radio.png`.

5. **Reference mode test:** Leave on "Use as reference". Submit a prompt like
   "Same shape but for a different unit type — convert to a commercial-office
   tenant check-in." Wait for generation.
   - In the resulting draft, verify the AI restructured the workflow rather
     than copying step-for-step. Steps may be renamed, reorganized, or
     replaced — that's expected. Capture `18-reference-mode-result.png`.

6. **Adapt mode test:** Repeat with a fresh dialog. Pick the same template.
   Switch to "Adapt this template". Submit "this turnover, but skip the
   kitchen check step."
   - In the result, verify the structure largely matches the template MINUS
     the kitchen step (or that step modified). Other steps should remain
     intact in title and ordering. Capture `19-adapt-mode-result.png`.
   - **Note:** AI output is non-deterministic. The qualitative claim is
     "adapt preserves more than reference does." If the two outputs look
     equally restructured, flag as a model-fidelity concern rather than a
     spec failure.

7. **Validation guards (direct API):** Inside the Playwright spec, call
   `agents.authorWorkflow` with each malformed input:

   | Input | Expected error code |
   |---|---|
   | `templateHintId: <foreign-org-workflow-id>` | `NOT_FOUND` |
   | `templateHintId: <draft-workflow-id-no-published-version>` | `NO_PUBLISHED_VERSION` |
   | `templateMode: 'adapt'`, no `templateHintId` | `AI_AUTHORING_TEMPLATE_MODE_REQUIRES_HINT` |
   | `templateMode: 'reference'`, no `templateHintId` | (accepted — no error; this is the default no-op state) |

**Verify:**
- Template picker filters to published procedures/forms.
- TemplateModeRadio only appears when a template is picked.
- Reference vs Adapt produce qualitatively different output shapes.
- All four validation guards behave as tabled.

**Report:** PASS / PARTIAL / FAIL with notes. For the qualitative reference-vs-adapt
test, paste the step titles from each output so we can sanity-check the
divergence.

---

### P2 — F. Structured error code shape (consolidated)

**Scenario:** Confirm the new structured error codes all return the correct
shape from the live API. Some are repeats of D/E above — this scenario is a
consolidation check, useful if D/E weren't fully exercised.

Inside the Playwright spec, fetch each endpoint with the malformed input.
Don't worry about deep-linking these into the UI — the goal is to verify the
API rejects with the right code + message.

| Endpoint | Malformed input | Expected code |
|---|---|---|
| `agents.getAuthoringPrompt` | foreign-org promptId | `NOT_FOUND` |
| `agents.authorWorkflow` | `entitySetHints: [<bogus-cuid>]` | `AI_AUTHORING_INVALID_ENTITY_SET_HINTS` |
| `agents.authorWorkflow` | `templateHintId: <foreign-workflow>` | `NOT_FOUND` |
| `agents.authorWorkflow` | `templateHintId: <unpublished-workflow>` | `NO_PUBLISHED_VERSION` |
| `agents.authorWorkflow` | `templateMode: 'adapt'`, no `templateHintId` | `AI_AUTHORING_TEMPLATE_MODE_REQUIRES_HINT` |

Capture the error payloads if possible. The expected shape is the same as
prior structured errors (TRPC-style with `data.code`).

**Report:** Which codes fired correctly? Any 500s or unexpected shapes?
Capture `20-error-payload-sample.png` showing one of the captured payloads
(devtools network tab is fine).

---

## Cleanup

The dogfood walkthroughs should clean up after themselves where reasonable.
The prior 12-1 and 12-2 specs delete the workflows they create — copy that
pattern. Anything the re-run creates (scenario A) is handled by the prior
specs' cleanup; only scenarios B, D, E need to clean up their own created
workflows.

## What to send back

A single markdown report at
`docs/reviews/phase-12-reverification-2026-05-29/REPORT.md` with:

- **Per-scenario verdict** (PASS / PARTIAL / FAIL) for A through F.
- **The P0 — B verdict is load-bearing.** If the two-pane review surface
  doesn't render, doesn't navigate cleanly, or Regenerate mutates sibling
  steps, report immediately.
- **Any console errors** observed (paste verbatim, including stack).
- **Specific reproductions** for anything that didn't behave as described.
- **"Recommend amend"** markers on anything cheaper to patch than to fully
  verify (e.g. a tooltip wording tweak vs. re-running the whole spec).
- **For scenario E (Adapt vs Reference):** paste the step titles from each
  output so we can qualitatively sanity-check the divergence.

The relevant HEAD commits to cite findings against:

- `0318ef9` two-pane AI authoring review surface (load-bearing)
- `ef1b4e7` templateMode adapt vs reference (Phase 12 follow-up slice C)
- `587fa2e` templateHintId structural reference (Phase 12 follow-up slice B)
- `8485989` entitySetHints on agents.authorWorkflow
- `d632805` LibraryRow AI chip opens View originating prompt dialog
- `601dac0` View originating prompt dialog on AI chips

---

## Kickoff prompt (paste this to Antigravity)

```
I need browser-driven re-verification of Phase 12 (12.1 AI authoring + 12.2
due-rule palette + six follow-up commits adding the originating-prompt dialog,
entitySetHints, templateHintId, templateMode, and the two-pane review surface).

The full self-contained briefing is at:

  c:\Projects\Virn\virn-ops\docs\reviews\phase-12-reverification-2026-05-29\ANTIGRAVITY_BRIEFING.md

Read it first — it has prerequisites (dev server, magic-link auth, ANTHROPIC_API_KEY,
seed-data requirements, migrations), tagged scenarios (P0/P1/P2), capture targets,
and per-scenario reporting expectations.

Priorities: all P0 first, then P1 if cycles remain, P2 stretch.

P0 — B (two-pane AI authoring review surface) is the one that matters most: if
Regenerate mutates sibling steps that's a D-040 regression and you should STOP
and report immediately. If the surface doesn't render or strands the user, also
stop and report.

Save artifacts under `docs/reviews/phase-12-reverification-2026-05-29/` and
write the report at
`docs/reviews/phase-12-reverification-2026-05-29/REPORT.md` — per-scenario
verdict (PASS / PARTIAL / FAIL), screenshots linked by filename, console
errors verbatim, "recommend amend" markers on anything cheaper to patch than
to fully verify.

The relevant HEAD commits are listed at the bottom of the briefing. Repo is
on the `main` branch and up to date.

If any prerequisite fails (port 3000 taken, ANTHROPIC_API_KEY missing,
magic-link not landing, migrations out of sync) — STOP and report rather
than guessing. The briefing flags the known landmines in its Prerequisites
section.

What NOT to do:
- Don't commit. Local changes come back to this Claude Code session for review.
- Don't modify .env.local or settings beyond what tests naturally need.
- Don't try to fix bugs you find — capture and report.
- Don't run `pnpm test` or modify test infra beyond adding the new spec.
```
