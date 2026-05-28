# PRD — Playbooks (lifecycle sequence primitive)

**Status:** Draft
**Date:** 2026-05-27
**Owner:** pgrennell
**Inspiration:** Besty AI "Journeys" pattern, renamed and generalized for horizontal property-ops (STR, long-term residential, commercial, multifamily, mixed-use) and beyond.
**Supersedes:** N/A (extends [docs/BUILD_PLAN.md](BUILD_PLAN.md) Phase 18; sits alongside [docs/PRD_WORKFLOW_SOP_BUILDER.md](PRD_WORKFLOW_SOP_BUILDER.md))

---

## 1. Background

Workflows answer "what we do *when something happens*" — one event triggers a procedure with branching logic, executed once. The Pass-3 builder, AI authoring, and reader KB ([docs/PRD_WORKFLOW_SOP_BUILDER.md](PRD_WORKFLOW_SOP_BUILDER.md)) make Workflows the strong primitive for that shape.

What Workflows don't model is *time-staged sequences over a lifecycle*. The class of problems is everywhere in property ops:

- **STR:** reservation confirmed → welcome message → 7 days before arrival → check-in instructions → post-stay review request.
- **Long-term residential:** lease signed → move-in checklist → 30-day satisfaction check → 90-day inspection → renewal reminder at month 11.
- **Commercial:** lease executed → COI request → utilities setup → key handoff → quarterly facilities check-in.
- **Vendor lifecycle:** vendor onboarded → W-9 collected → COI tracked → quarterly performance review → annual re-qualification.

Today, the only path to express these in Virn Ops is to bolt cron triggers + cascading `automation_rule` rows onto a workflow, which conflates two genuinely different authoring surfaces. Besty's "Journeys" pattern validates the split: marketing-automation-style sequences are a distinct primitive from branching procedures.

This PRD specifies **Playbooks** as a sibling content object to Workflow — a named, versioned, AI-authorable, entity-set-scoped, time-and-event-staged sequence that orchestrates downstream Workflows, notifications, and data actions. Playbooks adopt the same Layer-1/2/3 architecture as v1.5 Workflows (per D-034 / [PRD_WORKFLOW_SOP_BUILDER.md](PRD_WORKFLOW_SOP_BUILDER.md) §1.1): entity-set scoping (Layer 1 seams), the same vertical-agnostic engine vocabulary (Layer 2), AI authoring grounded in the tenant's entity schema (Layer 3). Per the 2026-05-27 chat decision, the user-facing label is configurable per org (default "Playbooks"; CRE orgs may rename to "Lifecycles"); the canonical schema/API/audit name stays **playbook**.

## 2. Problem

Three concrete gaps that Workflows alone cannot close cleanly:

1. **No first-class time orchestration.** "Send X 7 days before checkout, then Y on the day, then Z 3 days after" requires either (a) one ugly workflow with date-anchored steps and no clean run boundary, or (b) cron jobs writing automation rules that talk to each other. Neither is authorable by an operator.
2. **No lifecycle composition.** A tenant onboarding sequence wants to *launch* the move-in workflow, then *wait for completion*, then *launch* the 30-day check-in workflow. Workflows can call workflows via `automation_action.actionType='run_workflow'`, but only inline within a single run — not across a multi-week sequence.
3. **No reusable "what happens after" object.** Every org rebuilds the same cadence (welcome → mid-stay → post-stay; signed → move-in → check-in → renewal) per workflow, because there's no object to name and reuse.

## 3. Users & jobs

| User | Job |
|---|---|
| **Property ops lead** (primary) | "Capture the *cadence* my team runs around every reservation / lease / vendor — not just the procedures, but the timing — so it runs even when I'm not pushing it." |
| **Multi-property operator / asset manager** (secondary) | "I want different cadences for different entity sets — pet-friendly homes get an extra cleaning check; commercial tenants get a quarterly visit; STR guests get a welcome series." |
| **Compliance / governance owner** (tertiary) | "I want auditable, reviewable, snapshot-immutable lifecycle programs — not a pile of cron jobs no one understands." |

## 4. Goals

- **G1.** Operators express a multi-step, time-and-event-staged sequence in plain English and get an editable draft Playbook — same on-ramp as Workflows.
- **G2.** Playbooks are first-class authored content: named, versioned, snapshot-immutable on publish, audited, entity-set-scoped, AI-authorable, reader-view accessible via the three-views unification (per [PRD_WORKFLOW_SOP_BUILDER.md](PRD_WORKFLOW_SOP_BUILDER.md) §1.2).
- **G3.** A Playbook step can launch a Workflow, wait for its completion, send a notification, write a data-set record, or branch on a data-set value — composing Virn's existing primitives without duplicating them.
- **G4.** Lifecycle triggers fire Playbooks from the existing event surface: `run.completed`, `run.state_changed`, manual launch, entity-set membership change, vendor upsert. PM-initiated work flows through the existing run-completion events via `crossProductOriginFilter` (per D-027); no new event surface.
- **G5.** AI authoring is **grounded in the tenant's entity schema** — the AI knows what entities exist (in v1.5: the property-ops fixed set via the `EntityAdapter` registry) and references them by name in step descriptions and entity-reference payloads. Same Layer-3 pattern as Workflow AI authoring.
- **G6.** The label "Playbook" is renamable per org (e.g. "Lifecycles" for CRE) without touching schema, API, or integration contracts.

## 5. Non-goals (v1)

- **Visual flowchart authoring.** Playbooks use the same step-list authoring approach as Workflows. No canvas with arrows.
- **Per-step conditional visibility.** Branching is one `branch_on_data_set` step type with N labeled paths; no boolean-expression visibility per step (mirrors the Workflows Pass-3 constraint).
- **Cross-Playbook chaining.** A Playbook step does not launch another Playbook in v1 (cycle-detection cost too high). Workflows it launches can in turn fire automation rules — that's the indirection if you need it.
- **Backfilling Playbooks onto historical entities.** New runs only.
- **Voice authoring.** Same pipeline as Workflow voice authoring — deferred together.
- **In-engine A/B testing of cadences.** Out of scope; orgs that want this fork the Playbook manually.
- **Customer-facing Playbook marketplace.** Pack distribution covers this when the property-ops pack ships Playbooks (Phase 17 follow-up).

## 6. Scope — six capabilities

### 6.1 Playbook authoring (builder)

**Surface.** A new section in the Library alongside Workflows. Same draft/publish/snapshot/audit governance. Same review-state lifecycle (`draft` → optional `in_review` → `published` → `archived`) and `requireConciergeReview` org gate (reused verbatim from [PRD_WORKFLOW_SOP_BUILDER.md](PRD_WORKFLOW_SOP_BUILDER.md) §6.4).

**Step palette (v1 — deliberately small).**

| Step type | Semantics | Config |
|---|---|---|
| `wait_for_duration` | Pause N units (minutes/hours/days/weeks) | `{ amount: int, unit: 'minutes'|'hours'|'days'|'weeks' }` |
| `wait_for_event` | Pause until a named event fires on a referenced entity | `{ eventName, entityRef, timeoutDays?, onTimeout: 'continue'|'abort' }` |
| `launch_workflow` | Start a workflow run; optionally wait for completion before advancing | `{ workflowId, kickoffMapping, waitForCompletion: bool, mode? }` |
| `send_notification` | Send via existing notification surface (reuses `automation_action.actionType='send_notification'` config shape) | `{ channelHint, templateRef, audience, payloadMapping }` |
| `branch_on_data_set` | Read a data-set field on the trigger payload or a referenced entity; route to one of N labeled paths | `{ source, operator, branches: [{ label, condition, nextStepId }] }` |
| `write_to_data_set` | Append/update a data-set record (e.g. log "welcome sent at" for downstream conditions) | `{ datasetId, recordKey, fieldMapping }` |

All other Besty-style step shapes (call webhook directly, set field on a parent entity, escalate) are deliberately deferred — they're covered by `automation_action` actions on the workflows the Playbook launches, which keeps the action catalog single-sourced.

**Triggers (v1).**

| Trigger | Source |
|---|---|
| `manual` | Operator clicks "Run Playbook" from the Playbook detail page (one-off) |
| `run.completed` | Any run of a configured workflow (or any workflow, scoped to entity set) completes |
| `run.state_changed` | A configured state transition on a run (`active → escalated`, etc.) |
| `listing.entity_set_added` | A listing is added to a configured entity set (v1.5 ships only `entity_type='listing'`; future entity types reuse the same event-naming pattern) |
| `vendor.upserted` | A vendor is created or has its sync surface updated (D-028) |

A Playbook can declare **multiple** triggers; firing dedupes per `(playbookId, triggerPayload.entityRef)` until the resulting Playbook run completes or is cancelled (idempotency, mirrors `run_rule_fired` from automation).

**PM-initiated work is *not* a separate trigger.** Per D-025, there are no PM → Ops webhook events in v1 — PM calls Ops's Action API (e.g. `runs.launch`) as an agent principal. The resulting run carries `crossProductOrigin='virn-pm'` on its audit/activity rows (D-027). When that run completes, the existing `run.completed` trigger fires; Playbooks that want to scope to PM-initiated work add a `crossProductOrigin='virn-pm'` filter to their trigger config. No new enum value, no new event surface.

**Authoring UX.**

- Builder is a vertical step list (not a canvas). Each step is a card showing type + config summary; click to edit in side panel (Edit Action modal pattern below). Visual canvas explicitly out of scope per D-039 — Playbooks were already step-list-only per §5; D-039 ratified the same posture for Workflows so the two primitives ship a consistent authoring surface.
- A `branch_on_data_set` step expands inline into N sub-lanes (mirrors how `if/else` reads in code; no separate canvas needed).
- Dry-render preview: shows the step sequence rendered against a fake trigger payload, including resolved wait timings ("would fire on 2026-06-03 at 14:00 UTC").

**Tri-column shell (R1 + R3 + R4 lifts, mirrored from canonical PRD_WORKFLOW_SOP_BUILDER §6.2–6.3).** The Playbook builder uses the same tri-column editor shell as Workflows so the author experience is consistent across the two primitives:

- **Left rail** — Playbooks list (filtered by review state).
- **Center** — the vertical step list described above.
- **Right rail** — persistent **Playbook Assistant** chat panel (R1), wired to `agents.regeneratePlaybookStep`. Always-on during editing; the primary surface for post-generation refinement ("regenerate step 3 to use SMS instead of email", "rephrase the welcome message to be terser"). Each interaction writes an `ai_authoring_prompt` row so the audit trail is uniform with first-generation authoring.
- **Bottom-left** — **Template Variables sidebar** (R4) with a "TEMPLATE VARIABLES" header + search input. Token list sourced from the same `EntityAdapter.schemaForAI()` registry as Workflows. Drag-drop into `send_notification` body text fields, `kickoffMapping` text inputs, `branch_on_data_set` source expressions. Static token definitions only — live PMS hydration is a non-goal (same rationale as canonical PRD §5).
- The contextual node-palette flyout pattern (R3, palette anchored to an edge "+" insertion control) is *not needed* in v1 because the Playbook step list uses card-based step insertion rather than a graph. The R3 pattern is preserved as a constraint for any future Playbook canvas (Phase 13+ per D-039).

**Top bar (R2 lift, mirrored).** Persistent top bar above the step list with three controls:

- **Enabled / Disabled toggle** — flips a `playbook.is_active` column. Disabled Playbooks do not fire on lifecycle triggers; the Inngest dispatcher (§6.4) skips them. Critical for safely staging Playbooks without exposing them to live event traffic.
- **Scope chip / dropdown** — "Apply to: All Entities" by default; click opens an entity-set multi-select picker. Updates `playbook.entity_set_ids` optimistically.
- **Review-state banner** — same component as the canonical PRD §6.6 banner, four states (`draft` / `in_review` / `published` / `archived`) with state-appropriate copy and CTAs. The `requireConciergeReview` org gate flips the "Publish" CTA to "Submit for Review" identically to Workflows.

**Per-step Edit Action modal (C5 lift, mirrored).** Clicking a step card opens a slide-in side panel (the existing Phase 5 Pass 3 pattern) with the modal-style affordances from canonical PRD §6.3:

- **Title** + **Description** inputs. Description editor includes a **`{}`** Template insert button anchored top-right; clicking opens a quick-pick of the same tokens surfaced in the Template Variables sidebar.
- **Step-type-specific config** form below the description (e.g. `launch_workflow` shows a workflow picker + `kickoffMapping` fields).
- **Regenerate** button — fires `agents.regeneratePlaybookStep` with an optional refinement prompt. Honors D-040 partial-regeneration semantics (see §6.2).
- **Delete / Cancel / Save Changes** in the footer.

### 6.2 AI authoring ("Describe a Playbook")

Same Layer-3 pattern as Workflow AI authoring ([PRD_WORKFLOW_SOP_BUILDER.md](PRD_WORKFLOW_SOP_BUILDER.md) §6.3): **AI authoring grounded in the tenant's entity schema** is what makes the surface feel like Besty even with configurable nouns underneath. One additional procedure pair on the agents router:

- `agents.authorPlaybook({ prompt, sourceText?, templateHintId?, entitySetHints? }) → { playbookId }`
- `agents.regeneratePlaybookStep({ playbookId, stepId, refinementPrompt }) → { updatedStep }`

**System prompt composition.** The Playbook authoring prompt embeds:
- The Playbook builder's JSON contract + the step-type / trigger / palette constraints (§6.1, Appendix A).
- **The tenant's entity schemas** — fetched via the `EntityAdapter` registry shipped in v1.5a; cached per org. The AI may reference these entities by name in step descriptions, `branch_on_data_set` sources, and `launch_workflow.kickoffMapping` targets.
- The Playbook action vocabulary (six v1 step types) — declared explicitly as the closed set.
- Few-shot examples drawn from the v1 starter Playbook templates (§11 — STR, LTR, commercial, vendor lifecycles).

**Validator (Zod, parallels Workflows §6.3 — see Appendix A).** AI restricted to the six v1 step types and the v1 trigger set. **Entity references cross-checked against the live `EntityAdapter` registry** — references to undefined entity types ("for each Booking") are rejected at validation. References to undefined workflows / data sets / entity sets are flagged as `precondition_note` comments rather than hard-failing (consistent with Workflow AI authoring's posture on unresolved references).

**Reuse.**
- Same `ai_authoring_prompt` table from v1.5b (no new provenance table).
- Same prompt-caching strategy (large stable system prompt — including the tenant entity-schema slot — cached per org; per-request user input uncached).
- Same model default (`claude-sonnet-4-6`, escalate to `claude-opus-4-7` if structured-output reliability is insufficient).
- Same two-pane review UX (NL/source left, generated Playbook right). **Right pane renders as the read-view timeline (per §6.5), not as a flowchart** — Playbooks render as a chronological timeline, never as a node-graph (per D-039 + the Playbooks-alignment review).

**Provenance and partial-regeneration contract (D-040).** `agents.regeneratePlaybookStep` is the Playbook-side mirror of `agents.regenerateWorkflowStep` (canonical PRD §6.3) and inherits the same contract:

- Every AI-emitted Playbook step row is written with `playbook_step.provenance = 'ai_generated'` (new column added in Phase 9.6 — see §8.1).
- Any manual edit through the Edit Action modal (§6.1) flips that step's row to `provenance = 'manually_edited'` permanently for v1.
- `agents.regeneratePlaybookStep` is a strict partial-regeneration contract: it never reads or writes any sibling step where `provenance = 'manually_edited'`. Regeneration scope is strictly the target step.
- Enforced both server-side in the validator and surface-side via a "Regenerate will leave your manual edits to steps 2, 5 untouched" preview shown before the regen fires.
- Builder UI surfaces an "AI" chip on `'ai_generated'` step cards; no chip on `'manually_edited'`. Hover tooltip explains the contract.

**Post-generation mid-edit surface — persistent Playbook Assistant chat (R1).** After the initial generation lands and the operator accepts into the builder, the persistent right-rail Playbook Assistant chat panel (§6.1 tri-column shell) is the primary surface for targeted refinement. Free-form questions ("what does `wait_for_event` do if the event never fires?") route to a documentation-aware thread; structured edit requests ("regenerate step 3 to use the satisfaction-survey template instead") route to `agents.regeneratePlaybookStep` with the D-040 partial-regeneration semantics above.

**Example prompts the AI should handle horizontally:**

- STR: *"When a reservation is confirmed, send a welcome email; 3 days before check-in send the door code; on check-out launch the turnover workflow; 1 day after check-out send a review request."*
- LTR: *"When a lease is signed, kick off the move-in workflow; 30 days after move-in send a satisfaction survey; at 11 months send the renewal reminder workflow."*
- Commercial: *"When a tenant fit-out completes, log the COI; quarterly send the preventive-maintenance workflow; 90 days before lease expiration launch the renewal-notice workflow."*
- Vendor: *"When a vendor is upserted, send the W-9 request; wait for completion; quarterly launch the performance-review workflow."*

### 6.3 Entity-set scoping

Reuses the v1.5a `entity_set` model verbatim ([PRD_WORKFLOW_SOP_BUILDER.md](PRD_WORKFLOW_SOP_BUILDER.md) §6.1 — Layer-1 seam: `entity_set` with `entity_type` discriminator + polymorphic `entity_set_member` join + `EntityAdapter` registry). New column `playbook.entity_set_ids uuid[] DEFAULT '{}'` (empty = applies to all entities of any type — preserves the "no scoping" default).

When a Playbook trigger fires, the entity-set filter is intersected with the triggering entity's set memberships; mismatches don't launch a run. Same pattern as the v1.5a Workflow run-launch entity-set filter (PRD_WORKFLOW_SOP_BUILDER.md §6.2). In v1.5 only `entity_type='listing'` is wired through; future entity types (vendor, building, incident, etc.) gain Playbook scoping without schema changes once their `EntityAdapter` is registered.

### 6.4 Execution runtime (Inngest)

**Why Inngest.** Multi-step sequences with waits, branches, and event subscriptions are exactly Inngest's sweet spot. Bundling Playbooks v1 into [BUILD_PLAN.md](BUILD_PLAN.md) Phase 18 means Inngest gets justified by three features at once (automation rules + SLA-breach sweep migration + Playbooks), not one — closes the "do we have a real reason to add Inngest?" question raised in Phase 8 step 5.

**Runtime shape.**

- A Playbook run is materialized as one row in `playbook_run` plus one row per executed step in `playbook_run_step`.
- An Inngest function `playbook.run.<eventName>` subscribes to each lifecycle event. On fire, it filters by **`playbook.is_active = true`** (the top-bar Enabled/Disabled toggle from §6.1), trigger config, entity-set membership, and idempotency, then creates a `playbook_run` and dispatches the first step. Disabled Playbooks are skipped at dispatch time — load-bearing for the operator workflow of authoring a Playbook, dry-rendering it, and only enabling it once ready.
- Each step is executed via an Inngest step function. `wait_for_duration` uses `step.sleep`; `wait_for_event` uses `step.waitForEvent` with timeout; `launch_workflow` calls the existing `runs.launch` oRPC procedure, then optionally `step.waitForEvent('run.completed', { match: 'runId' })`.
- Failures: each step retries per Inngest's default policy; final failure marks the `playbook_run` as `failed` with the error captured in `result_payload`.
- Cancellation: an operator can cancel an in-flight Playbook run from the run detail page. Inngest function checks a `playbook_run.status='cancelled'` flag before each step boundary; cancelled mid-run means subsequent steps don't fire.

**Idempotency.** A unique `(playbookVersionId, triggerEntityRef, triggerFingerprint)` constraint on `playbook_run` prevents double-firing on duplicate trigger events.

**Audit attribution.** Every Playbook-driven write (a `runs.launch`, a notification, a data-set write) writes audit + activity rows with `actorKind='agent'`, `actorParticipantId` set to a synthetic system-agent row (one per org, find-or-created on first Playbook execution), and `crossProductOrigin` carried through if the trigger came from a PM webhook. The Playbook itself is referenced in the audit row's `entity_type='playbook_run'` + `entity_id`.

### 6.5 Three-views unification — read view on the Playbook detail page

Playbooks adopt the v1.5c three-views unification commitment ([PRD_WORKFLOW_SOP_BUILDER.md](PRD_WORKFLOW_SOP_BUILDER.md) §1.2, §6.5): **one detail page, three views** — the Playbook, its read-only rendering, and (eventually) its execution-time view are all surfaces of the same object. No separate `/sop/*` Playbook surface.

- **Detail page route:** `/playbooks/[id]?view=author` (default for editors) | `?view=read` (default for readers / linked from `/sop`).
- **Author view:** the builder canvas (§6.1). Edits the Playbook's source of truth.
- **Read view:** the published version rendered as a numbered **timeline** with step types, timing badges ("+7 days", "wait for run.completed"), and the trigger summary. Read-only.
- **`/sop` indexes both Workflows and Playbooks.** Operators searching `/sop` for "renewal" can find the Renewal Playbook *and* the Renewal Workflow; clicking a Playbook deep-links to `/playbooks/[id]?view=read`. The `/sop` route stays the browse-ergonomic readers' index per v1.5c; the detail pages stay canonical per object.

**Deliberate render asymmetry vs Workflows (per D-039).** Workflows render in Read view as a constrained-viewport *flowchart* (canonical PRD §6.4 R5 lift) — a flowchart reads naturally for branching procedures. Playbooks render as a *chronological timeline* — a timeline reads naturally for time-staged sequences. The timeline is to Playbooks what the flowchart is to Workflows; same Read-view *role*, different shape because the underlying object is different. The Playbooks-alignment review (Reviewer 6) confirmed this asymmetry is correct and intentional, not an oversight.

**Read-view behaviors.**
- Indexed by name, description, trigger summary, and step descriptions for the `/sop` search.
- Read receipts apply (operators "mark as read" the same way they do for workflows). The `sop_read_receipt` table from v1.5c carries `entity_type='playbook'` rows alongside workflow ones.
- **Strict no-execution from read view.** Read view never shows a "Run Playbook" button. Manual launch lives on the author view (and on the listings / runs index surfaces); the read view is reference-only, same Process-Street-KB-gap discipline that Workflows follow.

**Execute view (per-run timeline, R5-equivalent for Playbooks).** When the Read view is opened with a `runId` query param (e.g. linked from an Active Run card), the timeline flips from "projected timing" to "actual execution":

- Completed steps render with a muted styling + actual fired-at timestamps.
- The active step bolds + shows the `next_wake_at` countdown ("waits 4 more days, fires 2026-06-03 at 14:00").
- Pending steps render with projected timings (recomputed against the actual trigger payload, not the dry-render fake).
- Skipped branches (when a `branch_on_data_set` took a different path) render greyed-out with a "skipped: condition X" annotation.
- Static text, no animated coloring — the v2.0 PRD's "real-time colored flowchart execution overlay" was rejected for Workflows; the timeline-style equivalent for Playbooks delivers the same "I can see what's happening" intent without animation. (The reviewer noted real-time execution overlay is actually a *more compelling* fit for Playbooks than for Workflows, since multi-week sequences benefit from "where are we in the cadence" visualization — but v1 ships the static version.)

**Active Run right-rail card (R6, widened from Workflows).** Per canonical PRD §6.4, the entity-context Active Run card surfaces both `run` (Workflow) and `playbook_run` (Playbook) rows with a type chip distinguishing them. From a Playbook perspective:

- A Playbook orchestrating a 30-day STR lifecycle is exactly the kind of long-running thing an operator wants visible at all times on the listing detail page.
- Click on a Playbook row in the card opens `/playbooks/[id]?view=read&runId=<playbookRunId>` (read view with execute-view timeline overlay per the section above).
- The card title in any v1 UI surface labels itself "Active Run" (not "Active Workflow") so the Playbook semantics are accommodated from day one. If the org has overridden `playbooks → lifecycles` (per §6.6), the card row uses the overridden label in the type chip.

### 6.6 Configurable label per org

**Mechanism.** New column `organization.label_overrides jsonb NOT NULL DEFAULT '{}'`. A single React hook `useFeatureLabel(featureKey, fallback)` reads the active org's overrides and falls back to the schema default.

**v1 keys covered:** `playbooks` (default `"Playbooks"`), with `lifecycles` as the recommended override for CRE-leaning orgs.

**Scope.** UI text only:
- Nav labels, builder headings, button copy, library tab, `/sop` search-result labels, read-view headings on `/playbooks/[id]?view=read`.

**Out of scope of label override.**
- Schema column / table names: `playbook` stays canonical.
- API procedure names: `agents.authorPlaybook` stays canonical.
- URL paths: `/playbooks/*` stays canonical (search-friendly + matches API).
- Audit log / activity event entity_type values: `playbook` / `playbook_run` stay canonical.
- Webhook event names + integration payloads: `playbook.*` stays canonical.

**Admin UX.** Org settings → Branding → "Rename features" panel. Free-text override per supported feature key. Empty string resets to default. Audit row on every change.

**Forward compatibility.** The same hook + column supports renaming other features later ("Workflows" → "Procedures" for compliance verticals). v1 ships with only `playbooks` as a supported key; add others when a real customer asks.

## 7. UX flows

**Flow A — Manual Playbook authoring (happy path).**

1. Operator opens Library → Playbooks tab → **New Playbook**.
2. Names it ("STR Guest Lifecycle"), picks trigger (`run.completed` on workflow "STR Booking Confirmed"), picks entity-set scope ("Pet-Friendly Homes").
3. Adds steps in the vertical list: `send_notification` (welcome) → `wait_for_duration` (3 days before check-in) → `send_notification` (door code) → `launch_workflow` (turnover) → `wait_for_duration` (1 day) → `send_notification` (review request).
4. Dry-render preview shows fake-trigger-payload timing ("Would fire on Day 0, Day 4, Day 7, Day 14, Day 15 for a 7-day stay").
5. Publish → snapshot of the version locked, audit row written.

**Flow B — AI Playbook authoring.**

1. Operator clicks **Describe a Playbook**.
2. Pastes: *"When a long-term tenant signs, run move-in workflow, 30 days later send satisfaction survey, at 11 months send renewal-notice workflow."*
3. Server calls Claude → returns a 3-step Playbook draft with trigger inferred (`run.completed` on "Lease Signed" if found, else `manual` with a `precondition_note` to wire the trigger).
4. Two-pane review; accept-all → goes to builder for final tweaks → publish.

**Flow C — Trigger fires, Playbook runs.**

1. A "STR Booking Confirmed" workflow run completes.
2. Inngest function `playbook.run.run.completed` fires, finds the matching published Playbook (entity-set match, dedup check), creates `playbook_run` + first `playbook_run_step`.
3. Welcome notification dispatched; step marked complete; next step (`wait_for_duration: 3 days`) scheduled via `step.sleep`.
4. 4 days pre-arrival, step wakes → next notification → next wait → eventually launches the turnover workflow run and waits for its completion → final review-request notification → `playbook_run.status='completed'`.

**Flow D — Operator cancels mid-flight.**

1. Operator opens an active `playbook_run` from the runs index.
2. Clicks **Cancel** → confirmation modal explains "subsequent steps will not fire; in-progress workflow runs continue independently."
3. `playbook_run.status='cancelled'`, audit row written.

**Flow E — Org renames "Playbooks" → "Lifecycles".**

1. Admin opens Settings → Branding → Rename features.
2. Sets `playbooks` override to `"Lifecycles"`.
3. Save → all UI labels update (nav, builder, library tab, reader KB). URLs / API / audit names unchanged.

## 8. Data model & architecture

### 8.1 New schema

**Prerequisites from v1.5a (Phase 9.5).** This PRD does *not* declare the following — they're authored by [PRD_WORKFLOW_SOP_BUILDER.md](PRD_WORKFLOW_SOP_BUILDER.md) §6.1 + §8.1 and Playbooks reuses them:

- `review_state` enum (`draft | in_review | published | archived`)
- `entity_set` + `entity_set_member` tables (Layer-1 seam — `entity_type` discriminator, polymorphic member join; replaces draft-v1's `listing_cohort`)
- `EntityAdapter` TS interface + `ListingAdapter` implementation (v1.5 ships one adapter; future entity types add adapters without schema changes)
- `ai_authoring_prompt` table (shared provenance for AI-authored Workflows + Playbooks)
- `organization.require_concierge_review boolean`
- `step_provenance` enum (`ai_generated | manually_edited`) — declared in v1.5a for Workflows per D-040, reused by `playbook_step.provenance` below

Phase 9.6 (this PRD's schema seam) lands after Phase 9.5 in the build order; the SQL below assumes those v1.5a artifacts already exist.

```sql
-- Enums
CREATE TYPE playbook_step_type AS ENUM (
  'wait_for_duration',
  'wait_for_event',
  'launch_workflow',
  'send_notification',
  'branch_on_data_set',
  'write_to_data_set'
);

CREATE TYPE playbook_trigger_type AS ENUM (
  'manual',
  'lifecycle_event'
);

CREATE TYPE playbook_lifecycle_event AS ENUM (
  'run.completed',
  'run.state_changed',
  'listing.entity_set_added',
  'vendor.upserted'
);
-- Note: no `cross_product` value. PM-initiated work surfaces through `run.completed` /
-- `run.state_changed` with a `crossProductOrigin='virn-pm'` filter in `trigger_config`.
-- In v1.5 only `entity_type='listing'` participates in entity_set scoping; the
-- listing.entity_set_added naming convention extends to other entity types when their
-- EntityAdapter implementations ship post-v1.

CREATE TYPE playbook_run_status AS ENUM (
  'pending',     -- scheduled, not yet started
  'active',
  'waiting',     -- on a wait_for_duration or wait_for_event step
  'completed',
  'failed',
  'cancelled'
);

CREATE TYPE playbook_run_step_status AS ENUM (
  'pending',
  'active',
  'waiting',
  'completed',
  'skipped',     -- branched away from
  'failed',
  'cancelled'
);

-- Top-level entity (org-scoped, per D-006).
CREATE TABLE playbook (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  entity_set_ids uuid[] NOT NULL DEFAULT '{}',  -- reuses v1.5a entity_set ids; empty = applies-to-all
  review_state review_state NOT NULL DEFAULT 'draft',  -- reused from v1.5a
  is_active boolean NOT NULL DEFAULT false,  -- top-bar Enabled/Disabled toggle (§6.1). Disabled Playbooks skipped by Inngest dispatcher (§6.4). DEFAULT false so newly authored Playbooks must be explicitly enabled.
  current_version_id text REFERENCES playbook_version(id),
  ai_authoring_prompt_id text REFERENCES ai_authoring_prompt(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (organization_id, name)
);

-- Versioned snapshot (mirrors workflow_version semantics; D-018 invariants apply).
CREATE TABLE playbook_version (
  id text PRIMARY KEY,
  playbook_id text NOT NULL REFERENCES playbook(id) ON DELETE CASCADE,
  version int NOT NULL,
  trigger_type playbook_trigger_type NOT NULL,
  trigger_event playbook_lifecycle_event,                    -- null when trigger_type='manual'
  trigger_config jsonb NOT NULL DEFAULT '{}',                -- { workflowId?, stateFrom?, stateTo?, crossProductOriginFilter? }
  dedup_window_hours int,                                    -- null = no extra dedup beyond entity-ref uniqueness
  published_at timestamptz,
  published_by_user_id text REFERENCES "user"(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (playbook_id, version)
);

CREATE TABLE playbook_step (
  id text PRIMARY KEY,
  playbook_version_id text NOT NULL REFERENCES playbook_version(id) ON DELETE CASCADE,
  position int NOT NULL,
  branch_label text,                                         -- non-null on branch sub-paths
  parent_step_id text REFERENCES playbook_step(id) ON DELETE CASCADE, -- non-null for branch children
  type playbook_step_type NOT NULL,
  config jsonb NOT NULL,
  -- D-040 partial-regeneration contract: `agents.regeneratePlaybookStep` must not read or
  -- write any sibling step with `provenance = 'manually_edited'`. Default 'manually_edited'
  -- is the safe choice for backfilling existing rows -- only newly AI-emitted steps opt in
  -- to 'ai_generated'. Manual edits through the Edit Action modal (§6.1) flip the row back
  -- to 'manually_edited' irreversibly for v1.
  provenance step_provenance NOT NULL DEFAULT 'manually_edited',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_playbook_step_version ON playbook_step(playbook_version_id, position);
-- Note: `step_provenance` enum is declared in canonical PRD_WORKFLOW_SOP_BUILDER.md §8.1
-- (shipped in v1.5a / Phase 9.5) and reused here -- single enum across Workflows and
-- Playbooks per D-040. Phase 9.6 imports the existing enum; does not redeclare.

-- Runtime
CREATE TABLE playbook_run (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  playbook_version_id text NOT NULL REFERENCES playbook_version(id),
  status playbook_run_status NOT NULL DEFAULT 'pending',
  trigger_entity_type text,                                  -- 'run' | 'listing' | 'vendor' | etc.
  trigger_entity_id text,
  trigger_payload jsonb NOT NULL,                            -- snapshot of the inbound event payload
  trigger_fingerprint text NOT NULL,                         -- hash of (entityRef + meaningful payload fields) for dedup
  current_step_id text REFERENCES playbook_step(id),
  next_wake_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by_user_id text REFERENCES "user"(id),
  cross_product_origin text,                                 -- per D-027
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (playbook_version_id, trigger_entity_id, trigger_fingerprint)
);
CREATE INDEX idx_playbook_run_org ON playbook_run(organization_id);
CREATE INDEX idx_playbook_run_status ON playbook_run(status);

CREATE TABLE playbook_run_step (
  id text PRIMARY KEY,
  playbook_run_id text NOT NULL REFERENCES playbook_run(id) ON DELETE CASCADE,
  playbook_step_id text NOT NULL REFERENCES playbook_step(id),
  status playbook_run_step_status NOT NULL DEFAULT 'pending',
  result_payload jsonb,
  launched_run_id text REFERENCES run(id),                   -- non-null on completed launch_workflow steps
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_playbook_run_step_run ON playbook_run_step(playbook_run_id);

-- Org-level configurable labels (also services future feature renames).
ALTER TABLE organization
  ADD COLUMN label_overrides jsonb NOT NULL DEFAULT '{}';
```

**Entity-type enum.** Add `playbook`, `playbook_version`, `playbook_run`, `playbook_run_step` to the `entity_type` enum in [_shared.ts](../packages/database/drizzle/schema/_shared.ts).

### 8.2 oRPC procedures (new)

On the existing `workflows` router (mirrors workflows CRUD shape):

- `playbooks.list`, `playbooks.get`, `playbooks.create`, `playbooks.update`, `playbooks.delete`
- `playbooks.publish`, `playbooks.submitForReview`, `playbooks.approveReview`, `playbooks.sendBackToDraft`
- `playbooks.steps.create`, `playbooks.steps.update`, `playbooks.steps.delete`, `playbooks.steps.reorder`
- `playbooks.dryRender` — returns the projected step timeline given a fake trigger payload

On the runs router:

- `playbookRuns.list`, `playbookRuns.get`, `playbookRuns.cancel`, `playbookRuns.launchManual`

On the agents router (per [BUILD_PLAN.md](BUILD_PLAN.md) Phase 11 + 12):

- `agents.authorPlaybook` (new)
- `agents.regeneratePlaybookStep` (new)

All gated by the existing capability × permission model. New capability: `playbooks` (org-level capability flag — orgs without it don't see the Playbooks library tab or get the AI authoring entry). Plus optional finer-grained permissions for `playbooks.edit`, `playbooks.publish`, `playbookRuns.cancel`.

### 8.3 Inngest functions

- `playbook.dispatcher.<eventName>` — one function per lifecycle event type. Subscribes to the corresponding Inngest event emitted from the existing automation surface; finds matching published playbooks; creates `playbook_run` + dispatches the orchestrator.
- `playbook.orchestrator` — one long-running function per `playbook_run.id`. Walks step-by-step, using Inngest's `step.sleep` / `step.waitForEvent` / step retries. Writes `playbook_run_step` rows as it advances.
- `playbook.canceller` — subscribes to `playbook.cancel.requested` Inngest events; flips `playbook_run.status='cancelled'`; the orchestrator checks the flag at each step boundary.

Same Inngest deployment that hosts `automation.executor` (Phase 18) hosts these.

### 8.4 Audit + activity

Every Playbook-driven write follows the existing helper signature (per [BUILD_PLAN.md](BUILD_PLAN.md) Phase 8 step 1) with `actorKind='agent'`, `actorParticipantId` pointing to a synthetic per-org system-agent row (find-or-created), and `crossProductOrigin` carried through. New entity types added to the enum:

- `playbook`
- `playbook_version`
- `playbook_run`
- `playbook_run_step`

The Playbook run timeline view (UX §7 Flow D) reads `activity_event` filtered by `entity_type='playbook_run' AND entity_id=<runId>`.

## 9. Cross-repo touchpoints (D-024..D-033)

**No new cross-product event surface.** Per D-025, there are no PM → Ops webhook events in v1; PM initiates work by calling Ops's Action API as an agent principal (D-024 + D-033). Playbooks need no new inbound surface — they subscribe to existing internal Ops lifecycle events (`run.completed`, `run.state_changed`, etc.) and use the audit/activity `crossProductOrigin` column (D-027) to filter on origin when scoping matters.

**PM-initiated runs trigger Playbooks naturally.** When PM calls `runs.launch`, the resulting Ops run carries `crossProductOrigin='virn-pm'`. When that run completes, the existing `run.completed` trigger fires; a Playbook scoped to PM-initiated work adds `{ crossProductOriginFilter: 'virn-pm' }` to its trigger config. The Playbook's outbound effects (e.g. `launch_workflow` steps that create more runs) propagate `crossProductOrigin` through the audit chain, and any webhook deliveries back to PM carry the same attribution.

**PM cannot author Playbooks.** Playbooks are an Ops-side primitive; PM has no symmetric concept (per D-033, PM ships no Action API in v1). If PM later wants "lifecycle plays" of its own, it's a PM-internal build that can reuse this PRD as architectural inspiration but doesn't share schema.

**No PM Action API consumption from Playbooks in v1.** Playbook step types do not include "call PM directly" — that would violate D-033's posture. If a Playbook needs PM data, it reads from Ops's local mirror (vendor sync surface per D-028) or launches a workflow that handles the read via the existing means.

## 10. Constraints honored (existing invariants)

| Invariant | Source | How Playbooks respect it |
|---|---|---|
| Org-scoping top-level | D-006 | `playbook` carries `organization_id`; every child row inherits via FK |
| Snapshot immutability on publish | D-018 / D-019 | `playbook_version` is the snapshot; in-flight `playbook_run`s point to a specific version_id; editing creates a new version |
| Append-only audit | ARCHITECTURE Invariant #6 | All `playbook_run` lifecycle transitions write audit + activity rows |
| Definition / execution split | ARCHITECTURE | `playbook` (definition) vs `playbook_run` (execution); matches workflow/run split |
| Two-axis gating (capability × permission) | existing config model | New `playbooks` capability + per-action permissions |
| Entity-set scoping | v1.5a (D-034 / PRD_WORKFLOW_SOP_BUILDER §6.1) | Empty array = applies-to-all; intersection match on trigger; reuses `entity_set` model |
| Three-views unification | v1.5c (PRD_WORKFLOW_SOP_BUILDER §1.2, §6.5) | `/playbooks/[id]?view={author|read}` — one detail page, two views; `/sop` browse index links to read view |
| AI authoring grounded in tenant entity schema | Layer 3 (PRD_WORKFLOW_SOP_BUILDER §6.3) | System prompt embeds tenant schemas via `EntityAdapter` registry; validator rejects unknown entity references |
| AI-authoring palette + dueType gates | PRD_WORKFLOW_SOP_BUILDER §6.3 | AI restricted to the six v1 step types + the v1 trigger set |
| Read-view strict no-execution | PRD_WORKFLOW_SOP_BUILDER §6.5 | Read view never shows a launch button; manual launch on author view only |
| `actorKind` + `crossProductOrigin` attribution | D-027 | Per-org synthetic system-agent; `crossProductOrigin` propagated from trigger |
| No Docker | memory feedback | Inngest hosted; no compose changes |
| Top-level routes must be in `forbiddenOrganizationSlugs` | memory feedback | Adds `playbooks` to [packages/auth/config.ts](../packages/auth/config.ts) + snapshot in the same migration |
| Step-list canonical; render asymmetry (timeline vs flowchart) is intentional | D-039 | Playbooks were step-list-only per §5 since first draft; D-039 ratified the same posture for Workflows. Playbook Read view renders as a chronological timeline; canonical PRD's Workflow Read view renders as a constrained-viewport flowchart. Same Read-view role, different shape per object semantics. |
| Per-step regenerate preserves manual edits | D-040 | `playbook_step.provenance` enum (reused from canonical PRD's `step_provenance` enum); `agents.regeneratePlaybookStep` never reads or writes any sibling step with `provenance='manually_edited'`. Manual editing through the Edit Action modal (§6.1) flips a row's provenance back to `'manually_edited'`. |
| Canvas/layout state lives outside the snapshot | D-041 | No canvas in v1, but the constraint is documented in §15: if Phase 13+ ever ships canvas authoring for Playbooks, layout lives in a separate `playbook_canvas_layout` table keyed by `playbook_id` — never on `playbook_version`. |

## 11. Phasing

**Total: ~4 weeks**, split across three Phase windows in [BUILD_PLAN.md](BUILD_PLAN.md): a thin schema seam (Phase 9.6), then the execution + authoring landing inside Phase 18.

### Phase 9.6 — Playbook schema seam (0.5 week, no UI)

**Sequencing.** Lands *after* Phase 9.5 (v1.5a — entity-set seams + review_state + ai_authoring_prompt + property-ops pack content refresh per D-034). v1.5a is the canonical source of the `review_state` enum, the `entity_set` / `entity_set_member` model + `EntityAdapter` registry, and the `ai_authoring_prompt` table — Playbooks reuse all of them rather than redefine. Phase 9.6 must therefore follow v1.5a in the build order: 7 → 8 → 9 → 9.5 → **9.6** → 11 → 12 → 10 → 13 → 14 → … → 18.

Schema-only; no procedures, no UI, no Inngest functions. Goal: lock the Playbook tables (and the `label_overrides` column) before Phase 18 execution work begins.

- Tables + enums per §8.1 (Playbook-specific only — v1.5a primitives are referenced, not redeclared).
- `playbook.is_active boolean NOT NULL DEFAULT false` column (per the Inngest dispatcher gate in §6.4).
- `playbook_step.provenance step_provenance NOT NULL DEFAULT 'manually_edited'` column (per D-040; reuses the `step_provenance` enum declared in v1.5a / Phase 9.5 for Workflows).
- `entity_type` enum additions.
- `organization.label_overrides` column.
- `forbiddenOrganizationSlugs` update.

No business logic yet; no behavior change. Idempotent re-run safe.

### Phase 18a — Playbook authoring (2 weeks, no execution)

Authoring + read surfaces only. Nothing executes yet — wait steps make a synchronous orchestrator infeasible, so all execution waits for Inngest in 18b.

- oRPC procedures per §8.2 for CRUD, publish, review-state transitions, and `playbooks.dryRender`.
- Builder UI: tri-column shell (left rail: Playbooks list, center: vertical step list, right rail: persistent Playbook Assistant chat panel) + top bar (Enabled toggle / Scope chip / Review-state banner per §6.1).
- **Template Variables sidebar (R4)** rendering tokens from `EntityAdapter.schemaForAI()`; drag-drop into `send_notification` body / `kickoffMapping` / `branch_on_data_set` source expressions.
- **Edit Action modal pattern (C5)** for per-step config — Title / Description with `{}` Template insert / step-type config / Regenerate / Delete / Cancel / Save Changes.
- Dry-render preview rendering the projected timeline against a fake trigger payload.
- Library Playbooks tab + reader-KB integration (Read view renders timeline per §6.5).
- `playbookRuns.list` / `playbookRuns.get` (read-only — no runs exist yet beyond the dry-render synthetic).

No live triggers, no manual launch button, no cancellation surface. Published Playbooks sit dormant until 18b ships.

### Phase 18b — Execution: Inngest orchestration + triggers + manual launch (1 week)

- Inngest event emissions on `run.completed`, `run.state_changed`, `listing.entity_set_added`, `vendor.upserted` (Ops emits these to its own Inngest, not to PM).
- Inngest dispatcher + orchestrator functions per §8.3. **Dispatcher filter includes `playbook.is_active = true`** (§6.4) — disabled Playbooks skipped at dispatch time.
- `playbookRuns.launchManual` (lights up the "Run Playbook" button on the Playbook detail page) — dispatched through the same Inngest pipeline that handles lifecycle-event triggers; manual launch ignores `is_active` (operator-initiated, intentional override of the dispatcher gate).
- Cancellation flow (`playbookRuns.cancel`).
- **Active Run right-rail card (R6)** widening from canonical PRD §6.4 — entity-context pages surface both `run` and `playbook_run` rows with a type chip. Card row click on a Playbook opens `/playbooks/[id]?view=read&runId=<playbookRunId>` (execute-view timeline per §6.5).
- **Execute-view timeline (per §6.5)** — `/playbooks/[id]?view=read&runId=<id>` flips the projected-timing timeline to actual fired-at + `next_wake_at` countdown.

### Phase 18c — AI authoring (0.5 week)

- `agents.authorPlaybook` + `agents.regeneratePlaybookStep` procedures. **`regeneratePlaybookStep` enforces D-040 partial-regeneration semantics** — server-side validator refuses to write any sibling step with `provenance='manually_edited'`; surface-side preview lists which siblings are protected before the regen fires.
- "Describe a Playbook" entry point + two-pane review UX (forks PRD_WORKFLOW_SOP_BUILDER §6.1 UI). **Right pane renders as the timeline (per §6.5), not as a flowchart** — Playbooks never render as a node-graph.
- **Persistent Playbook Assistant chat panel** (R1) wired to `agents.regeneratePlaybookStep` as the post-generation refinement surface (per §6.2).
- System prompt + validator per Appendix A.
- Dogfood pass on the example prompts from §6.2.

### Property-ops pack content (post-Phase 17, parallel)

Ship 3–5 starter Playbooks with the property-ops pack:

- STR Guest Lifecycle (welcome → mid-stay → turnover → review)
- LTR Tenant Onboarding (move-in → 30-day check → 90-day inspection → renewal reminder)
- Commercial Tenant Onboarding (COI → utilities → key handoff → quarterly check-in)
- Vendor Lifecycle (W-9 collect → quarterly performance review)
- Maintenance Follow-up (work-order completed → satisfaction survey → 30-day re-check)

## 12. Open questions

1. **Should `wait_for_event` support arbitrary events or only a curated list?** Lean: curated list in v1 (the same lifecycle events available as triggers, plus run-step-completed). Arbitrary event subscription is a footgun for non-technical authors. **Decide at Phase 18b implementation.**
2. **Per-org Inngest rate limits.** A Playbook with a high-volume trigger could create thousands of `playbook_run`s. Cap per-org `playbook_run` creations per hour? Lean: soft cap of 1000/hour with admin alert; hard cap of 5000/hour. **Confirm with billing model owner.**
3. **`wait_for_event` timeout default.** If a Playbook waits for `run.completed` but the run is cancelled or hangs indefinitely, the Playbook hangs too. Default timeout? Lean: 90 days, configurable per step, with `onTimeout: 'abort'` as the safe default. **Confirm with first dogfood Playbook.**
4. **Cross-Playbook chaining in v1.1.** Cycle detection isn't free — graph traversal at publish time, or runtime depth limit? Lean: depth limit (max 3 Playbook-in-Playbook nestings) is simpler than graph analysis. **Punt to v1.1 PRD.**
5. **Label override audit retention.** When an org renames "Playbooks" → "Lifecycles" then back, do we retain history? Lean: yes via audit log (every override write is an audit row); no separate retention table. **No action — falls out of existing audit model.**
6. **Playbook visibility in PM Action API consumer view.** When PM lists Ops runs for a service request, should it also see Playbook runs that *launched* those runs? Lean: not in v1 — Playbook run IDs are Ops-internal. PM sees the run it caused; the Playbook orchestration is opaque. **Confirm in next cross-repo sync.**

## 13. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Inngest cost balloons with high-volume Playbook triggers | Medium | Per-org rate caps (open question #2); per-month spend alert; dogfood with a single Playbook before broad rollout |
| Operators confuse Playbooks with Workflows | Medium | Tight product copy: "Workflows = procedures; Playbooks = lifecycles." Builder onboarding card explicitly contrasts. Two distinct library tabs. |
| AI generates Playbooks that reference workflows that don't exist | High | Validator flags missing references as `precondition_note` comments on the step; never hard-fails. Review pane surfaces them prominently. |
| Long-running Playbook runs (>90 days) hit Inngest function timeout limits | Medium | `wait_for_duration` uses `step.sleep` which Inngest handles transparently across long horizons. Validate with a >90-day test sleep in dogfood. |
| Trigger storm from a misconfigured workflow completing in a loop | Low (idempotency guard) | `(playbook_version_id, trigger_entity_id, trigger_fingerprint)` UNIQUE constraint catches it; emit alert when dedup hits exceed threshold |
| Label override creates user confusion in support contexts | Low | Audit log carries canonical "playbook" name; support docs always use canonical. Override is UI-only by design (§6.6) |
| Cross-product trigger fires before vendor sync has caught up | Medium (per D-028) | Stale-sync inbounds logged as `vendor.sync_skipped_stale`; Playbook orchestrator reads from the post-sync state, so trigger payload may carry slightly stale data — acceptable for v1 |

## 14. Success metrics

Tracked in PostHog + ops dashboard, reviewed at 30 / 60 / 90 days post-launch:

| Metric | Target |
|---|---|
| % of orgs with ≥1 published Playbook by day 30 | > 50% |
| % of new Playbooks started via AI authoring vs blank | > 50% by day 60 |
| Median Playbook run completion rate (excluding cancellations) | > 80% |
| Median time from AI prompt → published Playbook | < 15 min |
| Playbook trigger-to-first-step latency p95 | < 60 seconds |
| Orgs using the `playbooks → lifecycles` rename | Tracked; informs future label-override demand signals |
| Playbook run failures attributable to step-config errors (not infra) | < 5% |
| AI authoring Claude API cost per published Playbook | Tracked; target TBD post-dogfood |

## 15. Out-of-scope but design-aware

- **Cross-Playbook chaining** — depth-limited launch from `playbook_step` of another Playbook. Schema seam: `playbook_step.config` jsonb can carry `{ launchPlaybookId }` without ALTER when v1.1 ships.
- **Per-step conditional visibility** — Workflows Phase 6 surface; Playbooks don't need it because branching is a step type, not a step modifier.
- **Visual canvas authoring** — if user research demands it post-v1 and a Phase 13+ ADR overrides D-039, any such canvas must follow D-041: layout state (coordinates, anchor ports, viewport zoom) lives in a separate `playbook_canvas_layout` table keyed by `playbook_id`, **never** on `playbook_version`. The current vertical step list converts to a top-down canvas trivially; only the layout-persistence shape is constrained (per D-041 snapshot-immutability rationale).
- **Playbook templates** — `template_listing` already supports the templating mechanism; add a Playbook variant when the property-ops pack ships its starter Playbooks.
- **Per-Playbook agent grants** — when S-07 mode (c) (fully automated runs) deepens, Playbooks may need their own agent identity rather than the shared per-org system-agent. Defer until there's a real isolation need.
- **A/B testing cadences** — out of scope; orgs that need it fork the Playbook manually.

---

## Appendix A — AI Playbook authoring contract (Zod)

```ts
const PlaybookDraft = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  entitySetHints: z.array(z.string()).default([]),  // free text; mapped to entity_set rows at install time

  trigger: z.discriminatedUnion("type", [
    z.object({ type: z.literal("manual") }),
    z.object({
      type: z.literal("lifecycle_event"),
      event: z.enum([
        "run.completed",
        "run.state_changed",
        "listing.entity_set_added",
        "vendor.upserted",
      ]),
      // Free-text references — resolved (or flagged as precondition_note) at validation.
      // Entity refs cross-checked against the EntityAdapter registry (Layer-1 seam).
      workflowRef: z.string().optional(),
      stateFrom: z.string().optional(),
      stateTo: z.string().optional(),
      crossProductOriginFilter: z.enum(["virn-pm"]).optional(),  // D-027
    }),
  ]),

  steps: z.array(z.object({
    label: z.string().min(1).max(120),
    type: z.enum([
      "wait_for_duration",
      "wait_for_event",
      "launch_workflow",
      "send_notification",
      "branch_on_data_set",
      "write_to_data_set",
    ]),
    config: z.record(z.unknown()),       // type-specific, validated by a discriminated narrower
    preconditionNote: z.string().optional(),  // AI hint for missing refs / Phase 6 features
    branches: z.array(z.object({         // only set when type='branch_on_data_set'
      label: z.string(),
      stepIds: z.array(z.string()),
    })).optional(),
  })),
});
```

## Appendix B — Reference

- Builder Pass 3 UI: [apps/saas/modules/builder/](../apps/saas/modules/builder/)
- Workflow schema: [packages/database/drizzle/schema/workflows.ts](../packages/database/drizzle/schema/workflows.ts)
- Automation primitives (event/rule/action) the Playbook orchestrator complements: [packages/database/drizzle/schema/automation.ts](../packages/database/drizzle/schema/automation.ts)
- Run launch (target of `launch_workflow` step type): [packages/api/modules/runs/lib/launch-run.ts](../packages/api/modules/runs/lib/launch-run.ts)
- Agents router (extends for AI authoring): [packages/api/modules/agents/router.ts](../packages/api/modules/agents/router.ts)
- Cross-repo lifecycle event catalog: [docs/DECISIONS.md](DECISIONS.md) D-025
- Strategy + sequencing context: [docs/STRATEGY.md](STRATEGY.md), [docs/BUILD_PLAN.md](BUILD_PLAN.md) Phases 8, 11, 12, 18
- Architecture invariants: [docs/ARCHITECTURE.md](ARCHITECTURE.md) §3–5
- Companion PRD (Workflow & SOP Builder v1.5): [docs/PRD_WORKFLOW_SOP_BUILDER.md](PRD_WORKFLOW_SOP_BUILDER.md)
