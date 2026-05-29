# Antigravity Briefing — Builder R-Lifts + D-040 Provenance Chip

**Repo:** `c:\Projects\Virn\virn-ops`
**Branch:** `main` (HEAD at the latest commit; everything in scope is pushed)
**Date:** 2026-05-29

## What this is

Over a single session in Claude Code I shipped four UI changes back-to-back
to the Workflow Builder Author surface:

1. **R4 Template Variables sidebar** — pinned to the bottom-left of the
   Author shell. Static token list sourced from the EntityAdapter registry
   via `entities.listSchemasForAI`. Click-to-copy mustache form.
2. **D-040 provenance "AI" chip** — small primary-tinted pill on step cards
   in the rail when `step.provenance === 'ai_generated'`. Surfaces the new
   `step_provenance` column shipped in commit `acaa8a8`.
3. **R2 Enabled/Disabled toggle** — Radix Switch in the BuilderTopBar actions
   cluster (right side). Flips `workflow.isActive` via `workflows.update`.
4. **R2 Scope chip** — compact pill alongside the version chip (left side of
   the BuilderTopBar). Shows "All listings" or "N scoped" + opens the
   existing Scope panel on click.

Type-check + unit tests are clean across all four packages, but **none of
these have been touched in a browser.** I have no native browser tooling
here (per the project's CLAUDE.md, browser-driven verification routes to
Antigravity). I need eyes on layout, interactions, and any console errors.

Also in scope as a small sanity check: two new pack-content workflows
landed in the same session — **Property Inspection** (Phase 17b) and
**Maintenance Routing** (Phase 17c). They should be visible in the launcher
after pack install, but no UI changed for them — pure content.

## Goal

Validate that:

1. The Builder Author shell renders the Template Variables sidebar at the
   bottom-left without breaking the step rail or center-pane layout.
2. The sidebar's click-to-copy flow works (Clipboard API or graceful
   fallback) and the search input filters tokens.
3. Steps authored by AI (`agents.authorWorkflow`) render the "AI" chip on
   their rail card; steps that have been manually edited drop the chip
   (irreversible flip per D-040).
4. The top-bar Enabled/Disabled Switch flips `workflow.isActive` end-to-end
   (UI state mirrors persisted state on refresh) and the disabled state is
   reflected anywhere it should be (launcher picker exclusion is a v1.5
   expectation — verify it happens at the launcher).
5. The Scope chip shows the right "All listings" vs "N scoped" label, and
   clicking it opens the existing Scope panel (slide-in from
   `BuilderConfigPanel`).
6. Pack content sanity: the three property-ops workflows (STR Turnover,
   Property Inspection, Maintenance Routing) all install and are launchable.

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

Needed for Scenario B (AI authoring → provenance chip). Must be in
`.env.local` as `ANTHROPIC_API_KEY`. If missing, AI authoring fails with
`AI_AUTHORING_MODEL_ERROR` — stop and report rather than guessing.

### Property-ops pack seeded + installed

Two pack workflows in scope are new (17b + 17c). After the dev server is
up, run the platform-level seed once (idempotent):

```bash
pnpm --filter @virn/scripts seed:property-ops-pack
```

Then in the UI, go to `/virn/settings/general` and click "Install Property
Operations" if the button is enabled. If the org already installed the v1
pack (which only had STR Turnover), the install button is disabled — that's
a known pack-versioning gap. For this briefing, you can either (a) work
against a fresh org by signing in with a different test user or (b) verify
the new workflows show up via the platform-seed contents inspection rather
than a live install.

## Test plan

Save artifacts under `docs/reviews/builder-r-lifts-2026-05-29/` and the
spec at `apps/saas/tests/builder-r-lifts-2026-05-29.spec.ts` following the
`getArtifactsDir` pattern used by `12-1-ai-authoring.spec.ts`.

Tag scenarios **P0 / P1 / P2** to prioritize when running out of time. All
P0 first; P1 if cycles remain; P2 is stretch.

---

### P0 — A. Author shell layout with the Template Variables sidebar

**Scenario:** Open the Builder for any draft workflow and verify the new
left-rail layout doesn't break.

1. From `/virn/library`, click any draft workflow row to open the Builder.
   (If no draft exists, click `+ Create` on the page header — NOT the
   global TopBar — to mint an empty draft.)
2. **Capture:** `01-author-shell-with-sidebar.png` of the full Builder
   Author view.
3. **Verify in the left rail (top to bottom):**
   - **Top region (scrollable):** KickoffRailEntry → "Sections" header →
     section / step list. This area should grow to fill the available height
     above the sidebar.
   - **Bottom region (pinned, ~40vh max-height):** A bordered region with a
     small "TEMPLATE VARIABLES" header, then a search input, then a
     scrollable list of token chips. Each chip looks like `{{ listing.name }}`
     (monospace), with a hover state.
4. **Resize the browser viewport to ~800px tall.** The sidebar should NOT
   crowd out the step list; the step list should stay scrollable and the
   sidebar should clamp to its max-height.
5. **Hover a token chip.** A tooltip with the field description should
   appear (sourced from the EntityAdapter schemaForAI).
6. **Click any token chip.** The chip should flip to a transient "copied"
   indicator (check or similar). Paste into the browser address bar (or
   anywhere) — you should see something like `{{ listing.name }}`.
7. **Type "name" in the search input.** The token list should filter to
   tokens whose key OR label contains "name".

**Report:**

- Layout: does the sidebar respect its max-height? Does the step list still
  scroll independently?
- Any console errors when the sidebar mounts?
- Any token chips with malformed mustache forms or missing labels?
- Does click-to-copy work in your test browser? (Some non-HTTPS contexts
  block the Clipboard API — the component has a silent fallback, but
  confirm the visual indicator still flips.)

---

### P0 — B. Provenance "AI" chip on AI-authored steps

**Scenario:** Author a workflow via `agents.authorWorkflow`. Verify every
step lands with the AI badge. Then manually edit one step; verify its badge
disappears (irreversible flip-back per D-040).

1. From `/virn/library`, open the `+ Create` menu in the **page header** and
   click "Author with AI…".
2. Submit this prompt:

   > "Build a basic property turnover workflow: schedule cleaning, clean,
   > inspect, photograph, and notify owner. Each step takes a day."

3. Wait for generation to complete. The Builder should land on the new
   draft.
4. **Capture:** `02-ai-authored-rail-with-chips.png` of the step rail.
5. **Verify:**
   - Every step in the rail shows a small **"AI"** pill, primary-tinted,
     toward the right edge of the row (next to where Optional pills would
     render).
   - The chip's tooltip on hover reads something like *"AI-generated step.
     Manually edit to claim ownership; subsequent regenerate calls will skip
     rows you've touched."*
   - **No chip** appears on any step that doesn't have one (defensive — but
     all steps from the agent should land `ai_generated`).
6. Click any step in the rail to open it. Edit the title (add a character,
   then save by clicking out or pressing Enter).
7. **Refresh the page.** That step's chip should now be **gone** — flipped
   to `manually_edited` by the structure.updateStepOp path.
8. **Capture:** `03-ai-chip-after-manual-edit.png` showing one step
   without the chip while siblings still have it.

**Report:**

- How many AI-generated steps landed? Did all of them get the chip?
- After your manual edit, did exactly one chip disappear (the edited one)?
- Any console errors during the AI generation or the manual edit?
- Did the chip's color render correctly against the rail's bg-muted/30
  background? (It should read as a soft primary tint, not jarring.)

---

### P0 — C. Enabled/Disabled toggle

**Scenario:** Flip the workflow's Enabled state via the top bar; verify the
state persists and is reflected at the launcher.

1. Open any published workflow in the Builder (a draft is fine too —
   isActive is workflow-level, not version-level).
2. **Find the Switch in the top bar's actions cluster** (right side, between
   the Settings gear and the Preview button). It should display:
   - A horizontal Switch (Radix style, dark/light variants per theme)
   - A label that reads **"ENABLED"** or **"DISABLED"** depending on the
     current state.
3. **Capture:** `04-top-bar-enabled.png` of the top bar with the Switch in
   ON state.
4. Click the Switch to flip it OFF.
   - The Switch should flip immediately (optimistic) or after a short
     pending state.
   - The label should change from "ENABLED" to "DISABLED".
5. **Refresh the page.** The Switch should still read "DISABLED".
6. **Capture:** `05-top-bar-disabled.png`.
7. **Open the launcher in a separate tab:** navigate to `/virn/library` and
   click `+ Create` → "Launch a run…" (or wherever the launcher picker is).
   The workflow you just disabled should **NOT** appear in the picker.
   - (If the launcher entry point is different on your build, report what
     entry point you found.)
8. Go back to the Builder, flip the Switch back to ON, refresh, and confirm
   the workflow re-appears in the launcher picker.
9. **Capture:** `06-launcher-excludes-disabled.png` if visible — a
   side-by-side or sequential screenshot showing the picker with vs.
   without the workflow.

**Report:**

- Did the Switch flip cleanly? Any visible flicker / double-state?
- Did the disabled state persist across refresh?
- Did the launcher actually exclude the disabled workflow?
- Hover tooltip: does it explain the consequence correctly? (Should say
  something like "Workflow is live..." vs "Workflow is disabled — hidden
  from launchers...").

---

### P1 — D. Scope chip

**Scenario:** Verify the chip label updates as scope changes and that
clicking it opens the Scope panel.

1. Open any workflow in the Builder.
2. **Find the Scope chip** in the top bar's left cluster, immediately right
   of the Version chip. It should read:
   - **"All listings"** if `workflow.entity_set_ids` is empty.
   - **"N scoped"** (e.g. "3 scoped") if narrowed to N entity sets.
3. **Capture:** `07-scope-chip-all-listings.png`.
4. Click the Scope chip. The existing slide-in workflow-config panel should
   open with the Scope section visible.
5. Add the workflow to 1-2 entity sets (or just check the current scope).
6. Close the panel. **The chip label should refresh** to "1 scoped" or
   "2 scoped" without a manual page refresh.
7. **Capture:** `08-scope-chip-narrowed.png` showing the updated label.

**Report:**

- Did the chip label update reactively after the Scope panel save?
- Did clicking the chip route to the correct panel and section?
- Hover tooltip: does it match the chip state? (e.g. "Applies to all
  listings. Click to narrow to specific entity sets." when empty.)

---

### P1 — E. Layout regressions in adjacent shell modes

**Scenario:** R2 controls and R4 sidebar were only added to the AUTHOR
mode. Verify preview + view modes still render cleanly.

1. With a draft workflow open and Author mode active, toggle Preview.
   - The Template Variables sidebar should **disappear** (it's
     author-mode-only by design — the bottom-left region was added in the
     author branch of `BuilderShell` only).
   - The Enabled/Disabled Switch should also disappear from the top bar.
   - The Scope chip should also disappear.
2. **Capture:** `09-preview-mode.png` confirming the actions cluster and
   left rail look unchanged from before this session's work.
3. Open the same workflow in **view mode** (published version, no draft, or
   as a non-admin user — easiest reproduction: visit a published-only
   workflow as the admin and click out of Edit). Same expectations as
   preview.
4. **Capture:** `10-view-mode.png`.

**Report:**

- Any unexpected components leaking into preview or view modes?
- Layout differences from your memory of the pre-session shell?

---

### P2 — F. Pack content sanity (17b + 17c)

**Scenario:** New workflow content shipped in Phase 17b (Property
Inspection) + 17c (Maintenance Routing). Verify they're installable and
launchable. **No UI changed for them** — purely a data sanity check.

1. Re-run the platform seed: `pnpm --filter @virn/scripts seed:property-ops-pack`
2. On a freshly-created or freshly-reset test org, install the pack via
   `/virn/settings/general`.
3. Open `/virn/library`. You should see three pack-installed workflows:
   - **STR Turnover & Housekeeping** (17 steps, 4 sections — shipped earlier)
   - **Property Inspection** (~17 steps, 5 sections — new in 17b)
   - **Maintenance Routing** (~15 steps, 4 sections — new in 17c)
4. Open each new workflow in the Builder. Spot-check:
   - Kickoff fields render and look sensible.
   - Sections and steps appear under expected names.
   - The Maintenance Routing workflow has 3 steps that are **optional**
     (Notify tenant of scheduling / Tenant follow-up confirmation / Owner
     notification + approval). They should NOT render an "AI" chip (they
     were created via pack install, not AI authoring) but they SHOULD
     render as visually distinguishable from required steps (the
     "Optional" pill — pre-existing).
5. **Capture:** `11-pack-library-three-workflows.png` of the Library index
   showing all three.
6. **Capture:** `12-maintenance-routing-rail.png` of the Maintenance
   Routing rail with the optional pills visible.

**Report:**

- Did all three workflows install? Any console errors during install?
- Are the optional-step pills rendering on the right steps?
- Any kickoff fields with misformatted labels or wrong field types?

---

## What to send back

A single markdown report at `docs/reviews/builder-r-lifts-2026-05-29/REPORT.md`
with:

- **Per-scenario verdict** (PASS / FAIL / PARTIAL) with the captured
  screenshots linked by filename.
- **Any console errors** observed (paste verbatim, including stack).
- **Any layout regressions** you noticed even if outside the scenario list.
- **Specific reproductions** for anything that didn't behave as described,
  ideally with the exact steps + the resulting DOM state.

The README pattern from the prior 12-2 dogfood report is the model — keep
findings concrete and tied to specific commits where possible. HEAD's
recent shipping commits relevant to this briefing:

- `913cbdc` Property Inspection workflow (17b)
- `1366315` Maintenance Routing workflow (17c)
- `8e419ba` TemplateVariablesSidebar wiring (R4)
- `c3879e4` Provenance "AI" chip
- `fc98630` Enabled/Disabled toggle + Scope chip (R2)
- `acaa8a8` D-040 step.provenance enum + column + write-path threading
  (the underlying data layer for the provenance chip)

If you find anything that would be cheaper to fix than to verify-fully,
note it as **"recommend amend"** in the report so we can patch before the
next push.
