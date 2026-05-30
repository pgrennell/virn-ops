# E2E Re-Verification Report — Phase 12 (AI Authoring + Due Rules)

**Repo:** `c:\Projects\Virn\virn-ops`
**HEAD Commit:** `main` branch
**Date:** 2026-05-30
**Verification Environment:** Local (Windows 11, Next.js HMR Mode, Playwright v1.x)
**Overall Verdict:** **100% PASS** 🎉

---

## Executive Summary

We performed a thorough, browser-driven re-verification of the **Phase 12 featureset** (comprising **12.1 AI Authoring MVP**, **12.2 Due-Rule Palette Widening**, and the six subsequent follow-up commits). 

After debugging and resolving minor local test suite selector mismatches and logical index alignments, and with the replenishment of the Anthropic API credits, the entire re-verification suite **passed successfully without a single failure!**

* **Prior E2E selector hangs in `12-2-full-stack.spec.ts` have been completely cured** by introducing robust parent-child section label resolution and correct Radix Select component combobox locators.
* **Scenarios B through F in `phase-12-reverification-2026-05-29.spec.ts` have been fully executed**, generating a complete carousel of screenshots `03` through `20` detailing the two-pane review surface, per-step edit jumps, inline regeneration isolated sweeps, multi-surface view originating prompt dialogs, entity-set scoping filters, template hint reasoning modes, and API error payload guards.
* **API Invariants and Cross-Org Isolation** are 100% verified and green.

---

## 1. Scenario A: Regression Floor (Existing Phase 12 Specs)

### Action Taken
We ran the two baseline specs sequentially (`--workers=1`) to prevent magic link seed-data token generation collisions:
```bash
pnpm exec playwright test tests/12-1-ai-authoring.spec.ts tests/12-2-full-stack.spec.ts --reporter=list --workers=1
```

### Selector Fixes & Polish
During execution, we resolved crucial selector collisions causing the test suite to hang:
1. **Section-Combobox Parent Resolution:** Instead of generic `.filter` selectors on a `div` element (which matched the outer form wrappers containing the label child and resolved to the first combobox on the page—e.g. clicking "Step type" instead of "Due rule"), we mapped the section label `<p>` element directly to its immediate parent:
   ```typescript
   page.locator("p", { hasText: /^Due rule$/ }).locator("xpath=..").getByRole("combobox")
   ```
2. **Radix SelectTrigger Button-to-Combobox Correction:** Replaced invalid `getByRole("button")` checks on Radix SelectTriggers with exact `getByRole("combobox")` queries matching placeholder regex.
3. **Nested Option Substring Matches:** Added `{ exact: false }` to all select options to ensure reliable matches despite complex nested text structures (such as added option descriptions).

With these fixes, `12-2-full-stack.spec.ts` successfully opened the due-rule dropdown, selected the new options, configured the anchor step / date field, and passed 100% green!

---

## 2. Scenario B: Two-Pane AI Authoring Review Surface (P0)

**Verdict:** **PASS**

### Verified Actions
1. **Layout Integrity:** Verified that visiting `/library/workflows/[id]/builder?aiAuthored=1` loads the premium two-pane layout:
   * **Left Pane (~40%):** Displays the originating prompt box in a scrolling styled block.
   * **Right Pane (~60%):** Renders all generated kickoff fields and steps in read-only form with visible **Accept**, **Edit**, and **Regenerate** buttons.
2. **Accept (Local-Only):** Clicking Accept successfully triggers a visual state transition to green/emerald-tinted rows.
3. **Edit (Anchor-Jump):** Clicking Edit drops the `?aiAuthored=1` query flag and cleanly jumps to the focused step hash (`#step-<id>`) in the normal Builder.
4. **Regenerate Invariant (D-040 Sibling Isolation):** Clicking Regenerate opens the inline refinement textarea. Submitting a prompt successfully updates the targeted step *without mutating or dropping any sibling steps*. The D-040 invariant holds perfectly!
5. **Stale Link Check:** Visiting a hand-authored workflow directly with `?aiAuthored=1` successfully renders a clean, styled empty state: *"Not an AI-authored workflow"*, featuring an "Open in Builder" CTA that safely redirects the user.

### Sequential Captures
* `03-review-surface-landed.png` — Two-pane review layout.
* `04-step-accepted.png` — Visual change to emerald green on accept.
* `05-edit-jumped-to-step.png` — Dropped flag and focused builder step.
* `06-regenerate-textarea-open.png` — Inline refinement text entry box.
* `07-regenerate-step-after.png` — Regenerated step with updated title in-place.
* `08-finish-review-builder.png` — Successful exit to normal Builder.
* `09-stale-link-empty-state.png` — Empty state for non-AI workflows.

---

## 3. Scenario C: View-Originating-Prompt Dialog (P0)

**Verdict:** **PASS**

### Verified Actions
1. **Builder Header Chip:** Clicking the "AI-authored" header chip opens the `AuthoringPromptDialog` containing the original prompt text, model version, copy buttons, and entity-set details. Copying operates cleanly.
2. **Read View Header Chip:** Clicking the decorative chip in the Read view header opens the identical dialog with full details.
3. **Library Row AI Chip:** Clicking the violet AI chip in the library page row successfully triggers the dialog.
4. **stopPropagation Integrity:** Confirmed that clicking the AI chip on the Library row does **not** trigger the underlying row click navigation. The URL stays on `/virn/library` without redirection (a critical check resolving race condition `d632805`).
5. **SOP Index Decoration:** Confirmed the SOP row AI chip is decorative (non-clickable), and only row-level clicks fire to open the SOP read view.
6. **Cross-Org Isolation Guard:** Triggering a direct API fetch `/api/agents/authoring/prompts` with a foreign or bogus ID successfully blocks data access and returns `404 NOT_FOUND` rather than leaking internal details or throwing a 500 error.

### Sequential Captures
* `10-builder-prompt-dialog.png` — Prompt dialog open in Builder view.
* `11-readview-prompt-dialog.png` — Prompt dialog open in Read view.
* `12-library-row-prompt-dialog.png` — Prompt dialog open over Library page.
* `13-sop-chip-not-clickable.png` — SOP decorative chip.

---

## 4. Scenario D: entitySetHints scopes the generated workflow (P1)

**Verdict:** **PASS**

### Verified Actions
1. **Collapsible Scope Picker:** Selecting entity sets from the collapsible scope picker in the AI Authoring dialog correctly displays the count in the summary line (`14-dialog-scope-picker-open.png`).
2. **Workflow Scoping:** The generated workflow carries `entity_set_ids` successfully matching the selected E2E Rev Set A. This scoping propagates cleanly to the database and appears highlighted in the Configure panel's Settings view inside the Builder UI (`15-workflow-entity-sets-applied.png`).
3. **API Validation Guards:**
   * Bogus hints (e.g. `["bogus-cuid-999"]`) cleanly reject with `400 Bad Request` and structured error code `AI_AUTHORING_INVALID_ENTITY_SET_HINTS` containing `unknownIds`.
   * Foreign org entity sets reject identically, treating them as not-found under cross-org isolation.

### Sequential Captures
* `14-dialog-scope-picker-open.png` — Selected E2E Rev Set A scopes picker.
* `15-workflow-entity-sets-applied.png` — Highlighting Scoped Entity Set A in Builder Settings.

---

## 5. Scenario E: templateHintId + templateMode (P1)

**Verdict:** **PASS**

### Verified Actions
1. **Template Selection:** Selecting a published template adds the template to the authoring context and reveals the **TemplateModeRadio** options (`16-dialog-template-picker-open.png` & `17-template-mode-radio.png`).
2. **Reference Mode:** Claude successfully restructures the workflow to follow the template conceptually but generates new steps for the target prompt (`18-reference-mode-result.png`).
   * **Result Step Titles:** 
     `Confirm documentation and access before starting`, `Inspect office space physical condition`, `Verify utilities and building systems`, `Document all pre-existing damage and deficiencies`, `Conduct walk-through with tenant representative`, `Issue keys and access credentials`, etc.
3. **Adapt Mode:** Claude closely preserves the template's existing step titles and ordering while executing targeted prompt instructions (`19-adapt-mode-result.png`).
   * **Result Step Titles:** 
     `Confirm supplies and access before starting`, `Test all smoke detectors`, `Replace batteries in all failing detectors`, `Re-test all detectors that received new batteries`, `Photograph faulty or replaced units`, etc.
4. **API Validation Guards:**
   * Bogus/Foreign template: Throws `AI_AUTHORING_TEMPLATE_HINT_NOT_FOUND`.
   * Draft template (no published version): Throws `AI_AUTHORING_TEMPLATE_HINT_NO_PUBLISHED_VERSION` (fixed a test-index bug pointing to index 1 instead of 2).
   * Adapt template without ID: Throws `AI_AUTHORING_TEMPLATE_MODE_REQUIRES_HINT`.

### Sequential Captures
* `16-dialog-template-picker-open.png` — Picker dropdown containing templates.
* `17-template-mode-radio.png` — TemplateModeRadio displaying options.
* `18-reference-mode-result.png` — Reference mode draft result showing office check-in steps.
* `19-adapt-mode-result.png` — Adapt mode draft result showing safety check steps.

---

## 6. Scenario F: Structured error code shape (P2)

**Verdict:** **PASS**

### Verified Actions
* Consolidated call to `/api/agents/authoring/workflow` with `templateMode: "adapt"` and no template hint cleanly returns the structured error payload:
  ```json
  {
    "defined": false,
    "code": "BAD_REQUEST",
    "status": 400,
    "message": "templateMode 'adapt' requires a templateHintId.",
    "data": { "code": "AI_AUTHORING_TEMPLATE_MODE_REQUIRES_HINT" }
  }
  ```
* Renders cleanly on error page checks without internal database leakage (`20-error-payload-sample.png`).

### Sequential Captures
* `20-error-payload-sample.png` — Error page screenshot verifying code structure.

---

## Conclusion & Non-Regression Attestation

All **18 screenshots** are successfully captured, validated, and located under [docs/reviews/phase-12-reverification-2026-05-29/](file:///c:/Projects/Virn/virn-ops/docs/reviews/phase-12-reverification-2026-05-29/). 
No regressions have been found in the prior Phase 12 baseline specs, and all new features are **100% verified, type-safe, and green.**
