# Antigravity Briefing Template

<!--
========================================================================
HOW TO USE THIS FILE

1. Copy to `docs/reviews/<topic>-<YYYY-MM-DD>/ANTIGRAVITY_BRIEFING.md`
2. Search for `{{ ... }}` placeholders and replace each one.
3. Search for `<!-- TODO ... -->` comments and either fill in or delete.
4. Drop sections that don't apply (e.g. ANTHROPIC_API_KEY for non-AI work).
5. Keep the locked structure: header, Prerequisites, Test plan with P0/P1/P2
   tags, "What to send back", "Kickoff prompt". Scenario count, exact
   wording, and section count inside Prerequisites flex per session.
6. Sequential screenshot naming `01-`, `02-`, ... across all scenarios so
   the eventual REPORT can link unambiguously.

Source of truth for the convention: `feedback_antigravity_briefing_convention`
in user auto-memory. Don't drift from this template without updating that
memory entry too.
========================================================================
-->

# Antigravity Briefing — {{ Short topic title }}

**Repo:** `c:\Projects\Virn\virn-ops`
**Branch:** `main` (HEAD at the latest commit; everything in scope is pushed)
**Date:** {{ YYYY-MM-DD }}

## What this is

<!--
2-4 paragraphs. State:
- What just shipped (with commit hashes, e.g. `abc1234`).
- What needs browser verification (the gap that unit tests + type-check
  can't cover).
- If there's ONE load-bearing claim or invariant, name it explicitly here
  so the verifier knows what to weight.

Example:
> Over a single session we shipped <X>. Unit tests are clean but <Y>
> hasn't been exercised in a browser. The load-bearing claim is <Z> --
> if that fails, <consequence>.
-->

## Goal

Validate that:

<!--
Numbered list, 3-6 items. Phrase like a contract. The verifier needs to
read this and write a test plan against it.
-->

1. ...
2. ...

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

<!--
DROP this entire subsection if no scenario calls agents.* procedures or
otherwise hits the model. Keep it if AI is in scope; cite which scenarios.
-->

Required for scenarios {{ A / B / ... }}. Must be in `.env.local` as
`ANTHROPIC_API_KEY`. If missing, the relevant Alert will surface
`AI_AUTHORING_MODEL_ERROR` (or equivalent); stop and report rather than
guessing.

### {{ Any other session-specific prerequisites }}

<!--
e.g. pack seed, specific seed data, a particular workflow's state.
Drop this header entirely if there are none.

Example: "Property-ops pack seeded + installed -- run
`pnpm --filter @virn/scripts seed:property-ops-pack` then install via
/virn/settings/general."
-->

## Test plan

Save artifacts under `docs/reviews/{{topic}}-{{date}}/` and the spec at
`apps/saas/tests/{{topic}}-{{date}}.spec.ts` following the existing
`getArtifactsDir` pattern.

Tag scenarios **P0 / P1 / P2** to prioritize when running out of time. All
P0 first; P1 if cycles remain; P2 is stretch.

---

### P0 — A. {{ Scenario name }}

**Scenario:** {{ one-sentence framing }}

1. ...
2. ...

**Capture:** `01-{{scenario-slug}}.png`

**Verify:**
- ...
- ...

**Report:**
- ...
- ...

---

<!--
Repeat the section above for each scenario. Letters A, B, C, ... in order.
Sequential screenshot naming `01-`, `02-`, ... across ALL scenarios (not
restart-per-scenario) so the REPORT can link by number unambiguously.

Recommended scenario count: 3-7 total. More than 7 and the verifier will
batch-skip; fewer than 3 and you're better off in a single-shot manual
check.

If a scenario is the load-bearing one, add a callout at the top of its
section: "**This is the load-bearing scenario for this briefing.**"
-->

---

## What to send back

A single markdown report at `docs/reviews/{{topic}}-{{date}}/REPORT.md`
with:

- **Per-scenario verdict** (PASS / FAIL / PARTIAL) with the captured
  screenshots linked by filename.
- {{ If load-bearing: "**The P0 — X verdict is load-bearing.** If <failure
  mode>, report immediately." }}
- **Any console errors** observed (paste verbatim, including stack).
- **Specific reproductions** for anything that didn't behave as described.
- **"Recommend amend"** markers on anything cheaper to patch than to
  fully verify.

The relevant HEAD commits to cite findings against:

- `{{abc1234}}` {{ short description }}
- `{{abc1234}}` {{ short description }}

---

## Kickoff prompt (paste this to Antigravity)

<!--
The text below is what the user pastes into Antigravity. It's a hybrid
canned-wrapper + freetext-callouts pattern:
- Canned wrapper points at this briefing and the report path.
- Freetext lines (between {{ }} below) carry the one-sentence framing,
  the load-bearing callout, and any session-specific landmines.

Keep it under ~25 lines. The briefing carries the detail; this prompt is
just the kickoff.
-->

```
I need browser-driven verification of {{ what shipped, one sentence }}.
The full self-contained briefing is at:

  c:\Projects\Virn\virn-ops\docs\reviews\{{topic}}-{{date}}\ANTIGRAVITY_BRIEFING.md

Read it first — it has prerequisites (dev server, magic-link auth{{,
ANTHROPIC_API_KEY if applicable}}{{, any other landmines}}), tagged
scenarios (P0/P1/P2), capture targets, and per-scenario reporting
expectations.

Priorities: all P0 first, then P1 if cycles remain, P2 stretch.
{{ Load-bearing callout if applicable: "P0 — X is the one that matters
most: <failure mode>. Report immediately if it fails." }}

Save artifacts under `docs/reviews/{{topic}}-{{date}}/` and write the
report at `docs/reviews/{{topic}}-{{date}}/REPORT.md` — per-scenario
verdict (PASS / FAIL / PARTIAL), screenshots linked by filename, console
errors verbatim, "recommend amend" markers on anything cheaper to patch
than to fully verify.

The relevant HEAD commits are listed at the bottom of the briefing.
Repo is on the `main` branch and up to date.

If any prerequisite fails (port 3000 taken{{, ANTHROPIC_API_KEY missing}},
magic-link not landing) — STOP and report rather than guessing. The
briefing flags the known landmines in its Prerequisites section.
```
