# Antigravity Briefing — Phase 12.1 + 12.2 Full-Stack Dogfood

**Repo:** `c:\Projects\Virn\virn-ops`
**Branch:** `main` (HEAD at the latest commit; everything in scope is already pushed)
**Date:** 2026-05-28

## What this is

We just shipped a multi-commit sequence widening the `due_type` palette
end-to-end and adding several correctness guards on top. The Phase 12.1
AI-authoring path also got some polish (chip on Library rows + Builder header).
Unit tests + type-check are clean, but most of this hasn't been touched in a
browser. We need to validate the end-to-end behaviors against a live DB and
the live Claude API.

There's a lot of surface here. The briefing is organized by user-facing
scenario, **tagged P0 / P1 / P2** so you can prioritize when running out of
time. Aim for all P0 scenarios; P1 if cycles remain; P2 is stretch.

## Goal

Validate that:

1. AI authoring still works end-to-end and can now emit workflows using the
   newly-widened dueType palette (offset_from_step + from_date_field).
2. The Builder's due-rule panel surfaces the right pickers, filters them
   correctly by step position, and refuses invalid configurations.
3. The runtime recompute hooks fire when they should and the right deadlines
   land on the right runSteps.
4. Server-side guards catch direct-API misconfigurations with structured
   errors.

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

Must be in `.env.local` as `ANTHROPIC_API_KEY`. If the dev server starts
without it, AI authoring will fail with `AI_AUTHORING_MODEL_ERROR`. **Don't
guess** — stop and report if you see that.

## Test plan

Save the spec at `apps/saas/tests/12-2-full-stack.spec.ts` following the
`getArtifactsDir` pattern used by `12-1-ai-authoring.spec.ts`. Output goes
under `docs/reviews/12-2-dogfood/`.

---

### P0 — A. AI authoring with the new dueType palette

**Scenario:** Verify the model can now author workflows using
`offset_from_step` and `from_date_field`, and that the resulting draft
materializes correctly.

1. From `/virn/library`, open the `+ Create` menu in the **page header** (NOT
   the global TopBar; see polish note from the prior dogfood — scope via
   `header.filter({hasText: "Library"})`).
2. Click "Author with AI…".
3. Submit this prompt (chosen specifically to exercise the new dueTypes):

   > "Build a move-in inspection workflow for property managers. The kickoff
   > should capture the move-in date. Then: schedule walkthrough (due 3 days
   > before move-in), inspect the unit (due the day before move-in), tenant
   > signs lease addendum (after walkthrough completes), and finally a manager
   > sign-off (due 1 day after the lease addendum step completes)."

4. Wait for generation to complete. Capture
   `01-ai-walkthrough-builder-landed.png` of the resulting Builder draft.
5. **Verify in the Builder:**
   - The workflow has a kickoff date field (probably named `move_in_date` or
     similar).
   - Multiple steps reference it. At least one step should have
     `dueType=from_date_field` with a negative offset (e.g., -3 days from
     move_in_date).
   - At least one step should have `dueType=offset_from_step` anchored on an
     earlier step.
   - In the step sidebar, the due-rule chip under each step title should read
     things like:
     - "due 1d after run starts" (offset_from_start, if any)
     - "due 1d before {{move_in_date}}" (from_date_field, negative)
     - "due 1d after Tenant signs lease addendum" (offset_from_step)
     - **NO chip** for steps with no due rule
6. Open the Step config panel for any from_date_field step. The source-field
   picker should show only kickoff date fields (and any earlier-step date
   fields if applicable). It should NOT show date fields from LATER steps.

**Report:**

- What did the AI actually generate? Paste title + section/step titles + the
  due rules visible in chips.
- Did the position-ordering filter work in the source-field picker?
- Any console errors / failed network calls during the build?

---

### P0 — B. Builder due-rule configuration

**Scenario:** Manually configure each dueType on a hand-authored workflow,
verify pickers + chip rendering.

1. Library → `+ Create` → "Workflow" (the regular hand-author path).
2. In the Builder, you'll land on a blank draft. Add three steps:
   - "Step A" (will be the anchor)
   - "Step B" (will use offset_from_step)
   - "Step C" (will use from_date_field sourcing a kickoff)
3. Add a kickoff field "arrival_date" of type `date`.
4. Open Step B's config panel:
   - Set dueType to "Days after another step completes". Capture
     `02-step-b-anchor-picker.png` showing the anchor dropdown.
   - The anchor dropdown should show **only Step A** (NOT Step B or Step C —
     Step C is later in position).
   - Pick Step A as the anchor, set offset to 2.
5. Open Step C's config panel:
   - Set dueType to "From a date field's value". Capture
     `03-step-c-source-picker.png` showing the date-field dropdown.
   - The dropdown should show **arrival_date (kickoff)**. It should NOT show
     date fields from later steps (there aren't any here, but check the
     "empty hint" path too — see scenario C below).
   - Pick arrival_date, set offset to -1 (1 day before arrival).
6. Verify the sidebar chips render under each step title:
   - Step A: no chip (dueType=none default)
   - Step B: "due 2d after Step A"
   - Step C: "due 1d before {{arrival_date}}"
7. Capture `04-sidebar-chips.png`.

**Edge cases to also exercise (same spec):**

8. On Step B, switch dueType to "Days after the run starts" (offset_from_start).
   Verify the anchor picker disappears, the offset input shows. Verify the
   chip changes to "due Nd after launch."
9. Switch back to offset_from_step. Verify the anchor selection was CLEARED
   (this is the normalize-duePatch behavior — companion fields zero-out on
   dueType change). The chip should read "due rule incomplete" until you
   re-pick an anchor.
10. Set Step B back to its earlier-step anchor. Try to clear the offset input
    by selecting it and pressing Backspace until empty. Verify it lands on 0
    (the empty-string-to-zero fix).

**Report:**

- Did the anchor picker correctly filter to earlier steps only?
- Did the source-field picker correctly filter date fields by position?
- Did the chips render with the expected text?
- Did the empty-input-clears-to-zero behavior work?

---

### P0 — C. Position-ordering refusal paths

**Scenario:** The Builder UI filters out later-step options so the user
typically can't reach a server refusal — but the server still enforces.
Trigger one via a stale-state scenario.

1. In a Builder draft, add steps "Foo" then "Bar". Add a date field
   `lease_start` to Foo.
2. Configure Bar's due rule: dueType=from_date_field, source=lease_start
   (Foo's field). Save by closing the panel.
3. Now drag-reorder so Bar is BEFORE Foo in position order. The drag is
   handled by RunStepList; verify it succeeds (the reorder endpoint doesn't
   re-validate due-rule consistency).
4. After reorder, open Bar's config panel. The source picker should now show
   the field as a stale/unavailable option (since Foo is now LATER than Bar).
5. Try to make ANY other change on Bar via the API (e.g., toggle "required").
   That update path may or may not re-trigger validation — capture what
   happens.

**Stretch:** Direct-call `workflows.updateStep` via curl/Playwright fetch
posting `{stepId: <Bar>, dueType: 'from_date_field', dueSourceFieldId:
<lease_start>}`. Should fail with `DUE_SOURCE_STEP_NOT_EARLIER`.

**Report:** Behavioral observations + the structured error if you can
provoke one. Capture
`05-position-reorder-stale-state.png`.

---

### P0 — D. Field-type change guard (FIELD_TYPE_CHANGE_LOCKED)

**Scenario:** Once a date field is referenced by a from_date_field due rule,
changing its type to text should be refused.

1. From scenario B (with arrival_date as the kickoff source for Step C's due
   rule):
2. Open arrival_date's field config panel.
3. Try to change its Type from `date` to `text`. The change should fail with
   an inline Alert reading "Type change refused -- clear these references
   first: step due-rule". Capture `06-field-type-locked.png`.
4. Now open Step C's config and change its dueType to `none` (clearing the
   reference).
5. Re-open arrival_date and try the type change again. Should succeed.

**Report:** Did the inline error render? Did clearing the reference unlock
the change?

---

### P1 — E. Runtime recompute (run engine)

**Scenario:** Launch a run from the workflow in scenario B, verify dueAt
resolution at launch + during step completion.

1. Publish the workflow from scenario B.
2. From `/virn/library`, click "Run" on the workflow row. Fill the kickoff
   form with `arrival_date = <2 weeks from today>` (you'll need to format as
   ISO date string).
3. Navigate to the run view (`/virn/runs/<runId>`).
4. **Verify in the run view:**
   - Step A: no due date (dueType=none)
   - Step B: **no due date** at launch (offset_from_step depends on Step A
     completion, deferred)
   - Step C: **due date is 1 day before arrival_date** (resolved at launch
     since source is a kickoff field)
5. Complete Step A as the assignee. Refresh the run view.
6. **Verify Step B now has a due date** = Step A's completion timestamp + 2
   days. The recompute hook fired during Step A's completion.
7. Capture `07-run-after-step-a-complete.png` showing Step B's dueAt rendered.

**Report:** Did dueAt land on the right rows at the right times? Any
timestamp drift from expected (the UTC fix in `addDays` should have
eliminated TZ shifts)?

---

### P1 — F. setFieldValue recompute (admin kickoff edit)

**Scenario:** Admin edits a kickoff date field post-launch; from_date_field
dependents should re-resolve.

1. From the run in scenario E (Step C should have a dueAt set from
   arrival_date).
2. As admin, edit the kickoff `arrival_date` via the UI (if available — this
   may require a dedicated kickoff-edit affordance; if the UI doesn't expose
   it, skip this scenario or use the API directly via `setFieldValue`).
3. **Verify Step C's dueAt updates** to reflect the new arrival_date.
4. Capture `08-kickoff-edit-recompute.png`.

**If no UI affordance exists for post-launch kickoff edits:** Mark this
scenario as "not exercised — no UI surface" and move on.

**Report:** Did the recompute fire? If you couldn't trigger it, note the
gap.

---

### P1 — G. Cascade-to-run-complete (the tx fix)

**Scenario:** Validate that completing the LAST required step in a run
correctly transitions the run to `completed` status. The pre-fix bug
silently left runs as `active` forever; the post-fix should cascade.

1. From a simple 2-step workflow (or use Step A → Step B with all the deps
   removed), launch a run.
2. Complete Step A.
3. Complete Step B.
4. **Verify the run.status === 'completed'** in the run header. Capture
   `09-run-completed.png` showing the "Completed" badge.

**This is the most important behavior validation in the whole briefing** —
if the cascade still fails to fire, the rest of the engine is unusable for
auto-completing runs.

**Report:** Did the run auto-complete? If not, what's the run.status after
the last step is done?

---

### P1 — H. AI chip rendering (Library + Builder header)

**Scenario:** Visual confirmation of the AI-authored markers.

1. From `/virn/library`, scroll to the workflow created in scenario A (the
   AI-authored one).
2. **Verify a small violet "AI" chip** appears next to the workflow type
   chip on its row. Hover reveals "This workflow was authored via AI…".
3. Click into the workflow → Builder header should show "AI-authored" chip
   next to the version status.
4. Capture `10-library-row-ai-chip.png` and `11-builder-header-ai-chip.png`.

---

### P2 — I. Server-side error paths via direct API

**Scenario:** Try to trigger each new error code directly to confirm the
structured error response shape.

Each below should be a fetch from inside the Playwright spec to the oRPC
endpoint with the malformed input. Don't worry about deep-linking these into
the UI — the goal is just to verify the API rejects with the right code +
message.

| Endpoint | Malformed input | Expected error code |
|---|---|---|
| `workflows.updateStep` | `{stepId, dueType: 'offset_from_step', dueAnchorStepId: <stepId>}` (self-anchor) | `DUE_ANCHOR_SELF_REFERENCE` |
| `workflows.updateStep` | `{stepId, dueType: 'offset_from_step', dueAnchorStepId: <later-step>}` | `DUE_ANCHOR_NOT_EARLIER` |
| `workflows.updateStep` | `{stepId, dueType: 'from_date_field', dueSourceFieldId: <text-field>}` | `DUE_SOURCE_FIELD_NOT_DATE` |
| `workflows.updateField` | `{fieldId: <referenced-date>, fieldType: 'text'}` | `FIELD_TYPE_CHANGE_LOCKED` |

Capture the error payloads if possible.

**Report:** Which codes fired correctly? Any 500s or unexpected shapes?

---

## Cleanup

The dogfood walkthroughs should clean up after themselves where reasonable.
The previous 12.1 spec deletes the workflow it created — copy that pattern.
For the manually-built workflows in scenarios B/C/D, delete them at the end
of the spec so subsequent runs start clean.

## What to report back

Single summary under 600 words covering:

1. **P0 status**: pass / partial / fail for each of A, B, C, D.
2. **P1 status**: pass / partial / fail / skipped for each of E, F, G, H.
3. **P2 status**: which API endpoints you exercised and what came back.
4. **Bugs found**: file path + line if you can pin it down. Tag severity
   (BLOCKER / HIGH / MEDIUM / LOW).
5. **UX surprises**: things that work but are weird.
6. **Things you couldn't test**: gaps with reason.

Don't lead with the prompt and output — the prompt is in this briefing
already; we know what we asked. Lead with the observations.

## What NOT to do

- **No commits.** Local changes need to come back to this Claude Code
  session for review.
- **Don't modify `.env.local`** or any config beyond what the test naturally
  needs.
- **Don't try to fix bugs you find** — capture and report. Fixes happen
  here.
- **Don't run `pnpm test`** or modify test infra beyond adding the new spec.
- If you discover a BLOCKER (e.g., run.status doesn't transition in scenario
  G), STOP and report rather than continuing through the lower-priority
  scenarios. The back-and-forth context is expensive.
