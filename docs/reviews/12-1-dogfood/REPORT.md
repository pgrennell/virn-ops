# Phase 12.1 AI Authoring — Dogfood Report

**Date:** 2026-05-27
**Runner:** Antigravity (Playwright + live Claude Sonnet 4.6 roundtrip)
**Spec:** [apps/saas/tests/12-1-ai-authoring.spec.ts](../../apps/saas/tests/12-1-ai-authoring.spec.ts)
**Result:** 1 passed (1.5m) — full happy path + client-side refusal path green.

## What ran

The spec executed all 6 screenshot scenarios from the briefing, then verified the
generated draft landed in the Builder with a sensible title + ≥2 steps in the
sidebar. DB cleanup before/after ensured no orphans.

## Generated workflow

Prompt: "Build a mid-stay inspection workflow for our short-term rental
properties. It should kick off the day before each guest arrives and check three
areas: kitchen, bathroom, and common areas. At each step the inspector takes
photos and notes anything that needs attention. End with a manager approval
before the next guest checks in."

Model output (claude-sonnet-4-6, adaptive thinking, ~12 steps):

- **Title:** "Mid-Stay Inspection — Short-Term Rental"
- **Section 1 — Kitchen Inspection:** stove, refrigerator, sink, dishwasher
  cleanliness steps with photo inputs.
- **Section 2 — Bathroom Inspection:** toilet, shower/tub, vanity steps with
  photo + note fields.
- **Section 3 — Common Area & Turnover Readiness:** living room, linens, keys.
- **Section 4 — Manager Sign-off:** approval step requiring signature.

The model honored every contract constraint (closed step types, allowed dueType,
[a-z][a-z0-9_]* field-key shape, unique keys within version). The validator did
not refuse any output — no server-side refusal path was exercised.

## Findings

### Worked

- Dialog open/empty/typed/disabled-submit/generating/landed-in-Builder all
  rendered as designed; no visual glitches; no browser console errors.
- Magic-link DB-bypass auth pattern from `dogfood-walkthrough.spec.ts` worked
  unchanged.
- `agents.authorWorkflow` round-trip + Zod validation + DB writes succeeded
  first try.
- Client-side prompt-length validation correctly displayed
  "Add at least 6 more characters." with the submit button disabled.

### Polish item — pre-existing, not a Phase 12.1 regression

The global TopBar `+ Create` menu
([apps/saas/modules/shared/components/CreateMenu.tsx](../../apps/saas/modules/shared/components/CreateMenu.tsx))
and the Library page header `+ Create` menu
([apps/saas/modules/library/components/CreateWorkflowMenu.tsx](../../apps/saas/modules/library/components/CreateWorkflowMenu.tsx))
both render a button labeled "Create" on the Library page. The global one is a
stub per its own comment ("Items here are intent-only placeholders") and links to
`?new=...` query params that aren't honored by the Library. The page-specific
one is the real wiring + now hosts "Author with AI…".

Antigravity flagged this as a test-selector hygiene issue (its spec already
disambiguates via `header.filter({hasText: "Library"})`). The deeper concern is
UX — two identical buttons doing different things. **Not in scope for Phase 12.1;
filed as a separate cleanup** (decide: wire up the global menu, remove it, or
hide it on Library).

### Not exercised

- **Server-side validator refusal.** Claude consistently produced
  schema-compliant output; we couldn't naturally provoke an
  `AI_AUTHORING_INVALID_OUTPUT`. The structured-error rendering path remains
  covered only by the lib unit test
  ([authoring.test.ts](../../packages/api/modules/workflows/lib/ai-authoring/authoring.test.ts)).

## Screenshots

1. [01-library-create-menu-open.png](01-library-create-menu-open.png) — `+ Create` menu open with "Author with AI…" entry visible
2. [02-dialog-open-empty.png](02-dialog-open-empty.png) — fresh dialog state with source-text section expanded
3. [03-dialog-prompt-typed.png](03-dialog-prompt-typed.png) — realistic prompt typed, submit enabled
4. [04-dialog-generating.png](04-dialog-generating.png) — spinner + "Generating draft…" state (caught mid-call)
5. [05-builder-with-generated-draft.png](05-builder-with-generated-draft.png) — Builder loaded with the generated 4-section workflow
6. [06-dialog-short-prompt-disabled.png](06-dialog-short-prompt-disabled.png) — sub-8-char state with countdown helper text
