# Antigravity Briefing — Workflow Assistant Right-Rail Chat Panel (G9 / PRD §6.3 R1)

**Repo:** `c:\Projects\Virn\virn-ops`
**Branch:** `main` (HEAD at the latest commit; everything in scope is pushed)
**Date:** 2026-05-29

## What this is

Just shipped (commit `6987ce7`) the persistent right-rail Workflow Assistant
chat panel — the third column of the tri-column author shell promised by
PRD G9 / §6.3 R1. The panel takes free-text instructions like *"make step 3
terser"* and dispatches to the **same** `agents.regenerateStep` procedure
the per-step Regenerate button uses (which was independently verified in
the prior briefing at `docs/reviews/agents-regenerate-step-2026-05-29/`).

D-040 sibling isolation is already verified end-to-end against a live
Claude call at the procedure layer — that's not what this briefing is
about. **The load-bearing claim here is the natural-language step
resolver:** if "step 3" resolves to step 4, the operator clicks Send
expecting one outcome and gets a regenerate of a different step. That's
the high-trust-loss failure mode unique to this invocation surface.

The parser at `apps/saas/modules/builder/lib/workflow-assistant-parser.ts`
has 18 unit tests covering each reference form (numeric, ordinal, quoted,
implicit) + ambiguity detection + refusal paths. But unit tests run
against synthetic step shapes; we need a browser pass against a real
authored workflow to confirm:

1. The resolution works against a live workflow rendered in the rail.
2. The chat invoke surface composes correctly with the same regenerate
   mutation the per-step button uses (no race, no double-fire).
3. The layout holds — adding a third column to an already-busy shell is a
   real regression risk on narrower viewports.

## Goal

Validate that:

1. The tri-column author shell layout (left rail · center pane · right
   rail) renders without overflow or column-collapse at the viewport
   width the dev server defaults to (1440px or whatever the default
   browser opens at).
2. The greeting message renders on first paint and the composer is
   keyboard-focusable.
3. Each natural-language step reference form ("step N", "the Nth step",
   "the last step", `"exact title"`, "this step" + active selection)
   resolves to the **correct** step before regenerating.
4. The end-to-end happy path (parse → dispatch → pending → success
   message → step content updated) works against a live Claude call.
5. Refusal paths (empty / question / ambiguous / no-target) surface
   non-destructive inline messages — the panel never silently no-ops
   and never crashes.
6. The pending-state UX disables the Send button + composer correctly
   and re-enables after completion.

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

Required for scenarios B, C, E, G (everything that actually invokes the
regenerate). Must be in `.env.local` as `ANTHROPIC_API_KEY`. If missing,
the chat panel will surface an error in the assistant message; stop and
report rather than guessing.

### A fresh AI-authored workflow with at least 5 steps

Most scenarios need a workflow with several known-titled steps so we can
exercise each reference form. Pack-installed workflows work too if their
step titles are stable — but the operator-facing chat experience is what
we're verifying, so authoring fresh is closer to a real session.

Author at the start of the run via the same path the prior briefing used:

1. `/virn/library` → page-header `+ Create` → "Author with AI…"
2. Prompt: *"Build a 5-step move-in inspection workflow: schedule
   walkthrough, walk the unit, document issues, send tenant lease
   addendum, manager sign-off."*
3. After the draft lands in the Builder, all 5 steps should carry the
   "AI" chip. Note each step's exact title (you'll reference them by
   quote in scenario C).

## Test plan

Save artifacts under `docs/reviews/workflow-assistant-2026-05-29/` and the
spec at `apps/saas/tests/workflow-assistant-2026-05-29.spec.ts` following
the existing `getArtifactsDir` pattern.

Tag scenarios **P0 / P1 / P2** to prioritize when running out of time. All
P0 first; P1 if cycles remain; P2 is stretch.

---

### P0 — A. Tri-column author shell renders

**Scenario:** Open the Builder in author mode; verify all three columns
are visible and don't overflow.

1. Author a fresh workflow (see Prerequisites).
2. Wait for the Builder to land in author mode (drafts default here).
3. **Capture:** `01-tri-column-shell.png` of the full Author shell. The
   image should show:
   - **Left rail** (w-64): KickoffRailEntry + step list + Template
     Variables sidebar pinned at the bottom-left.
   - **Center** (flex-1): step config pane or RunStepPanel.
   - **Right rail** (w-80): Workflow Assistant header ("Workflow
     Assistant · Refine any step with AI · D-040 safe"), greeting
     message, composer textarea at the bottom.
4. Verify the greeting message renders the D-040 callout verbatim:
   *"...I leave any step you've manually edited untouched (D-040)."*
5. Resize the viewport narrower (try ~1280px width). The three columns
   should still be visible; the center pane shrinks but doesn't break.

**Report:**

- Layout intact at default viewport + 1280px?
- Greeting message renders correctly?
- Composer focusable (click into it, see the focus ring)?
- Any console errors on first paint?

---

### P0 — B. Natural-language step resolution + end-to-end regenerate (happy path)

**Scenario:** Send the simplest possible reference; verify dispatch + UI
flow + actual step update.

1. With the freshly-authored workflow open, click into the chat composer.
2. Type: `make step 3 terser` and press Enter.
3. **Capture:** `02-pending-message.png` showing the user message
   right-aligned and the pending assistant message ("Regenerating
   'Document issues'…" or whatever step 3 is titled).
4. Wait for the regenerate (5-15s).
5. **Capture:** `03-success-message.png` showing the green success
   message ("Updated step: 'Before title' → 'After title'.").
6. Verify in the **left rail**: step 3's title should now read the new
   one (matches what the success message named).

**Report:**

- Did the user message appear right-aligned and styled (primary bg)?
- Did the pending message appear immediately + look italic / muted?
- Did the success message replace the pending one in place (not append a
  duplicate)?
- Did step 3's rail title actually change?
- Any console errors or 4xx during the regenerate?

---

### P0 — C. Resolution form coverage — load-bearing scenario

**This is the load-bearing scenario for this briefing.** A misresolution
here means the chat surface regenerates the wrong step — silent data loss
on a row the operator didn't intend to touch.

For each form below, send the chat message and **before clicking Send**
note which step you expect to be regenerated. After dispatch, verify only
that step's title changes.

For this scenario, **manually edit one step** between rounds so you can
visually confirm which steps were/weren't touched (their AI chip presence
discriminates). Or just inspect titles after each send and confirm only
one changed.

1. **Numeric:** `regenerate step 2 to use SMS instead of email` → expect
   step 2 (position 1) only.
2. **Ordinal mid:** `make the third step a single sentence` → expect
   step 3 (position 2) only.
3. **Ordinal terminal:** `make the last step a final approval gate`
   → expect step 5 (position 4) only.
4. **Quoted exact title:** *(use one of your workflow's actual step
   titles, e.g.)* `"Schedule cleaning" should mention the housekeeper`
   → expect that specific step only.
5. **Implicit + active selection:** Click step 4 in the left rail to
   select it; type `make this step optional` and Send → expect step 4
   only.

**Capture:** `04-resolution-numeric.png`, `05-resolution-ordinal.png`,
`06-resolution-quoted.png`, `07-resolution-implicit.png` — at least one
screenshot per resolution form showing the success message naming the
correct target step.

**Report:**

- Per resolution form: PASS / FAIL with the resolved step title from the
  success message + verification that no other step was touched.
- **If any form misresolves**, report immediately with the exact prompt,
  the expected step, and the actually-resolved step. That's the
  load-bearing failure mode.
- Any forms where the parser refused when it shouldn't have (e.g.
  ordinal returned no-target)?

---

### P0 — D. Refusal paths are non-destructive

**Scenario:** Send each refusal-triggering prompt; verify the inline
message renders and no regenerate fires.

For each prompt below, note before sending: no regenerate should occur
(no spinner, no step content change).

1. **Question routing:** `what's the difference between approval and
   one_off step types?` → expect an info-styled assistant message
   ("I can only help with step edits right now...").
2. **Ambiguous (multiple distinct refs):** `rephrase step 2 and step 4`
   → expect an error-Alert assistant message ("I can only refine one
   step per message...").
3. **No target (out-of-range numeric):** `regenerate step 99` → expect
   an error-Alert assistant message ("I couldn't figure out which step
   to edit...").
4. **No target (no reference + no active selection):** Click somewhere
   to deselect any step, then type `make it terser please` and Send →
   expect an error-Alert about needing to reference a step.

**Capture:** `08-refusal-question.png`, `09-refusal-ambiguous-and-no-target.png`
(can be one screenshot showing the rendered messages).

**Verify:**

- No spinner, no network call, no step content change for any of the
  four prompts.
- Each refusal type's message is **inline in the panel** (not a toast,
  not a modal).
- The composer is re-enabled immediately after each refusal (no fake
  "pending" lock).

**Report:**

- Did each refusal type render the right styling (info vs error)?
- Did any prompt accidentally trigger a regenerate? (Would be a
  parser-side false positive — same severity as a misresolution.)

---

### P1 — E. Pending-state UX

**Scenario:** During an in-flight regenerate, the Send button + composer
should be disabled and the pending message visible.

1. Send a regenerate (any valid reference form). Use a slightly longer
   prompt so the regenerate takes 8+ seconds; this gives time to inspect
   the UI mid-flight.
2. **Immediately** verify (before the response lands):
   - Send button shows "Sending…" label.
   - Composer textarea is disabled (can't type into it).
   - Pending assistant message is visible ("Regenerating ‹title›…" with
     italic muted styling).
3. **Capture:** `10-pending-state.png` mid-flight.
4. Wait for completion.
5. Verify the controls re-enable + the pending message replaces with
   success (or error).

**Report:**

- Were both Send + composer disabled during the in-flight call?
- Did they re-enable on completion (or error)?
- Any rendering jank during the swap?

---

### P1 — F. Reset behavior

**Scenario:** The X button in the header clears history back to the
greeting.

1. After running scenarios B and C, the panel should have multiple
   messages.
2. Click the X button (top-right of the panel header).
3. **Capture:** `11-after-reset.png`.

**Verify:**

- The message list collapses to just the greeting.
- The composer is empty + enabled.
- Workflow state in the rail is unchanged — reset is panel-local only.

---

### P2 — G. D-040 sibling isolation via the chat surface (re-affirmation)

**Scenario:** Already proven at the procedure layer (commit `c41d42b`),
but worth a quick re-check that routing through chat doesn't introduce
a new leak surface.

1. Manually edit step 2's title to *"Frobnicate the bunglesphere"*
   (same marker as the prior briefing).
2. In chat, send: `make step 1 reference what step 2 does in detail`.
3. After regenerate, read step 1's new description.

**Verify:**

- Step 1's regenerated description contains neither "frobnicate" nor
  "bunglesphere".
- Step 2's content is unchanged.

**Capture:** `12-chat-sibling-isolation.png` showing step 1's
regenerated description.

**Report:**

- Verbatim paste of step 1's new description.
- This is a re-affirmation, not the load-bearing scenario — the
  procedure-layer verification at `c41d42b` already locked the
  invariant.

---

## What to send back

A single markdown report at
`docs/reviews/workflow-assistant-2026-05-29/REPORT.md` with:

- **Per-scenario verdict** (PASS / FAIL / PARTIAL) with the captured
  screenshots linked by filename.
- **The P0 — C verdict is load-bearing.** If any resolution form
  misresolves (e.g. "step 3" routes to step 4), report immediately
  with the exact prompt, the expected step, and the resolved step.
  That's the high-trust-loss failure mode this briefing exists to
  catch.
- **Any console errors** observed (paste verbatim, including stack).
- **Specific reproductions** for anything that didn't behave as
  described.
- **"Recommend amend"** markers on anything cheaper to patch than to
  fully verify.

The relevant HEAD commits to cite findings against:

- `6987ce7` Workflow Assistant right-rail chat panel + parser + 18
  parser unit tests
- `c41d42b` agents.regenerateStep procedure-layer verification PASS
  (already-confirmed; this briefing layers a new invoke surface on top)
- `7ed368d` per-step Regenerate UI affordance (sibling invoke surface
  the chat composes with)
- `592c0cc` agents.regenerateStep backend (the underlying engine
  both surfaces share)

---

## Kickoff prompt (paste this to Antigravity)

```
I need browser-driven verification of the new Workflow Assistant
right-rail chat panel — natural-language driver for the same
agents.regenerateStep procedure the per-step button already uses. The
full self-contained briefing is at:

  c:\Projects\Virn\virn-ops\docs\reviews\workflow-assistant-2026-05-29\ANTIGRAVITY_BRIEFING.md

Read it first — it has prerequisites (dev server, magic-link auth,
ANTHROPIC_API_KEY required for B/C/E/G, fresh AI-authored workflow setup),
seven tagged scenarios (P0/P1/P2), capture targets, and per-scenario
reporting expectations.

Priorities: all P0 first, then P1 if cycles remain, P2 stretch. P0 — C
is the load-bearing one: it walks each natural-language reference form
("step N", "the Nth step", "the last step", quoted exact title, "this
step" + active selection) and verifies that the correct step is the one
that gets regenerated. If any form misresolves (e.g. "step 3" routes to
step 4), report immediately with the exact prompt, expected step, and
resolved step — that's silent data loss on a row the operator didn't
intend to touch.

Save artifacts under `docs/reviews/workflow-assistant-2026-05-29/` and
write the report at `docs/reviews/workflow-assistant-2026-05-29/REPORT.md`
— per-scenario verdict (PASS / FAIL / PARTIAL), screenshots linked by
filename, console errors verbatim, "recommend amend" markers on anything
cheaper to patch than to fully verify.

The relevant HEAD commits are listed at the bottom of the briefing. Repo
is on the `main` branch and up to date.

If any prerequisite fails (port 3000 taken, ANTHROPIC_API_KEY missing,
magic-link not landing) — STOP and report rather than guessing. The
briefing flags the known landmines in its Prerequisites section.
```
