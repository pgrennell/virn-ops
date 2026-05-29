# Antigravity Briefing — `agents.regenerateStep` (D-040 Operationalization)

**Repo:** `c:\Projects\Virn\virn-ops`
**Branch:** `main` (HEAD at the latest commit; everything in scope is pushed)
**Date:** 2026-05-29

## What this is

We just shipped the procedure that operationalizes D-040's per-step
regeneration contract end-to-end:

- **Backend** (`592c0cc`): `agents.regenerateStep` on the agents router. Calls
  Claude with the target step's content + AI-generated sibling context;
  manually_edited siblings are abstracted as opaque
  `[manually-edited step at position N]` placeholders so the model literally
  cannot read or reference their content. Replaces the target step in place
  (title, description, fields) and flips `step.provenance` to `'ai_generated'`.
- **UI** (`7ed368d`): "Regenerate with AI" section on the StepConfigForm
  slide-in panel. Optional refinement textarea (up to 2000 chars), Sparkles
  primary button, warning Alert when the target is already `manually_edited`,
  per-call error surface.

The "AI" chip from the previous Antigravity session is no longer decorative
— it now flags exactly the rows that this Regenerate button will safely
overwrite. The same button must refuse (by construction of the prompt body)
to touch any sibling with a different provenance.

Unit tests (403 passing) cover the contract refusals + audit shape +
prompt-body sibling isolation. But **the live model call hasn't been
exercised end-to-end through the UI**, and the most load-bearing claim of
D-040 — that an AI regenerate of step N can't see or affect manually-edited
sibling content — needs visual confirmation against a real Claude response.

## Goal

Validate that:

1. The Regenerate button on a `StepConfigForm` actually invokes the procedure
   and the target step's content updates in place.
2. The optional refinement prompt steers the model output (short, specific
   refinement produces an observably different regeneration than no
   refinement).
3. **The D-040 sibling-isolation invariant holds.** Manually-edited siblings
   are NOT touched and their content is NOT reflected in the regenerated
   target step (the model can't see them).
4. The provenance UI is honest: chip behavior after regenerate matches the
   provenance flip semantics from D-040.
5. Field replacement works: the target step's old fields are gone after
   regenerate; the new fields appear with sensible labels/types.
6. Error paths surface cleanly: model error / bad output / cross-org refusals
   all reach the form's error Alert without spinning forever.

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

**Required for every scenario in this briefing** — there's no useful
non-AI path. Must be in `.env.local` as `ANTHROPIC_API_KEY`. If missing, the
regenerate UI's Alert will surface `AI_AUTHORING_MODEL_ERROR`; stop and
report rather than guessing.

### A workflow with AI-authored steps

Most scenarios start from a workflow that has multiple `ai_generated` steps
because that's the only state where the regenerate affordance and sibling
isolation matter. Pack-installed workflows (STR Turnover, Property
Inspection, Maintenance Routing) are all `manually_edited` by default
(default column value; pack install path doesn't pass `provenance`), so
they don't exercise sibling isolation cleanly.

Author a fresh workflow at the start of each scenario that needs one,
following the same pattern the prior briefing used:

1. `/virn/library` → page-header `+ Create` → "Author with AI…"
2. Prompt: *"Build a 5-step move-in inspection workflow: schedule
   walkthrough, walk the unit, document issues, send tenant lease
   addendum, manager sign-off."*
3. After the draft lands in the Builder, every step should carry the "AI"
   chip — confirms `ai_generated` provenance.

## Test plan

Save artifacts under `docs/reviews/agents-regenerate-step-2026-05-29/` and
the spec at `apps/saas/tests/agents-regenerate-step-2026-05-29.spec.ts`
following the existing `getArtifactsDir` pattern.

Tag scenarios **P0 / P1 / P2** to prioritize when running out of time. All
P0 first; P1 if cycles remain; P2 is stretch.

---

### P0 — A. Backend happy path: regenerate updates the target step

**Scenario:** Confirm the procedure-to-UI loop works end-to-end against a
live Claude call.

1. Author a fresh workflow (see Prerequisites). Note the **third** step's
   title and description verbatim — that's the regenerate target.
2. Click the third step in the rail to open `StepConfigForm`.
3. Scroll to the "Regenerate with AI" section at the bottom of the panel.
4. **Capture:** `01-regenerate-section-fresh.png` showing the section in
   its default state (no refinement entered, no warning Alert because the
   step is `ai_generated`).
5. Leave the refinement textarea empty. Click **Regenerate**.
6. Verify the button flips to "Regenerating…" and disables for the duration.
7. Wait for the spinner to clear (usually 5-15s for a single-step regen).
8. **Capture:** `02-regenerate-step-updated.png` showing the rail (the
   third step's title should now differ from what you noted in step 1) and
   the StepConfigForm (description should also differ, fields list may have
   different entries).
9. **Verify the "AI" chip is still present** on the regenerated step's row
   in the rail (it was `ai_generated` going in; the regenerate keeps it
   that way).

**Report:**

- Did the third step's title and description noticeably change? Paste the
  before/after if possible.
- Did the field list change? (Count + spot the labels.)
- Total elapsed time from click → spinner clear (rough is fine).
- Any console errors or 4xx/5xx in network tab during the regenerate?
- Did the AI chip stay on the row?

---

### P0 — B. D-040 sibling-isolation invariant (the load-bearing claim)

**Scenario:** Confirm a manually-edited sibling is invisible to a regenerate
call on a different step. This is the single most important verification in
this briefing — if it fails, D-040 isn't actually being enforced and the
trust contract is broken.

1. Author a fresh workflow.
2. **Manually edit step 2's title** to something distinctive and
   easy-to-grep: e.g. *"Frobnicate the bunglesphere"*. Save (click out, or
   press Enter). Verify the "AI" chip disappears from step 2's rail row
   (provenance flipped to `manually_edited` per `c3879e4`).
3. **Capture:** `03-manually-edited-sibling-no-chip.png` showing step 2
   without the chip, siblings with theirs.
4. Click step 1. In the Regenerate section's refinement textarea, enter:

   > *"Make this step's description reference what step 2 does in detail."*

   This is a stress test — we're explicitly asking the AI to do something it
   *cannot do* because the model literally cannot see step 2's content.
5. Click Regenerate.
6. After the spinner clears, **read step 1's regenerated description
   carefully**.
7. **Capture:** `04-step1-regenerated-cannot-see-step2.png` showing the
   regenerated step 1.

**Verification criteria:**

- Step 1's new description must NOT contain the string "Frobnicate" or
  "bunglesphere" or any close paraphrase that could only come from reading
  step 2's content.
- Step 2's title must still read "Frobnicate the bunglesphere" — the
  regenerate must not have touched it. Same for step 2's description and
  fields.
- The model SHOULD acknowledge the constraint somehow in the regenerated
  description (e.g. "coordinate with the next step" instead of naming what
  the next step does) — this is a soft signal that the prompt successfully
  abstracted the manually-edited sibling. NOT a hard requirement; the
  model's exact phrasing is non-deterministic.

**Report:**

- Paste step 1's regenerated description verbatim.
- Confirm step 2's content (title + description + fields) is unchanged from
  your manual edit.
- Did the regenerated step 1 reference any verbatim content from step 2?
  (This is the failure mode — if YES, D-040 is broken end-to-end.)
- Did the model handle the impossible refinement gracefully (acknowledged
  the constraint) or did it hallucinate content (which would be a
  prompt-clarity concern even though the data is safe)?

---

### P0 — C. Provenance flip + warning Alert

**Scenario:** Regenerating a manually-edited step shows a clear warning,
then on regenerate the provenance flips back to ai_generated.

1. Author a fresh workflow.
2. **Manually edit step 1's title** to a distinctive value. Verify the AI
   chip disappears from step 1.
3. Click step 1 to open `StepConfigForm`. Scroll to Regenerate section.
4. **Capture:** `05-regenerate-with-warning.png` — verify a yellow/orange
   Alert appears above the refinement textarea explaining "This step is
   marked manually edited. Regenerating will overwrite your changes and
   flip it back to AI-generated. Subsequent edits will flip it back to
   manually edited again."
5. Click Regenerate anyway (no refinement).
6. After the spinner clears, **the AI chip should reappear** on step 1's
   row in the rail (provenance is now `ai_generated` again).
7. **Capture:** `06-after-regenerate-chip-reappeared.png` showing step 1
   with the AI chip back.
8. Now **manually edit step 1's title again** (just append "(edited)" to
   what the AI produced).
9. Verify the chip disappears AGAIN (flip-back rule from D-040).
10. **Capture:** `07-manual-edit-after-regenerate-chip-gone.png`.

**Report:**

- Did the warning Alert render with the right copy?
- After regenerate, did the AI chip come back?
- After a subsequent manual edit, did the chip go away again?
- Any rendering issues on the warning Alert (color contrast, copy
  truncation)?

---

### P1 — D. Field replacement: old fields gone, new fields appear

**Scenario:** Confirm the target step's field list is fully replaced by the
regeneration, not just augmented.

1. Author a fresh workflow that includes a step with multiple fields. Use a
   prompt like: *"Build a kitchen inspection step with three fields: a
   textarea for notes, a multiselect for appliance status (working /
   needs-repair / broken), and a file upload for photos."* (If that lands
   as multiple steps, just pick one with multiple fields.)
2. Note the step's current fields (labels + types).
3. **Capture:** `08-step-fields-before-regenerate.png` showing the step's
   field list in the StepConfigForm (or wherever fields are visible —
   may require a side scroll).
4. Click Regenerate with a refinement that should change the field set:
   *"Drop the appliance-status field; add a number field for water
   pressure (PSI) instead."*
5. After the spinner clears, **verify the field list reflects the
   refinement**: appliance-status should be gone, water-pressure number
   field should appear, the other original fields likely still in some form
   (the model may rename them but they should be present in spirit).
6. **Capture:** `09-step-fields-after-regenerate.png`.

**Report:**

- Field count before / after.
- Were the AI's choices consistent with the refinement prompt?
- Did the model respect the keep / drop / add instructions? Or did it
  overshoot (rewrote everything) or undershoot (only added)?
- Were the new fields' key slugs sensible (lowercase + underscores per
  D-017)?

---

### P1 — E. Error path: malformed refinement (or other model edge case)

**Scenario:** Verify the error Alert surfaces cleanly when the model
returns something the validator rejects.

This is hard to trigger deterministically without instrumenting the SDK; a
reasonable proxy is to send a refinement that's likely to push the model
into emitting cross-step refs (regenerate scope explicitly rejects these):

1. Author a fresh workflow with multiple steps.
2. Click any step. Refinement prompt:
   *"Make this step due 2 days after the previous step completes."* — this
   is asking for `dueType: 'offset_from_step'`, which the regenerate
   contract refuses.
3. Click Regenerate.

**Expected outcomes (one of):**

- **Server rejection (P1 PASS):** Error Alert appears under the button with
  text mentioning the refusal (e.g. "Regenerate cannot emit cross-step due
  rules" or similar). Status code 400 in network tab. The step is
  unchanged.
- **Model self-corrected (P1 PARTIAL):** The model read the system contract
  addendum, ignored the refinement, and emitted a valid step. Step changes
  in some way but no Alert appears. This is acceptable behavior; report it.

4. **Capture:** `10-error-alert-cross-step-rule.png` if the error path
   triggered; otherwise capture the result with a note that the model
   self-corrected.

**Report:**

- Which outcome happened? (rejection / self-correction)
- If rejection: did the Alert text make sense to a property-ops admin who
  doesn't know the source code?
- If self-correction: does the regenerated step have any artifact of the
  refusal (e.g. a `dueType: 'offset_from_start'` instead)?

---

### P2 — F. Audit row inspection

**Scenario:** Confirm the audit_log row gets written with the right shape.

1. After running at least one P0 scenario, query the database directly (any
   psql session or the dev DB UI):

```sql
SELECT action, entity_id, changes, metadata, created_at
FROM audit_log
WHERE action = 'step.ai_regenerated'
ORDER BY created_at DESC
LIMIT 5;
```

2. Verify the `changes` jsonb contains: `previousTitle`, `newTitle`,
   `fieldCountBefore`, `fieldCountAfter`, `model`, `aiAuthoringPromptId`,
   `hadRefinementPrompt`.
3. Verify the `metadata` jsonb contains: `workflowVersionId`,
   `aiAuthoringPromptId`.

**Capture:** `11-audit-log-regenerate-row.png` of the query result (or
paste the row JSON into the report).

**Report:**

- Did the row appear after each regenerate invocation?
- Are all the documented fields present?
- Anything unexpected (extra fields, missing fields, wrong types)?

---

### P2 — G. Activity feed surface (if accessible)

**Scenario:** If there's a visible activity feed for the workflow or the
run, check whether the `step.ai_regenerated` event shows up reasonably.

In v1.5a / Phase 9.5 this is the audit/activity surface that the timeline
on the workflow detail page reads from (per the existing `activity_event`
emissions). If a visible activity feed exists at the workflow level, the
regenerate event should appear there with the operator's name and the new
title.

Skip if there's no such surface yet in the dev build.

---

## What to send back

A single markdown report at
`docs/reviews/agents-regenerate-step-2026-05-29/REPORT.md` with:

- **Per-scenario verdict** (PASS / FAIL / PARTIAL) with the captured
  screenshots linked by filename.
- **The P0 — B verdict is load-bearing.** If the model regenerated step 1
  with verbatim content from manually-edited step 2, that's a P0 FAIL on
  the most critical claim of D-040 and we need to know immediately.
- **Any console errors** observed (paste verbatim, including stack).
- **Specific reproductions** for anything that didn't behave as described.
- **"Recommend amend"** markers on anything cheaper to patch than to
  fully verify.

The relevant HEAD commits to cite findings against:

- `592c0cc` agents.regenerateStep procedure + lib + prompt composers +
  error codes + 12 tests
- `7ed368d` Regenerate-with-AI UI affordance on the StepConfigForm
- `c3879e4` provenance "AI" chip on step cards (already-verified prior
  briefing; relevant here because the chip is the visible output of the
  regenerate)
- `acaa8a8` D-040 step.provenance enum + column + write-path threading
