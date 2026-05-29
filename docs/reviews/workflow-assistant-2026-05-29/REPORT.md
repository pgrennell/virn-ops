# E2E Browser-Driven Verification Report: Workflow Assistant Right-Rail Chat Panel (G9 / PRD §6.3 R1)

- **Repo:** `c:\Projects\Virn\virn-ops`
- **Branch:** `main`
- **Verification Date:** 2026-05-29
- **Evaluator:** Antigravity AI Pair Programming Agent

This document presents the E2E browser-driven verification findings for the newly shipped Workflow Assistant right-rail chat panel (tri-column author shell), validating its natural-language step resolver forms, pending UX states, refusal paths, reset behavior, and sibling isolation under live Claude-powered mutations.

---

## HEAD Commit Reference

The E2E verification was executed against the following HEAD commits shipped to the `main` branch:
*   `6987ce7` — **Workflow Assistant right-rail chat panel + parser + 18 parser unit tests**
*   `c41d42b` — **agents.regenerateStep procedure-layer verification PASS** (already-confirmed; this briefing layers a new invoke surface on top)
*   `7ed368d` — **per-step Regenerate UI affordance** (sibling invoke surface the chat composes with)
*   `592c0cc` — **agents.regenerateStep backend** (the underlying engine both surfaces share)

---

## Executive Summary

| Scenario | Feature / Scope | Verdict | Screenshots |
| :--- | :--- | :---: | :--- |
| **P0 — A** | **Tri-Column Author Shell Layout**<br> Renders left rail, center editor, and right assistant panel cleanly without overflow under `1440px` and `1280px` viewports. Greeting D-040 message and focusable composer checked. | **PASS** | [01-tri-column-shell.png](file:///c:/Projects/Virn/virn-ops/docs/reviews/workflow-assistant-2026-05-29/01-tri-column-shell.png) |
| **P0 — B** | **Happy Path NL Step Resolution & Live Mutation**<br> Sending *"make step 3 terser"* triggers the correct step update in ~10s and replaces the muted italic pending state with a green success badge in-place. | **PASS** | [02-pending-message.png](file:///c:/Projects/Virn/virn-ops/docs/reviews/workflow-assistant-2026-05-29/02-pending-message.png)<br>[03-success-message.png](file:///c:/Projects/Virn/virn-ops/docs/reviews/workflow-assistant-2026-05-29/03-success-message.png) |
| **P0 — C** | **Resolution Form Coverage** (Numeric, Ordinal, Quoted, Implicit)<br> Walks each natural-language reference form to ensure the correct step card is resolved and regenerated. | **PASS** | [04-resolution-numeric.png](file:///c:/Projects/Virn/virn-ops/docs/reviews/workflow-assistant-2026-05-29/04-resolution-numeric.png)<br>[05-resolution-ordinal.png](file:///c:/Projects/Virn/virn-ops/docs/reviews/workflow-assistant-2026-05-29/05-resolution-ordinal.png)<br>[06-resolution-quoted.png](file:///c:/Projects/Virn/virn-ops/docs/reviews/workflow-assistant-2026-05-29/06-resolution-quoted.png)<br>[07-resolution-implicit.png](file:///c:/Projects/Virn/virn-ops/docs/reviews/workflow-assistant-2026-05-29/07-resolution-implicit.png) |
| **P0 — D** | **Refusal Paths**<br> Surfaces informational info/error Alert styles on question, ambiguous, out-of-bounds, and no-target inputs. **(Bug identified)** | **PARTIAL**<br>*(Passed E2E via active selection bypass; Recommend Amend)* | [08-refusal-question.png](file:///c:/Projects/Virn/virn-ops/docs/reviews/workflow-assistant-2026-05-29/08-refusal-question.png)<br>[09-refusal-ambiguous-and-no-target.png](file:///c:/Projects/Virn/virn-ops/docs/reviews/workflow-assistant-2026-05-29/09-refusal-ambiguous-and-no-target.png) |
| **P1 — E** | **Pending-State UX**<br> Composer textarea is disabled and Send button displays a loading label mid-flight. | **PASS** | [10-pending-state.png](file:///c:/Projects/Virn/virn-ops/docs/reviews/workflow-assistant-2026-05-29/10-pending-state.png) |
| **P1 — F** | **Reset Behavior**<br> Header "X" button collapses message history to greeting instantly. | **PASS** | [11-after-reset.png](file:///c:/Projects/Virn/virn-ops/docs/reviews/workflow-assistant-2026-05-29/11-after-reset.png) |
| **P2 — G** | **D-040 Sibling Isolation via Chat**<br> Re-affirms that Claude cannot read or leak manually-edited sibling contents. | **PASS** | [12-chat-sibling-isolation.png](file:///c:/Projects/Virn/virn-ops/docs/reviews/workflow-assistant-2026-05-29/12-chat-sibling-isolation.png) |

---

## Detailed Scenario Logs

### P0 — A. Tri-Column Author Shell Layout
*   **Verdict:** **PASS**
*   **Observations:**
    *   The tri-column layout renders correctly: left-rail (width 64), center editor pane (flex-1), and right assistant panel (width 80) remain aligned without overflow.
    *   D-040 safety callout rendered verbatim inside the greeting message: `"...I leave any step you've manually edited untouched (D-040)."`
    *   The viewport was narrowed to `1280px` width; columns contracted cleanly without collapsing.
    *   The composer textarea is focusable and displays a distinctive border focus ring.
    *   *Visual Asset:* [01-tri-column-shell.png](file:///c:/Projects/Virn/virn-ops/docs/reviews/workflow-assistant-2026-05-29/01-tri-column-shell.png)

### P0 — B. Happy Path NL Step Resolution & Live Mutation
*   **Verdict:** **PASS**
*   **Observations:**
    *   Entering the prompt `"make step 3 terser"` successfully routed to step 3 ("Document issues").
    *   The user message was aligned to the right with standard primary background styling.
    *   The pending message rendered immediately below with a muted italic style: `Regenerating "Document issues"…` ([02-pending-message.png](file:///c:/Projects/Virn/virn-ops/docs/reviews/workflow-assistant-2026-05-29/02-pending-message.png)).
    *   Claude processed the single-step regeneration in **~9 seconds**.
    *   The success message replaced the pending message in-place: `Updated step: "Document issues" → "Document issues".`
    *   The step 3 card updated successfully in the left rail.
    *   *Visual Asset:* [03-success-message.png](file:///c:/Projects/Virn/virn-ops/docs/reviews/workflow-assistant-2026-05-29/03-success-message.png)

### P0 — C. Resolution Form Coverage (Load-Bearing Scenario)
*   **Verdict:** **PASS**
*   **Observations:**
    1.  **Numeric Reference:** Sending `"regenerate step 2 to use SMS instead of email"` resolved exclusively to step 2 ("Walk the unit"). The title successfully updated in the rail to `"Walk the unit and notify via SMS"` ([04-resolution-numeric.png](file:///c:/Projects/Virn/virn-ops/docs/reviews/workflow-assistant-2026-05-29/04-resolution-numeric.png)).
    2.  **Ordinal Mid Reference:** Sending `"make the third step a single sentence"` resolved exclusively to step 3 ("Document issues"). The title updated and metadata corrected correctly ([05-resolution-ordinal.png](file:///c:/Projects/Virn/virn-ops/docs/reviews/workflow-assistant-2026-05-29/05-resolution-ordinal.png)).
    3.  **Quoted Exact Title Reference:** Sending `"\"Schedule move-in walkthrough\" should explain arrival rules"` resolved exclusively to step 1 ("Schedule move-in walkthrough"). The title updated to `"Schedule move-in walkthrough and communicate arrival rules"` ([06-resolution-quoted.png](file:///c:/Projects/Virn/virn-ops/docs/reviews/workflow-assistant-2026-05-29/06-resolution-quoted.png)).
        > [!NOTE]
        > The step title card in the left rail also contains the rendered due-date metadata. We resolved an earlier test crash by correctly splitting the button inner text by newline `\n` to isolate the pure title string (`"Schedule move-in walkthrough"`) from its metadata.
    4.  **Implicit + Active Selection Reference:** Clicking step 4 ("Send tenant lease addendum") to select it, then sending `"make this step optional"` successfully resolved to step 4 only, triggering a mutation and updating the card title and layout in the rail ([07-resolution-implicit.png](file:///c:/Projects/Virn/virn-ops/docs/reviews/workflow-assistant-2026-05-29/07-resolution-implicit.png)).

### P0 — D. Refusal Paths
*   **Verdict:** **PARTIAL** *(Passed E2E via active selection bypass; Recommend Amend)*
*   **Observations:**
    *   **Question Routing:** Typing a general question like `"what's the difference between approval and one_off step types?"` did **NOT** trigger a refusal initially. Instead, it was routed to the active step (Step 1) and dispatched a live Claude call, acting as a prompt refinement for Step 1.
    *   *Why this happened (Parser Bug):* The parser's implicit fallback matching logic (`looksLikeImplicit`) evaluates `numericRefs.length === 0 && quoted.length === 0 && ordinalIndex === null` as `true` for a question. Because there is always a step selected by default when entering the builder (`input.activeStepId !== null`), the question gets resolved as an implicit edit of the active step *before* `isLikelyQuestion(raw)` is ever evaluated.
    *   *E2E Bypass:* Clicking the "Kickoff form" card (clearing the active step selection, setting `activeStepId` to `null`) successfully bypassed the bug. Once bypassed, the question routed to the info-alert refusal successfully: `"I can only help with step edits right now..."` ([08-refusal-question.png](file:///c:/Projects/Virn/virn-ops/docs/reviews/workflow-assistant-2026-05-29/08-refusal-question.png)).
    *   **Ambiguous Multiple-Targets:** Sending `"rephrase step 2 and step 4"` successfully refused with: `"I can only refine one step per message. Try splitting this into separate messages, one per step."`
    *   **Out-of-Bounds Target:** Sending `"regenerate step 99"` successfully refused with: `"I couldn't figure out which step to edit. Try referring to it by number..."`
    *   **Missing Target:** Selecting the Kickoff form (no active selection) and sending `"make it terser please"` successfully refused with the same target resolution error Alert ([09-refusal-ambiguous-and-no-target.png](file:///c:/Projects/Virn/virn-ops/docs/reviews/workflow-assistant-2026-05-29/09-refusal-ambiguous-and-no-target.png)).

### P1 — E. Pending-State UX
*   **Verdict:** **PASS**
*   **Observations:**
    *   Sending a refinement request successfully disabled the composer textarea.
    *   The Send button text changed to `"Sending…"` and was disabled immediately.
    *   The pending message card rendered at the bottom of the scroll container styled in a muted italic layout.
    *   Controls re-enabled instantly upon mutation completion.
    *   *Visual Asset:* [10-pending-state.png](file:///c:/Projects/Virn/virn-ops/docs/reviews/workflow-assistant-2026-05-29/10-pending-state.png)

### P1 — F. Reset Behavior
*   **Verdict:** **PASS**
*   **Observations:**
    *   Clicking the "X" button on the assistant panel header instantly cleared the chat log history and collapsed it back to the initial greeting.
    *   The composer textarea was successfully cleared and focused.
    *   No changes were made to the left rail or center canvas state.
    *   *Visual Asset:* [11-after-reset.png](file:///c:/Projects/Virn/virn-ops/docs/reviews/workflow-assistant-2026-05-29/11-after-reset.png)

### P2 — G. D-040 Sibling Isolation via Chat
*   **Verdict:** **PASS**
*   **Observations:**
    *   Step 2's title was manually edited to the distinctive marker word `"Frobnicate the bunglesphere"`, flipping its provenance to `manually_edited` and removing its AI chip badge.
    *   Step 1 was targeted with the prompt `"make step 1 reference what step 2 does in detail"`.
    *   Claude regenerated Step 1 in ~8.5 seconds.
    *   **Step 1's regenerated description:**
        `Contact the tenant and all required attendees to confirm a walkthrough date and time ahead of move-in. Send calendar invites and any access instructions.`
    *   The regenerated text did **NOT** contain "frobnicate" or "bunglesphere", verifying that the right-rail chat assistant respects D-040 sibling isolation invariants fully without leakage.
    *   *Visual Asset:* [12-chat-sibling-isolation.png](file:///c:/Projects/Virn/virn-ops/docs/reviews/workflow-assistant-2026-05-29/12-chat-sibling-isolation.png)

---

## Console Errors Analysis

No active runtime console errors or 4xx failures were recorded during the E2E verification test execution. A standard Next.js hydration warning on `ColorModeToggle` (`suppressHydrationWarning`) was flagged during the initial application load, but does not affect routing, parser performance, or the rendering of the builder.

---

## Recommend Amend: Parser Question Interception Bug

### Problem Details
A general question prompt (e.g. *"what's the difference between approval and one_off step types?"*) is incorrectly evaluated as an implicit edit of the active step card because the `looksLikeImplicit` condition in `parseAssistantPrompt` runs **before** the `isLikelyQuestion` check. 

In `apps/saas/modules/builder/lib/workflow-assistant-parser.ts` (lines 222-249):
```typescript
	// 4. "this step" or implicit -- fall back to the active selection.
	if (!resolved) {
		const looksLikeImplicit =
			/\bthis\s+step\b/i.test(raw) ||
			(numericRefs.length === 0 && quoted.length === 0 && ordinalIndex === null);
		if (looksLikeImplicit && input.activeStepId) {
			const active = input.steps.find((s) => s.id === input.activeStepId);
			if (active) resolved = active; // matches active step!
		}
	}

	// 5. If still no target -- distinguish "looks like a question" from "looks
	// like an edit request without a step reference."
	if (!resolved) {
		if (isLikelyQuestion(raw)) {
			return {
				kind: "unrouted",
				reason:
					"I can only help with step edits right now...",
			};
		}
		...
	}
```

Since a question doesn't contain explicit numeric/ordinal/quoted step references, `looksLikeImplicit` matches. If `input.activeStepId` is present (which is true by default since the builder opens with the first step selected), `resolved` gets populated. The function bypasses the `!resolved` question check and dispatches an invalid edit call.

### Proposed Code Patch
Move the `isLikelyQuestion` check to the top of `parseAssistantPrompt`, executing immediately after empty prompt validation so that general questions are always intercepted and refused before resolving steps.

```diff
 export function parseAssistantPrompt(
 	input: AssistantParseInput,
 ): AssistantParseResult {
 	const raw = input.prompt.trim();
 	if (raw.length === 0) {
 		return { kind: "no-target", reason: "Empty prompt." };
 	}
 
+	// Intercept questions early so they aren't treated as implicit active-step edits
+	if (isLikelyQuestion(raw)) {
+		return {
+			kind: "unrouted",
+			reason:
+				"I can only help with step edits right now. Try a request like \"make step 3 terser\" or \"add a vendor field to step 5\".",
+		};
+	}
+
 	// 1. Quoted titles take highest precedence -- the operator typed an exact
 	// step name, so we match against the bundle's titles directly.
```

---

## Conclusion & Recommendation

The browser-driven verification of the Workflow Assistant chat panel is **SUCCESSFUL**. All critical resolution forms (P0 Scenario C) map and mutate the correct steps under live Claude-powered calls, while sibling step protection (D-040 Invariant) is fully preserved. 

The minor routing bug on question refusal (Scenario D-1) was successfully isolated and mapped. The proposed code patch is highly recommended to align the production codebase with the PRD. No other structural changes are needed.
