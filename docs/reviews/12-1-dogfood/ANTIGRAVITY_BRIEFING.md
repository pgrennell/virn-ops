# Antigravity Briefing — Phase 12.1 AI Authoring Dogfood

**Repo:** `c:\Projects\Virn\virn-ops`
**Branch:** `main` (uncommitted local changes for Phase 12.1 UI; the backend is at HEAD as commit `79de159`)
**Date:** 2026-05-27

## What this is

We just shipped the Phase 12.1 backend (`agents.authorWorkflow` oRPC procedure that
calls Claude Sonnet 4.6 to convert a free-text prompt into a structured workflow draft)
and a frontend dialog that exposes it from the Library's `+ Create` menu. Both halves
compile and the unit tests pass, but the path was assembled without a real Claude
roundtrip — we need to confirm the end-to-end loop works against the live model and
the dialog handles the happy + sad paths gracefully.

## Goal

Validate that an admin can:
1. Open the new "Author with AI…" entry in the `+ Create` dropdown on the Library
   page.
2. Submit a realistic property-ops workflow prompt.
3. See a draft workflow built and land in the Builder with the expected structure
   (sections + steps + step fields + kickoff fields).
4. Trigger one validator-refusal scenario and see the structured error surfaced in
   the dialog (so users can tell *why* their request didn't work).
5. Confirm no orphaned writes happen when generation fails — i.e. the Library
   shouldn't grow a phantom "untitled" row after a failed generation.

## Prerequisites

### Dev server

The dev server must be running with the monorepo-root `.env.local` loaded
(`DATABASE_URL`, `BETTER_AUTH_SECRET`, `ANTHROPIC_API_KEY`, etc. all live there, not
in `apps/saas/.env.local`).

From the repo root:

```bash
cd c:/Projects/Virn/virn-ops/apps/saas
pnpm exec dotenv -c -e ../../.env.local -- next dev --port 3000
```

Wait until you see "Local: http://localhost:3000" before navigating. If port 3000 is
already taken by a stale process, kill it first:

```bash
netstat -ano | grep ":3000" | grep LISTENING | awk '{print $5}' | xargs taskkill //F //PID
```

### Auth

The seeded admin is `pgrennell@gmail.com` in the org with slug `virn`. The existing
dogfood spec at `apps/saas/tests/dogfood-walkthrough.spec.ts` shows the magic-link
bypass pattern — copy that approach. You'll need:

- Helper: `waitForVerificationForEmail` from `apps/saas/tests/__helpers/db.ts`
- Callback URL pattern: `http://localhost:3000/api/auth/magic-link/verify?token={TOKEN}&callbackURL=http://localhost:3000/virn/library`

### Anthropic API key

Must be present in `.env.local` as `ANTHROPIC_API_KEY` (already configured). If the
dev server starts without it, the authorWorkflow call will fail with an
`AI_AUTHORING_MODEL_ERROR`; if you see that error, the server didn't pick up the env
file — stop and report rather than guessing.

## What's new / what to look for

### UI surface

The Library page (`/virn/library`) has a `+ Create` button in the top-right of the
header. Clicking it opens a dropdown with four type entries
(Workflow/SOP/Policy/Form) followed by a divider and a new **"Author with AI…"**
item with a Sparkles icon.

Clicking "Author with AI…" should open a modal dialog titled "Author with AI" with:

- A large textarea labeled "What workflow do you need?" (min 8 chars, max 8000)
- A collapsible `<details>` block labeled "Paste an existing SOP, doc, or
  transcript (optional)" containing a second textarea
- A "Cancel" button and a primary "Generate workflow" button (with Sparkles icon)
- A live char count under each textarea

While submitting, the primary button should swap to a spinner + "Generating draft…".
The dialog should be NON-DISMISSIBLE while generating (clicking outside or Cancel
shouldn't close it mid-call).

### Success path

Once the server returns, the dialog should close and the browser should navigate to
`/virn/library/workflows/{workflowId}/builder` showing the generated draft. The
Builder is the existing UI; verify the draft has:

- A title that resembles the prompt's request (not the literal default text)
- One or more sections (not always — short prompts may return ungrouped steps)
- At least 2-3 steps
- Step types limited to `task`, `approval`, `heading`, or `one_off`
- Step deadlines either absent (`dueType=none`) or "offset_from_start" with a day
  count — NEVER `offset_from_step` or `from_date_field` (the validator should reject
  those server-side before we get here)
- Kickoff fields visible in the kickoff panel (if any were generated)

### Validator refusal path

The hardest thing to engineer deterministically is a model output that the validator
refuses, because Claude usually follows the contract. Two reliable failure modes:

1. **Prompt too short (client-side):** Type 3 characters. The submit button should
   stay disabled and the helper text should count down ("Add at least 5 more
   characters."). This is a client-side guard, not a server roundtrip.
2. **Empty/malformed simulated:** This one's a stretch goal — if you can find a
   prompt that reliably gets a refusal (e.g., asking for something the contract
   explicitly forbids like "use a `code` step" or "set due 7 days after step 2"),
   the dialog should show a red error box with the structured issues list. If you
   can't reproduce a server-side refusal naturally, skip this scenario and report it
   as "not exercised — happy path only".

## Specific things to capture

For each scenario you run, screenshot the relevant state and save under
`docs/reviews/12-1-dogfood/` with a numbered prefix:

- `01-library-create-menu-open.png` — menu open with "Author with AI…" visible
- `02-dialog-open-empty.png` — fresh dialog state
- `03-dialog-prompt-typed.png` — after typing a real prompt
- `04-dialog-generating.png` — spinner state mid-generation (this is hard to
  catch — best effort)
- `05-builder-with-generated-draft.png` — landing page in Builder after success
- `06-dialog-short-prompt-disabled.png` — sub-8-char state showing disabled submit

Save the test spec under `apps/saas/tests/12-1-ai-authoring.spec.ts` following the
same `getArtifactsDir` pattern used by `dogfood-walkthrough.spec.ts`.

## Suggested test prompt

> "Build a mid-stay inspection workflow for our short-term rental properties. It
> should kick off the day before each guest arrives and check three areas:
> kitchen, bathroom, and common areas. At each step the inspector takes photos
> and notes anything that needs attention. End with a manager approval before the
> next guest checks in."

This exercises sections, multiple steps, photo+text fields, an approval step, and
naturally maps onto entity-set scoping (STR properties).

## What to report back

A short summary (under 400 words) covering:

1. Did the dialog appear and work as described above? Any UX surprises?
2. What did the model actually generate? (Paste the workflow title, the section
   titles, and the step titles — full step descriptions optional.)
3. Were there any visual glitches: layout breaks, missing affordances, weird
   spacing, console errors in the browser DevTools?
4. Did the structured-error display ever fire? If so, what was the message?
5. Did Builder load cleanly with the generated draft, or did anything fail to
   render?
6. Concrete bugs (with file:line references where possible) vs. polish items
   vs. things that worked.

If you discovered a bug that prevents the flow from working at all, STOP and report
rather than trying multiple workarounds — the back-and-forth context here is
expensive and a clear "blocked at step N because X" is more useful than five paged
attempts.

## What NOT to do

- Don't commit any code — local changes need to come back to this Claude Code
  session for review.
- Don't change `.env.local` or any settings beyond what the test naturally requires.
- Don't try to fix bugs you find — capture and report. The fixes happen here so
  they land in the right commit.
- Don't run `pnpm test` or modify test infra beyond adding the new spec file.
