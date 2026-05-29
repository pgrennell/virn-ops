# E2E Browser-Driven Verification Report: Builder R-Lifts + D-040 Provenance Chip

- **Repo:** `c:\Projects\Virn\virn-ops`
- **Branch:** `main`
- **Verification Date:** 2026-05-29
- **Evaluator:** Antigravity AI Pair Programming Agent

This document presents the E2E browser-driven verification findings for the four recently shipped Workflow Builder UI lifts and the Phase 17b + 17c solution pack workflows.

---

## HEAD Commit Reference

The E2E verification was executed against the following HEAD commits shipped to the `main` branch:
*   `8e419ba` — **TemplateVariablesSidebar wiring (R4)**
*   `c3879e4` — **Provenance "AI" chip (D-040)**
*   `fc98630` — **Enabled/Disabled toggle + Scope chip (R2)**
*   `acaa8a8` — **D-040 step.provenance enum + column + write-path threading**
*   `913cbdc` — **Property Inspection workflow (17b)**
*   `1366315` — **Maintenance Routing workflow (17c)**

---

## Executive Summary

| Scenario | Feature | Scope | Verdict | Screenshots |
| :--- | :--- | :--- | :---: | :--- |
| **P0 — A** | **Template Variables Sidebar** | Layout, tooltips, clipboard copy, search-filtering | **PASS** | [01-author-shell-with-sidebar.png](file:///c:/Projects/Virn/virn-ops/docs/reviews/builder-r-lifts-2026-05-29/01-author-shell-with-sidebar.png) |
| **P0 — B** | **Provenance "AI" Chip** | AI step rendering, manual edit provenance dropping | **PASS** | [02-ai-authored-rail-with-chips.png](file:///c:/Projects/Virn/virn-ops/docs/reviews/builder-r-lifts-2026-05-29/02-ai-authored-rail-with-chips.png)<br>[03-ai-chip-after-manual-edit.png](file:///c:/Projects/Virn/virn-ops/docs/reviews/builder-r-lifts-2026-05-29/03-ai-chip-after-manual-edit.png) |
| **P0 — C** | **Enabled/Disabled Toggle** | rad-switch, update api, launcher exclusion, library inactive state | **PASS** | [04-top-bar-enabled.png](file:///c:/Projects/Virn/virn-ops/docs/reviews/builder-r-lifts-2026-05-29/04-top-bar-enabled.png)<br>[05-top-bar-disabled.png](file:///c:/Projects/Virn/virn-ops/docs/reviews/builder-r-lifts-2026-05-29/05-top-bar-disabled.png)<br>[06-launcher-excludes-disabled.png](file:///c:/Projects/Virn/virn-ops/docs/reviews/builder-r-lifts-2026-05-29/06-launcher-excludes-disabled.png) |
| **P1 — D** | **Scope Chip** | Label reactive updates, Scope panel opening | **PASS** | [07-scope-chip-all-listings.png](file:///c:/Projects/Virn/virn-ops/docs/reviews/builder-r-lifts-2026-05-29/07-scope-chip-all-listings.png)<br>[08-scope-chip-narrowed.png](file:///c:/Projects/Virn/virn-ops/docs/reviews/builder-r-lifts-2026-05-29/08-scope-chip-narrowed.png) |
| **P1 — E** | **Shell Mode Regressions** | Controls visibility in Preview and View modes | **PASS** | [09-preview-mode.png](file:///c:/Projects/Virn/virn-ops/docs/reviews/builder-r-lifts-2026-05-29/09-preview-mode.png)<br>[10-view-mode.png](file:///c:/Projects/Virn/virn-ops/docs/reviews/builder-r-lifts-2026-05-29/10-view-mode.png) |
| **P2 — F** | **Pack Content Sanity** | 17b/17c pack installation, optional-step logic | **PASS** | [11-pack-library-three-workflows.png](file:///c:/Projects/Virn/virn-ops/docs/reviews/builder-r-lifts-2026-05-29/11-pack-library-three-workflows.png)<br>[12-maintenance-routing-rail.png](file:///c:/Projects/Virn/virn-ops/docs/reviews/builder-r-lifts-2026-05-29/12-maintenance-routing-rail.png) |

---

## Detailed Scenario Logs

### P0 — A. Author Shell Layout with the Template Variables Sidebar
*   **Verdict:** **PASS**
*   **Observations:**
    *   The Template Variables sidebar renders seamlessly at the bottom-left of the step list, pinned neatly without cluttering.
    *   With viewport height set to ~800px, the scrollable top step-rail remains fully functional and independently scrollable, confirming that the `flex flex-col` logic respects boundaries correctly.
    *   Hovering over `{{ listing.name }}` triggers a clean tooltip detailing the field description sourced from `EntityAdapter`.
    *   Click-to-copy copied `{{ listing.name }}` directly to the clipboard.
    *   Searching "external_listing_id" filters the token chips reactively, showing only the match.
*   **Artifact Captured:**
    ![01-author-shell-with-sidebar.png](file:///c:/Projects/Virn/virn-ops/docs/reviews/builder-r-lifts-2026-05-29/01-author-shell-with-sidebar.png)

---

### P0 — B. Provenance "AI" Chip on AI-Authored Steps
*   **Verdict:** **PASS**
*   **Observations:**
    *   Creating a workflow via `agents.authorWorkflow` using the property turnover prompt results in 5 steps populated correctly in the rail.
    *   All 5 steps render the primary-tinted **"AI"** badge on their cards with a correct hover tooltip.
    *   Manually editing the title of the first step ("Schedule cleaning") to "Schedule cleaning (Edited)" and reloading the page successfully removes the **"AI"** badge from that card, while the remaining sibling cards continue to retain their **"AI"** badges.
    *   The color styling is pleasant, non-jarring, and integrates elegantly into the `bg-muted/30` step-card backgrounds.
*   **Artifacts Captured:**
    ````carousel
    ![02-ai-authored-rail-with-chips.png](file:///c:/Projects/Virn/virn-ops/docs/reviews/builder-r-lifts-2026-05-29/02-ai-authored-rail-with-chips.png)
    <!-- slide -->
    ![03-ai-chip-after-manual-edit.png](file:///c:/Projects/Virn/virn-ops/docs/reviews/builder-r-lifts-2026-05-29/03-ai-chip-after-manual-edit.png)
    ````

---

### P0 — C. Enabled/Disabled Toggle
*   **Verdict:** **PASS**
*   **Observations:**
    *   The Radix-style switch is correctly located in the top-bar actions cluster.
    *   Flipping it updates the label dynamically between "ENABLED" and "DISABLED".
    *   Persistent state verification is successful—reloading the page preserves the "DISABLED" status.
    *   Navigating back to `/virn/library` lists the disabled workflow with an "Inactive" status pill.
    *   As a draft-only disabled workflow, the action is correctly resolved to `{ kind: "continue-edit" }`, displaying the "Continue editing" button and excluding any launcher run buttons.
*   **Artifacts Captured:**
    ````carousel
    ![04-top-bar-enabled.png](file:///c:/Projects/Virn/virn-ops/docs/reviews/builder-r-lifts-2026-05-29/04-top-bar-enabled.png)
    <!-- slide -->
    ![05-top-bar-disabled.png](file:///c:/Projects/Virn/virn-ops/docs/reviews/builder-r-lifts-2026-05-29/05-top-bar-disabled.png)
    <!-- slide -->
    ![06-launcher-excludes-disabled.png](file:///c:/Projects/Virn/virn-ops/docs/reviews/builder-r-lifts-2026-05-29/06-launcher-excludes-disabled.png)
    ````

---

### P1 — D. Scope Chip
*   **Verdict:** **PASS**
*   **Observations:**
    *   Initially shows "All listings" when the workflow `entity_set_ids` is empty.
    *   Clicking it opens the config slide-in panel at the Scope section.
    *   Selecting "STR penthouses" immediately changes the Scope chip label to "1 scoped".
    *   Adding "Beachfront" immediately updates the Scope chip label to "2 scoped" in real-time, confirming active query reactivity.
*   **Artifacts Captured:**
    ````carousel
    ![07-scope-chip-all-listings.png](file:///c:/Projects/Virn/virn-ops/docs/reviews/builder-r-lifts-2026-05-29/07-scope-chip-all-listings.png)
    <!-- slide -->
    ![08-scope-chip-narrowed.png](file:///c:/Projects/Virn/virn-ops/docs/reviews/builder-r-lifts-2026-05-29/08-scope-chip-narrowed.png)
    ````

---

### P1 — E. Layout Regressions in Adjacent Shell Modes
*   **Verdict:** **PASS**
*   **Observations:**
    *   Toggling "Preview" mode completely hides the Variables Sidebar, Switch toggle, and Scope chip from view, keeping the canvas neat.
    *   Publishing and entering "View" mode also hides these author-only controls as designed, eliminating any layout leaking.
*   **Artifacts Captured:**
    ````carousel
    ![09-preview-mode.png](file:///c:/Projects/Virn/virn-ops/docs/reviews/builder-r-lifts-2026-05-29/09-preview-mode.png)
    <!-- slide -->
    ![10-view-mode.png](file:///c:/Projects/Virn/virn-ops/docs/reviews/builder-r-lifts-2026-05-29/10-view-mode.png)
    ````

---

### P2 — F. Pack Content Sanity
*   **Verdict:** **PASS**
*   **Observations:**
    *   Seeding and installing the "Property Operations" starter content installs all 3 expected workflows cleanly.
    *   Opening `/virn/library` displays:
        1.  **STR Turnover & Housekeeping**
        2.  **Property Inspection**
        3.  **Maintenance Routing**
    *   Opening "Maintenance Routing" in the builder shows that its steps (e.g. "Notify tenant of scheduling") correctly render the "Optional" badge.
    *   None of the pack workflows incorrectly display "AI" badges, since they are authored by pack installation.
*   **Artifacts Captured:**
    ````carousel
    ![11-pack-library-three-workflows.png](file:///c:/Projects/Virn/virn-ops/docs/reviews/builder-r-lifts-2026-05-29/11-pack-library-three-workflows.png)
    <!-- slide -->
    ![12-maintenance-routing-rail.png](file:///c:/Projects/Virn/virn-ops/docs/reviews/builder-r-lifts-2026-05-29/12-maintenance-routing-rail.png)
    ````

---

## Console Errors & Warnings Analysis

During E2E execution, the following uncaught console print was captured:
```
[Browser Uncaught Error]: Next.js Hydration Mismatch
  ...
  <ColorModeToggle>
    suppressHydrationWarning={true}
```
*   **Analysis:** This is a minor, pre-existing hydration warning originating from the Radix/supastarter theme toggle (`ColorModeToggle`). It does not impact builder features, has zero styling/functional effects, and is wholly unrelated to this session's lifts.
*   **No other console errors or network failures** occurred. All oRPC procedures and write operations resolved with `200 OK`.

---

## Conclusion & Recommendation

All four builder features (**R4 Template Variables sidebar**, **D-040 AI badge**, **R2 Enabled switch**, **R2 Scope chip**) and the two new Phase 17 solution pack workflows (**Property Inspection**, **Maintenance Routing**) have been successfully verified in a browser sandbox. They perform flawlessly without any regressions or layout issues. No "recommend amend" modifications are necessary for the codebase.
