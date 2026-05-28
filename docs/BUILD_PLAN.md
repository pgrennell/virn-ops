# BUILD_PLAN.md

Phased roadmap for building Virn Ops. Each phase is roughly one Claude Code session —
verify and commit between phases. Follow CLAUDE.md / agents.md conventions and
ARCHITECTURE.md invariants throughout. Do not run migrations against Neon without
explicit confirmation.

**Status:** Draft v2 (post-pivot — see DECISIONS.md D-021) · **Date:** 2026-05-26

**Reading order.** `STRATEGY.md` answers *why this order*; `ARCHITECTURE.md` answers
*what stays true throughout*. The S-0x bets referenced here are defined in
`STRATEGY.md` §5.

---

## What changed from v1

The pivot (D-021) re-sequences the plan around two goals: **(1) win the property-ops
vertical**, and **(2) ship a v1 that looks AI-credible in 2026**, not a v1 that
looks like 2023. Foundation phases (0, 1, 2, 3, 4 — schema, config, run engine, oRPC)
are unchanged and largely complete. The downstream phases (5 onward) are
substantially re-ordered:

- **AI authoring + the agent-safe action surface (S-01)** moves from "later" into v1.
  Protocol posture clarified: oRPC is the canonical contract; an MCP wrapper ships
  alongside as a good-citizen alternative for MCP-host compatibility (not the source
  of truth — STRATEGY S-01a).
- **Data Sets minimal subset (S-02)** moves from Batch 7 deferred into v1.
- **Reader-KB surface (S-03)** is added as an explicit v1 phase (previously
  unspecified).
- **Operator surfaces (My Work, Run view, Guest run view)** move from
  `[DESIGNED · build deferred]` into v1 (vertical-first means execution surfaces
  are launch-critical).
- **One-procedure-three-modes UI (S-07)** is added as the headline-wedge phase.
- **Lightweight monitor (S-06)** + **thin compliance/evidence surface (S-10)** ship
  in v1.
- **Property-ops pack** is the first and only pack in v1 — concrete content shape:
  STR turnover & housekeeping.
- **Slack/Teams in-flow delivery (S-09)**, pack marketplace, white-label, and the
  full reports/BI stack move to **v1.1+**.

### Update 2026-05-27 — Workflow & SOP Builder v1.5 PRD (architectural re-anchoring per D-034)

[PRD_WORKFLOW_SOP_BUILDER.md](PRD_WORKFLOW_SOP_BUILDER.md) (Draft v2) bundles the next
builder push as **v1.5a/b/c**, friendly parity with Besty's PM-side SOP builder,
re-anchored around the 3-layer architecture from the 2026-05-27 strategic
conversation:

- **Layer 1 — Configurable entity model.** v1.5 ships seams only (`entity_set` with
  `entity_type` discriminator, polymorphic member join, `EntityAdapter` registry
  — one `ListingAdapter` impl). Full custom-object system is a multi-month phase
  post-v1.
- **Layer 2 — Vertical-agnostic workflow engine.** v1.5 generalizes cohort filter
  to entity-set scoping; documents the v1 action vocabulary as the closed set.
- **Layer 3 — AI authoring grounded in tenant entity schema.** What makes a
  horizontal builder feel like Besty even when the nouns are configurable.

Plus the **three-views unification** commitment (PRD §1.2): SOP / KB article /
runnable workflow are three views of one object. Editing once updates all.
Replaces the v1-draft "separate `/sop/*` reader surface" — `/sop` becomes a
browse-ergonomic readers' index that deep-links to the same detail page with
`?view=read`.

Slots into existing phases as follows:

- **v1.5a** → new **Phase 9.5** (entity-set seams + review states + property-ops
  pack content refresh). Renamed from the v1-draft "listing cohorts" framing.
  No AI dependency; can ship in parallel with Phase 9.
- **v1.5b** → **Phase 12 (AI authoring) pulled forward** to ship right after
  Phase 11 (action surface). AI authoring lives behind the agents oRPC router so
  MCP hosts inherit it for free; system prompt embeds the tenant's entity schema
  (cached per org); validator cross-checks entity references against the live
  adapter registry.
- **v1.5c** → **Phase 10 (three-views unification + reader surface)**. Detail
  page becomes a view-switcher (`?view={author|read}`); `/sop` is the readers'
  browse surface; collapses the "KB and Builder as separate features" trap that
  Besty and Process Street fall into.

Pack ordering (D-034): **STR pack remains v1 wedge.** Commercial PM / Residential /
IT Ops packs deferred to post-v1, triggered by either (a) early commercial design-
partner pull or (b) Layer-1 completion. v1.5 architecture is pack-agnostic; only
the content (templates, dogfood profile, marketing copy) skews STR.

Resulting build order through v1.5: 7 → 8 → 9 → 9.5 → **9.6** → 11 → 12 → 10 → 13 → 14 → …
(Phase 11 must precede 12 because the AI authoring procedures live on the agents
router that 11 builds. Phase 9.6 is the Playbooks schema seam — see the next
subsection.)

### Update 2026-05-27 — Playbooks PRD (lifecycle-sequence primitive)

[PRD_PLAYBOOKS.md](PRD_PLAYBOOKS.md) introduces **Playbooks** as a sibling content
object to Workflow — multi-step, time-and-event-staged sequences triggered by
lifecycle events. Distinct primitive from Workflows: Workflows handle decision /
branching procedures (one event → branching steps); Playbooks handle cadences
over time (one lifecycle event → sequence of further actions, often invoking
workflows). Pattern lifted from Besty's "Journeys" concept, generalized and
renamed for horizontal property-ops + configurable label per org (Lifecycles for
CRE-leaning orgs, etc., via `organization.label_overrides jsonb`).

Slots into existing phases as follows:

- **Phase 9.6** (new — lands *after* 9.5 so it can reuse v1.5a's `entity_set`,
  `review_state`, and `ai_authoring_prompt` rather than redefine them) — thin
  schema seam: `playbook` / `playbook_version` / `playbook_step` / `playbook_run`
  / `playbook_run_step` tables, `playbook_step_type` + `playbook_lifecycle_event`
  enums, `organization.label_overrides` column, `forbiddenOrganizationSlugs`
  update for `/playbooks`. No business logic, no UI, no Inngest. Idempotent
  re-run safe.
- **Phase 18a** (authoring) — Playbook CRUD + builder UI (vertical step list) +
  dry-render preview + library tab + reader-KB integration via the v1.5c
  three-views unification (a Playbook's detail page becomes a view-switcher on
  `?view={author|read}`, same pattern as Workflows; `/sop` indexes both).
  Read-only `playbookRuns.list/get`. No execution yet.
- **Phase 18b** (execution) — Inngest dispatcher + orchestrator functions emit
  + subscribe to `run.completed` / `run.state_changed` / `listing.entity_set_added`
  / `vendor.upserted`. `playbookRuns.launchManual` lights up. Cancellation flow.
  Bundles cleanly with Phase 18's existing Inngest landing — three features
  justify the runtime (`automation_rule` execution + SLA-sweep migration from
  Vercel Cron + Playbooks).
- **Phase 18c** (AI authoring) — `agents.authorPlaybook` + `agents.regeneratePlaybookStep`
  on the agents oRPC router; system prompt grounded in tenant entity schema
  (same Layer-3 pattern as Workflow AI authoring per PRD_WORKFLOW_SOP_BUILDER §6.3).

**Architectural alignment with v1.5 (D-034).** Playbooks adopt the same entity-set
scoping model as Workflows (`playbook.entity_set_ids uuid[]`); the three-views
unification applies (one detail page, `?view=` switcher); AI authoring grounds in
the same tenant entity schema. No new architectural primitives — Playbooks are a
new *content object* on the same Layer-1/2/3 architecture.

**PM cross-repo posture.** No new event surface, no new webhook events. PM-initiated
work flows through existing `run.completed` / `run.state_changed` triggers with a
`crossProductOriginFilter` in trigger config (per D-027). PM ships no symmetric
Playbooks concept (per D-033). See [PRD_PLAYBOOKS.md](PRD_PLAYBOOKS.md) §9.

---

## Completed phases (foundation)

### Phase 0 — base ✓

Supastarter cloned, switched to Drizzle, Neon wired (pooled = app, direct =
migrations), `@virn/*` scope applied, schema files wired into `schema/postgres.ts`,
`pnpm --filter database generate` succeeds, app boots with `pnpm dev`. See D-001,
D-004, D-005.

### Phase 1 — data model ✓

All schema batches generated and squashed into `0000_initial.sql`. See D-002, D-006,
D-007, D-008, D-009, D-010, D-011, D-012, D-013. Per D-021, **Batch 7 (datasets.ts)
is no longer "deferred — schema only"** — it ships in Phase 9 (Data Sets minimal)
with the `lookup` field type wired through.

### Phase 2 — config / mode system ✓

Capability/setting resolver, three enablement profiles, org-config admin UI. Note: the
three modes (Checklist / SOP / Automation) remain as the abstract enablement model,
but the *first-customer* experience is going to land them in property-ops via the
pack, not via the mode picker. The mode picker is a power-user surface; revisit
post-v1 whether to keep it in the onboarding flow.

### Phase 3 — run engine ✓

Snapshot a published `workflow_version` into `run` + `run_step`; resolve role →
participant assignments; structured due dates; stop-task gating; status transitions;
Inngest cron for scheduled runs. See D-014, D-015, D-016.

### Phase 4 — oRPC API surface ✓

Workflow/version/step/field CRUD; run operations; config procedures. All org-scoped
via `protectedOrgProcedure` / `adminOrgProcedure`. See D-020 (curated exports
cleanup pending — not a blocker).

### Phase 5 — Workflow Builder UI (Pass 1–3) ✓

Authoring canvas, slide-in config panel, draft/publish, preview-as-dry-render,
field-key lifecycle, resume-or-fork. See D-017, D-018, D-019.

### Phase 6 — Library (Pass 1) ✓

List + create + navigate + act (author→discover→run loop). See `feat(library)`
commit `edb465e`.

---

## v1 phases (re-sequenced per D-021)

Each phase is one Claude Code session-sized chunk. Within v1, sequence matters —
phases that unlock the wedge (S-07) or the unfair advantage (S-01a action surface) come early
so downstream surfaces can lean on them.

### Phase 7 — Operator surfaces (My Work + Run view + Guest run view)

UX_SPEC §5.1–§5.4. Pulls operator screens out of `[DESIGNED · build deferred]` and
into v1 because vertical-first launch requires execution surfaces, not just
authoring.

- **Home (bridge dashboard)** — task-forward for operators, run/approval context for
  builders/admins.
- **My Work** — task inbox over `run_step` assignments, group-by due/run, blocked
  state for stop-tasks.
- **Run / Checklist view** — single-run execution surface; live field inputs;
  complete actions; comments/activity.
- **Guest run view** — no-nav tokenized portal for `participant` (guest email) to
  complete only their assigned step(s).

Gating per the two-axis model (capability × permission). Admin/Owner reaches all for
testing.

### Phase 8 — One-procedure-three-modes wedge (S-07) — headline product story

The wedge surface, in three coordinated changes. **Schema foundation locked by
ARCHITECTURE.md ADR-006 + ADR-007 + DECISIONS.md D-022 + D-023 (2026-05-27) — land
the migration first, before any agent- or vendor-aware code. All four participant
kinds (user, guest, agent, vendor) land in this one migration.**

1. **Schema migration (per D-022 + D-023) — single migration, no agent or vendor
   code yet.**

   **Agent side (per D-022):**
   - New `drizzle/schema/agents.ts` with `agent` table (org-scoped, top-level per
     D-006: `id`, `organizationId`, `name UNIQUE per org`, `description`,
     `credentialHash`, `credentialLastFour`, `credentialRotatedAt`, `isActive`,
     `createdByUserId`, `timestamps`, `deletedAt`) and `agent_capability` join
     (`agentId`, `capabilityId`, `UNIQUE(agentId, capabilityId)`).
   - `ALTER TYPE participant_kind ADD VALUE 'agent'`.
   - `participant.agentId text NULLABLE REFERENCES agent(id) ON DELETE RESTRICT`
     with `CHECK ((kind = 'agent') = (agentId IS NOT NULL))`.

   **Vendor side (per D-023):**
   - New `drizzle/schema/vendors.ts` with:
     - `vendor` table (org-scoped, top-level per D-006: `id`, `organizationId`,
       `name UNIQUE per org`, `description`, `categoryId` FK to `vendor_category`,
       `status` enum (`active | preferred | approved | under_review | probation |
       blacklisted`), `isActive`, `linkedPmVendorId text NULLABLE` (string,
       cross-product reference — no `REFERENCES` clause), `createdByUserId`,
       `timestamps`, `deletedAt`).
     - `vendor_contact` table (`id`, `vendorId`, `name`, `email`, `phone`, `role`,
       `isPrimary`, `isActive`, `timestamps`).
     - `vendor_capability` join (`vendorId`, `capabilityId`,
       `UNIQUE(vendorId, capabilityId)`).
     - `vendor_category` lookup table (`id`, `organizationId NULLABLE` for
       platform-seeded vs org-custom, `slug`, `name`, `description`,
       `parentCategoryId text NULLABLE` (plain text per D-012), `timestamps`).
   - `ALTER TYPE participant_kind ADD VALUE 'vendor'`.
   - `participant.vendorId text NULLABLE REFERENCES vendor(id) ON DELETE RESTRICT`
     and `participant.vendorContactId text NULLABLE REFERENCES vendor_contact(id)
     ON DELETE RESTRICT` with `CHECK ((kind = 'vendor') = (vendorId IS NOT NULL
     AND vendorContactId IS NOT NULL))`.

   **Cross-cutting (audit + activity):**
   - New `actor_kind` pgEnum **with all four values** (`user | guest | agent |
     vendor`); `audit_log.actorKind NOT NULL` (backfill existing rows to `'user'`);
     `activity_event.actorKind NOT NULL` (same backfill). Add
     `audit_log.actorParticipantId text NULLABLE REFERENCES participant(id)` in
     this same migration (working assumption per D-022, so Phase 11 is purely
     behavioral).
   - **Per D-027 (cross-repo, 2026-05-27):** also add
     `audit_log.crossProductOrigin text NULLABLE` and
     `activity_event.crossProductOrigin text NULLABLE` in this same migration. Values
     are not enum-constrained (free text: `virn-pm`, `virn-ops`, future third-party
     identifiers). Set when a write originated from an inbound cross-product webhook or
     a sibling-product call through the Action API. Symmetric with PM's identical
     additive migration. Cheap, additive, no UI surfacing needed in v1.

   **Wiring:**
   - Wire both `agents.ts` and `vendors.ts` into the `postgres.ts` barrel; run
     `pnpm --filter database generate`; show the generated SQL before applying.
     Do not run against Neon without explicit confirmation (per CLAUDE.md /
     agents.md).
   - Update `writeAuditAndActivity` helper signature: `actorKind: 'user' |
     'guest' | 'agent' | 'vendor'` (default still `'user'` for backward compat).

2. **Assignee model extension** — `participant` now supports all four kinds
   (`user | guest | agent | vendor`) via the migration above. Runtime semantics by
   kind:
   - `agent` assignee → fulfilled via the agent-safe action surface (Phase 11),
     not a human UI.
   - `vendor` assignee → fulfilled by a specific `vendor_contact` via the existing
     tokenized guest-run-view path, with vendor-aware UI ("Acme Pest Control — Mike
     Smith" in step assignee displays, audit feeds, run timelines).
   - `user` / `guest` assignees → unchanged from existing behavior.
   - All four kinds use the existing `run_step_assignee → participant.id` chain.
   `writeAuditAndActivity` helper signature extends to include `'vendor'`; existing
   call sites unchanged.

3. **Run launch mode selector** — `runs.launch` accepts a mode hint
   (`human | ai_assisted | automated`). The hint shapes default assignees:
   - `human` → user / guest / vendor assignees per the workflow's authored
     `step.assignee_kind_preference` (TBD: whether this is a step-level setting or
     just default-by-step-type).
   - `ai_assisted` → agent on `step.type='ai'` steps; user/guest/vendor on others;
     handoff steps where a human reviews agent output.
   - `automated` → agent on all steps where capability allows; falls back to
     human/vendor only if no agent is capable of that step type.
   The *authored procedure is unchanged* across modes — variation lives in
   execution, not authoring (Invariants #2–#5). UI surfaces clearly which kind of
   actor will handle each step and where the handoff points are. The
   agent-selection picker reads from `agent` filtered by `isActive=true ∧
   deletedAt IS NULL` and intersected with the active capability set; the
   vendor-selection picker reads from `vendor` with the same filters plus
   category-matching when the step has a vendor-category constraint.

4. **Lift `step.type=ai`** from reserved to live — the primitive for "this step is
   an agent action." Builder gates exposing this option on
   `capability_enabled(org, 'agent_steps')` (the existing capability × permission
   gating, no new mechanism).

5. **SLA-driven escalation via Vercel Cron** (v1 path, *not* Inngest, *not* full
   SLA event catalog). ADR-003 defers SLA-breach events and the full action
   catalog. But v1 use cases (property-ops pack — e.g. "pest control work order
   not completed within X days, escalate to manager") require basic escalation
   on overdue runs.

   **Implemented (2026-05-27):** Vercel Cron hits `/api/cron/sla-sweep` hourly
   (`0 * * * *`) in production. The endpoint authenticates via `Authorization:
   Bearer ${CRON_SECRET}` and calls `runSlaSweep` (lib) with
   `organizationId=null` (platform-wide). The sweep finds active runs with
   `dueAt < now()` that don't yet have a `run.escalated` audit row, then writes
   one audit + one activity event per escalated run. Idempotency: the audit-log
   antijoin filters already-escalated runs; re-running the sweep is a no-op.

   **Dev parity:** Vercel Cron doesn't fire locally. Two trigger paths for
   dev:
     (a) Admin button "Run sweep now" on `/settings/general` — calls the
         `runs.runSlaSweepNow` oRPC procedure (adminOrgProcedure; scoped to the
         active org). Available in prod too as an admin manual-trigger.
     (b) `pnpm --filter @virn/scripts sla-sweep:dev` — one-shot HTTP fire to
         the cron endpoint. `sla-sweep:dev:watch` polls on an interval.

   **What "escalate" does in v1 (deliberately thin):** writes one `audit_log`
   row + one `activity_event` row per overdue run. **No notifications, no
   `automation_action` invocation yet** — the existing notification enum doesn't
   have `RUN_OVERDUE` and the automation-action executor is Phase 18. The audit
   + activity rows are enough for the manager dashboard + the admin UI's
   success toast.

   **Successor (Phase 18):** when the full automation-action executor + Inngest
   land, this sweep migrates from a Vercel-Cron HTTP endpoint to an Inngest
   scheduled function that emits an SLA-breach event; `automation_rule` rows
   with `triggerType='sla_breach'` then handle the escalation actions through
   the catalog (notify, reassign, run_workflow). Same business logic, richer
   reactions. The lib function `runSlaSweep` becomes the body of an Inngest
   scheduled handler with no other changes.

   **Why Vercel Cron, not Inngest, for v1:** Inngest is a workflow orchestrator
   we'll want eventually (Phase 18), but pulling it in just to fire an hourly
   cron in v1 bundles two phases. Vercel Cron is platform-native, free, and
   keeps Phase 18's "we have a real reason to add Inngest" decision honest. The
   substantive logic (sweep + escalation writes) is the same regardless of
   trigger.

### Phase 9 — Data Sets minimal subset (S-02)

Promote Batch 7 from deferred. Schema-only is insufficient — wire it through.

- `data_set` (named list, org-scoped)
- `data_set_record` (one row, with `label` + optional `value` JSON — single-field
  for v1)
- `lookup` field type (references a `data_set` id)
- Builder UI: define a data set, attach a `lookup` field to a step or kickoff form,
  reference the selected record's `label` / `value` in merge variables and
  conditions.
- Run UI: lookup field is a typeahead/select bound to the named data set's records.

Multi-field `data_set_field` schemas and the full data-set builder are post-v1.

### Phase 9.5 — Entity-set seams + review states + property-ops pack refresh (v1.5a)

See [PRD_WORKFLOW_SOP_BUILDER.md](PRD_WORKFLOW_SOP_BUILDER.md) §6.1, §6.2, §6.5, §6.6 for
full spec. Four "no-AI-dependency" pieces of the v1.5 builder push, bundled because they
share a migration window and a UI surface (the builder Scope/Settings panels). Framed
around the 3-layer architecture (per D-034 / PRD §1.1) — v1.5a delivers Layer-1 seams +
Layer-2 generalized scoping + the review-state lifecycle + the first Vertical Pack's
template content:

- **Prerequisite: `listing` table creation.** Validated 2026-05-27 — the table
  did not exist in the schema (only `template_listing` / `template_listing_version`
  for library distribution). Created here as part of v1.5a so the polymorphic
  `entity_set_member` CHECK has a target and Phase 17 (property-ops pack) +
  Phase 8 (vendor / participant) have a real listing concept to lean on.
  Minimum shape per PRD §8.1: `id`, `organization_id`, `name`,
  `external_listing_id` (nullable, unique per org), `property_type` (free text;
  cohort membership via `entity_set` is the canonical categorization), `address`
  (optional jsonb), timestamps + soft delete. Plus minimum `listings.*` CRUD
  procedures + `/library/listings` index UI so something can create listings in
  v1.5a. Sample listings seeded by the property-ops pack install (Phase 17a).
  Adds ~1 day to v1.5a.
- **Layer-1 seam: `entity_set` (replaces draft v1's `listing_cohort`).** New
  `entity_set` (org-scoped, named, color label, `entity_type` discriminator — only
  `'listing'` in v1.5) + `entity_set_member` join (polymorphic by `entity_type` +
  `entity_id`). New column `workflow.entity_set_ids uuid[] DEFAULT '{}'` (empty =
  applies-to-all, preserves current behavior). The `entity_type` discriminator +
  polymorphic member join + thin `EntityAdapter` TS interface (one implementation:
  `ListingAdapter`) make Layer-1's full configurable entity model a content-and-UI
  build post-v1, not a schema migration. Cost: one enum, one polymorphic join, one
  adapter interface. Benefit: no forklift rename when Layer 1 lands.
- **Layer-2: generalized entity-set scoping + documented action vocabulary.**
  `runs.launch` filters available workflows by entity-set intersection when invoked
  from an entity context; workflow-first launches keep current behavior with a
  mismatch warning. Builder Scope panel gains an entity-set multi-select; listings
  index + detail gain entity-set chip badges (same UI pattern will serve future
  entity types). The v1 composable action vocabulary (task / approval / heading /
  one_off; reserved: code, ai) gets documented explicitly as the closed set the AI
  authoring layer may emit. Entity sets reusable as vendor-pool scope target
  (D-027 follow-on, post-v1).
- **Review states.** Add `workflow.review_state pg_enum('draft','in_review','published',
  'archived')` + `organization.require_concierge_review boolean DEFAULT false`. When
  the org flag is on, the "Publish" button on a draft becomes "Submit for review";
  admin inbox shows pending reviews with diff against last published version (re-uses
  `getVersionEditBundle`). Workflow-level lifecycle, **not** version-level — snapshot
  / publish semantics (D-019) unchanged. Audit row on every state transition. We ship
  the flag, not an in-house review service.
- **Property-ops pack content refresh (the first Vertical Pack).** Per D-034: STR
  pack remains v1 wedge; pack ordering reframe defers Commercial PM to post-v1. The
  Vertical Pack primitive (per PRD §1.1, §6.5) bundles entity schemas + workflow
  templates + integration presets + AI grounding vocabulary; v1.5 expands the
  property-ops pack's **template library** to span property-ops types (STR-leaning
  per D-034 dogfood profile, but horizontal in surface area to keep the engine
  honest). Full roster in [PRD §6.5](PRD_WORKFLOW_SOP_BUILDER.md):
  - **STR / vacation rental** (12; v1.5 dogfood lead) — Besty parity (Pet Approval,
    Noncritical Triage, Discount Request, Guest Complaint Escalation, Inbound Call
    Routing, Lockout, Early Check-In, Late Checkout, Post-Stay Review) + STR
    Turnover, deep-clean cadence, pre-arrival prep.
  - **Long-term residential** (6) — lease renewal, move-in, move-out, late-rent
    collection, resident complaint triage, periodic interior inspection.
  - **Commercial** (6) — tenant fit-out coordination, quarterly PM dispatch, COI
    refresh, after-hours access, lease renewal notice, CAM reconciliation prep.
  - **Multifamily** (4) — common-area inspection, amenity-incident response,
    mid-lease unit inspection, building-system outage response.
  - **Cross-cutting** (5) — maintenance work-order triage, vendor onboarding, owner /
    asset-manager monthly report, emergency response, new-listing / new-unit setup.

  All ship as platform-published `template_listing` rows (`publisherOrganizationId
  IS NULL`) via the existing install flow.

Schema migration + UI + curated pack-content seed data. No new infrastructure.

### Phase 9.6 — Playbooks schema seam (lifecycle-sequence primitive)

See [PRD_PLAYBOOKS.md](PRD_PLAYBOOKS.md) for full spec. Schema-only chunk; no
procedures, no UI, no Inngest functions. Sequenced *after* Phase 9.5 so it can
reuse the v1.5a artifacts (`entity_set`, `review_state` enum, `ai_authoring_prompt`
table, `require_concierge_review` flag) rather than redeclare them.

- New tables: `playbook`, `playbook_version`, `playbook_step`, `playbook_run`,
  `playbook_run_step` (org-scoped per D-006; snapshot-immutable on publish per
  D-018; reuse `review_state` lifecycle from v1.5a).
- New enums: `playbook_step_type` (`wait_for_duration` / `wait_for_event` /
  `launch_workflow` / `send_notification` / `branch_on_data_set` /
  `write_to_data_set`); `playbook_lifecycle_event` (`run.completed` /
  `run.state_changed` / `listing.entity_set_added` / `vendor.upserted` — no
  `cross_product` value; PM-initiated work surfaces via the existing events
  with a `crossProductOriginFilter` in trigger config); `playbook_run_status` +
  `playbook_run_step_status`.
- `entity_type` enum gains `playbook`, `playbook_version`, `playbook_run`,
  `playbook_run_step` entries.
- New column: `organization.label_overrides jsonb NOT NULL DEFAULT '{}'` — UI-only
  label remapping (default `Playbooks`; CRE-leaning orgs may override to
  `Lifecycles`). Canonical names in schema / API / URLs / audit / integration
  contracts stay `playbook`.
- `forbiddenOrganizationSlugs` in [packages/auth/config.ts](../packages/auth/config.ts)
  gains `playbooks` (top-level route reserved for Phase 18a).

No business logic yet; no behavior change. Idempotent re-run safe. Execution +
authoring + AI authoring all land inside Phase 18 (see Phase 18 amendment below).

### Phase 10 — Reader-facing KB surface (S-03)

A read/search/acknowledge surface over `workflow.type ∈ {document, policy}` +
`visibility`. Distinct from the builder-facing Library (which targets authors).

- Index + search over published document/policy `workflow_version` content.
- Reader view per document/policy with the rendered content (re-uses the
  single-content-object renderers — S-08 guardrail).
- Acknowledge action writes `acknowledgment`; suggestion feedback writes `suggestion`.
- Visibility honors `workflow.visibility` (`org-internal | guest-visible | public`).
- Substrate for the post-v1 Slack/Teams delivery (S-09).

**v1.5c — three-views unification (Author / Read / Execute) per [PRD_WORKFLOW_SOP_BUILDER.md](PRD_WORKFLOW_SOP_BUILDER.md) §1.2, §6.4.**

PRD v2's architectural commitment: the SOP, KB article, and runnable workflow are
**three views of one object**, not three separate features. This phase implements
that commitment as the v1.5c slice. Besty keeps KB and Builder separate; Virn
collapses them so editing once updates all views — the human / AI / agent-executable
bridge from day one.

- **Detail page becomes a view-switcher.** `/library/workflows/[id]?view={author|read}`
  is the canonical URL for any specific workflow's view mode. The Author view is
  the existing builder canvas (Phase 5). The Read view (new) renders the published
  version as an SOP/KB markdown article (steps, descriptions, field labels, role
  hints, expected outputs). Same backing data, different lens. Author default for
  users with edit perms; Read default for read-only org members; toggle visible to
  users with both permissions.
- **Two browse-ergonomic indexes both lead to the same detail page.**
  - `/library/workflows` — authors' index (all states, all workflows the user can
    see) — already exists.
  - `/sop` — readers' index (published only, opens detail pages in `?view=read`).
    New top-level route. Add `sop` to `forbiddenOrganizationSlugs` in
    `packages/auth/config.ts` + snapshot (memory rule).
- **Scope of Read view content.** Surfaces all published workflow types — procedural
  workflows (`workflow.type='workflow'`), documents, policies. Operator framing is
  "find the SOP, read it, mark as read."
- **Mark-as-read.** Read view's button → inserts `sop_read_receipt` row (`workflow_id`,
  `workflow_version`, `user_id`, `read_at`). Org admins see per-workflow read
  receipts on the detail page in any view.
- **Read receipt vs acknowledgment reconciliation.** `sop_read_receipt` = passive
  "I've seen this" signal; existing `acknowledgment` (Phase 16) = active compliance
  sign-off. Per PRD §12 open question #8: keep separate in v1.5; reconcile at
  Phase 15 compliance pack if useful (could render both on one timeline).
- **Strict no-execution constraint.** No "Start a run" button in Read view.
  Runs launch from entity contexts (listings, triggers, runs index). Read view
  stays reference-only to keep the mental model clean.
- **Snapshot immutability preserved.** Read view for readers always reflects the
  last published snapshot (D-019 unchanged). Authors viewing draft state see the
  in-progress edits in Read view too (preview).
- **Permission resolution.** Author landing in `?view=read` sees a toggle; reader
  landing in `?view=author` is redirected to `?view=read`. Detail page resolves
  view-mode default based on viewer permission + URL param.

### Phase 11 — Agent-safe action surface (S-01a) — the unfair advantage

Expose the workflow/run procedures as a **credentialed, audited, capability-gated
oRPC API** that agent principals (ADR-006) and sibling-product callers (Virn PM)
use through the same write path humans do. A thin **MCP wrapper** ships alongside
for MCP-host compatibility (Claude Desktop, MCP-native agents) — wrapper, not
source of truth. Per STRATEGY S-01a: the architectural bet is the *surface itself*,
not any specific wire protocol. oRPC is canonical; MCP is one wrapper among
possible others.

**Sub-phase 11a — Canonical oRPC action surface (primary deliverable).**

**Step 1 of 11a — SHIPPED 2026-05-27.** Bearer-credential middleware
(`agentOrUserOrgProcedure`) + agent-aware audit attribution + dual-auth wiring
of **`runs.setFieldValue` + `runs.completeStep`** (the step-fulfillment endpoints
agents need first). Find-or-create is intentionally NOT in step 1: agents in
11a.1 must be a pre-existing participant on the run (bound at launch via the
S-07 mode-aware launcher); the on-demand participant-create path lands with
`runs.launch` in 11a.2.

**Step 2 of 11a — PARTIALLY SHIPPED 2026-05-27.** `runs.launch` dual-auth
(`agentOrUserOrgProcedure` at
[launch-run.ts:25](../packages/api/modules/runs/procedures/launch-run.ts#L25))
+ cross-product origin propagation (`crossProductOrigin='virn-pm'` threaded
from `principal.agent.originProduct` at
[launch-run.ts:55](../packages/api/modules/runs/procedures/launch-run.ts#L55))
are live; the four D-038 subtasks below are the still-pending body of Phase
11a. **Deferred to Phase 11a step 4 (introspection + capability gating):**
agent introspection (`runs.listMyAssignments`); per-agent capability checks
via `agent_capability`. Both are needed for full Phase 11a but neither blocks
the cross-repo integration surface — split out so the D-038 subtasks can ship
without waiting on capability-gating UI.

- **Surface (read):** list workflows / read workflow / list runs / read run /
  list my assigned steps. Same oRPC procedures the human UI calls; no parallel
  read path.
- **Surface (write):** launch a run / set a field value / complete a step / add a
  comment. All through the **same** oRPC procedures the human UI uses — no
  parallel write path.
- **Credential validation as oRPC middleware.** A new procedure-level middleware
  resolves an incoming `Authorization: Bearer <token>` (the API-key-shaped agent
  credential from ADR-006 / D-022) to an `agent.id` + capability set, then
  proceeds through the existing oRPC stack. Lives once, in middleware — applies
  uniformly regardless of which wrapper (if any) the caller used.
- **AuthZ:** per-agent capability grants from `agent_capability` (D-022) compose
  with the existing capability × permission gating. An agent only acts where
  `capability_enabled(org) ∧ agent_has_capability(agentId, capability)` — agents
  are subject to org-level capability gates exactly as humans are, with their
  own narrower grant set on top.
- **Find-or-create the per-run participant.** On the first write to a given run
  by a given agent, find-or-create the `participant` row with `kind='agent'` +
  `agentId` set (ADR-006). Subsequent writes use the same participant id.
- **Audit attribution.** Every agent action writes an `audit_log` row with
  `actor_kind='agent'`, `actorParticipantId` set to the participant row, and no
  `actorUserId`. When the agent represents a sibling product (Virn PM
  authenticating as a machine principal per D-025), the same write additionally
  sets `crossProductOrigin='virn-pm'` (D-027). Activity events mirror this for
  the user-facing run timeline.
- **Outbound webhook deliveries from Ops → PM (per D-025).** A dedicated
  `cross_product_event_outbox` table is the source of truth for emitted events;
  a Vercel Cron worker (matches Phase 8 step 5's SLA-sweep pattern; migrates to
  Inngest in Phase 18) drains pending rows and POSTs to PM's
  `/api/webhooks/virn-ops/[orgSlug]` endpoint. Each delivery carries an
  HMAC-SHA256 signature over body + timestamp using a per-org shared secret.
  Per-org PM endpoint URL + secret stored in a new `outbound_webhook_credential`
  table (one row per consumer product per org; same row holds
  `allowed_return_url_prefixes text[]` consumed by the guest-page returnUrl
  affordance — see D-037 / Step 3 subtask (d)). **v1 event catalog (cross-repo
  agreement, D-025 + D-035):** `run.state_changed`, `run.completed`,
  `vendor.upserted`, `run.comment_added`. Everything else (escalations,
  agent-generated artifacts, step-level state changes, etc.) deferred —
  additions require mutual cross-repo agreement.
  **Why outbox and not `automation_action.actionType='call_webhook'`:** the
  automation-action path executes user-defined `automation_rule` rows on
  event-match; cross-product catalog events fire on system lifecycle
  transitions (run state change, vendor upsert) and need transactional
  insert-with-the-state-write semantics so a delivery can never be lost or
  duplicated. Different subsystems; conflating them would force the cross-product
  emission to live inside an automation-rule indirection that doesn't fit its
  semantics.
- **`runs.launch` accepts the snapshot payload from PM (per D-029, corrected
  by D-038).** The contract PM's outbound client targets:
  `{ workflowId | workflowSlug, workflowVersionId?, kickoffValues: Record<string, unknown>,
  roleAssignments: RoleAssignment[], title?, mode,
  callback?: { pmServiceRequestId?, pmWorkOrderId?, webhookEvents?: string[] } }`.
  Notes vs. D-029-as-originally-written: `workflowId | workflowSlug` (not
  slug-only — see Step 3 subtask (a)); flat `kickoffValues` map keyed by the
  property-ops field-key vocabulary locked at Phase 17 seed time (`property_name`,
  `property_address`, `unit_label`, `tenant_display_name`, `lease_id`,
  `access_instructions`, `request_description`, `severity`, `photo_r2_keys`);
  `roleAssignments[]` not a singular `participant` (Ops's CHECK constraint per
  D-023 dictates per-role shape, with vendor roles taking
  `{ roleId, vendorId, vendorContactId }`); `callback` block persisted on `run`
  per Step 3 subtask (b) and echoed in every webhook delivery so PM routes
  callbacks without an extra DB lookup. PM is responsible for find-or-creating
  the Ops vendor before launch (one-time setup per vendor via the action
  surface's vendor procedures). Cross-product origin is NOT a payload field —
  it threads from `agent.originProduct` automatically per the dual-auth wiring
  already shipped in Step 2.

**Step 3 of 11a — D-038 subtasks (next session, the cross-repo integration body).**

Four subtasks surface from D-038's sanity-check of PM's §4 assumptions. Ship
order is smallest-blast-radius first; each subtask is its own commit (or
multi-commit sub-phase for (c)).

- **(a) Optional `workflowSlug` on `runs.launch`.**
  - **Schema:** add `workflow.slug text` (nullable) with a partial unique
    index `(organization_id, slug) WHERE slug IS NOT NULL AND deleted_at IS NULL`.
    [packages/database/drizzle/schema/workflows.ts:88-135](../packages/database/drizzle/schema/workflows.ts#L88-L135)
    is the target.
  - **Pack installer:** the property-ops pack seed
    (`pnpm --filter @virn/scripts seed:property-ops-pack`) populates slug from
    the pack manifest's workflow key — `str_turnover`, `property_inspection`,
    `maintenance_routing`, `vendor_onboarding`, `tenant_onboarding`. User-
    authored workflows leave slug null in v1 (no cross-product launch use case).
  - **Procedure:** `runs.launch` input adds
    `workflowSlug: z.string().min(1).optional()`, refines `workflowId` to
    `.optional()`, validates "exactly one of {workflowId, workflowSlug}",
    resolves slug → id scoped to `organizationId` inside `launchRun()` before
    existing logic runs. [packages/api/modules/runs/procedures/launch-run.ts](../packages/api/modules/runs/procedures/launch-run.ts) +
    `packages/api/modules/runs/lib/launch-run.ts`.
  - **Open design call:** direct `workflow.slug` column vs. sibling
    `workflow_external_key` table. **Recommendation: direct column.** One alias
    dimension covers v1; sibling table is premature.

- **(b) `callback` block on `runs.launch` + persistence.**
  - **Schema:** add to `run` ([packages/database/drizzle/schema/runs.ts:109-142](../packages/database/drizzle/schema/runs.ts#L109-L142)):
    - `callback_pm_service_request_id text` (nullable; indexed for any future
      PM-side reverse correlation lookup)
    - `callback_pm_work_order_id text` (nullable)
    - `callback_webhook_events text[]` (nullable; null = "all v1 catalog events";
      non-null = filter)
  - **Procedure:** `runs.launch` input gains
    `callback: z.object({ pmServiceRequestId?, pmWorkOrderId?, webhookEvents?: z.array(z.string()) }).optional()`;
    `launchRun()` persists into the new columns; emission layer (c) reads them
    when echoing.
  - **Open design call:** flat callback columns on `run` vs. sibling
    `run_external_link` table. **Recommendation: flat columns on `run`.** One
    PM-side launcher per run is the v1 reality; a sibling table costs a join on
    every webhook emission with no concrete second consumer.

- **(c) Webhook emission layer — the big one (multi-commit sub-phase).**
  - **Outbound credential table** `outbound_webhook_credential` ships first
    (gates (c) + (d)):
    `id`, `organization_id`, `consumer_product text` (`virn-pm` in v1),
    `endpoint_url text`, `signing_secret_encrypted text`,
    `allowed_return_url_prefixes text[]` (consumed by subtask (d)),
    `is_active bool`, `created_at`. One row per consumer per org. Thin admin UI
    on `/settings/integrations` to register PM's URL/secret/allowlist.
  - **Outbox table** `cross_product_event_outbox`:
    `id text PK` (wire `eventId`), `organization_id`, `sequence_number bigint`
    (per-org monotonic), `event_type text`
    (`run.state_changed | run.completed | vendor.upserted | run.comment_added`),
    `run_id text nullable`, `vendor_id text nullable`, `payload jsonb`
    (sealed at write time), `callback_pm_service_request_id text` +
    `callback_pm_work_order_id text` (echoed from `run`), `status text`
    (`pending | delivering | delivered | failed | dead`), `attempt_count int`,
    `next_attempt_at timestamp`, `last_error text`, `created_at`,
    `delivered_at`.
  - **Emission chokepoints:** transactional outbox inserts in the same tx as
    the state-write:
    - [packages/api/modules/runs/lib/complete-step.ts](../packages/api/modules/runs/lib/complete-step.ts) — on
      run-level state transitions emit `run.state_changed`; on final-step
      completion emit `run.completed`.
    - Vendor write paths (Phase 8) — emit `vendor.upserted`.
    - `runs.addComment` (post-v1) — emit `run.comment_added` per D-035; slot is
      reserved at outbox-design time but emission lands when the comment
      procedure ships.
    - `runs.launch` does NOT emit — PM already knows it launched.
  - **Delivery worker:** Vercel Cron scheduled every 30s in v1. Picks
    `status='pending' AND next_attempt_at <= now()`, POSTs with HMAC-SHA256
    signature header, exponential backoff up to N attempts, then `dead`.
    Migrates to Inngest in Phase 18 alongside automation execution.
  - **Payload shape** (minimum for v1):
    `{ eventId, sequenceNumber, eventType, occurredAt, organizationId,
    runId?, runTitle?, workflowId?, workflowVersionId?, previousStatus?,
    currentStatus?, vendorId?, crossProductOrigin,
    callback?: { pmServiceRequestId?, pmWorkOrderId? } }`. Per D-038 §4.3,
    severity / priority / category are NOT first-class fields — if PM's Scoped
    Inbox needs them, PM tags via kickoff value at launch time and remembers
    its own tag.
  - **Open design calls:**
    - Sequence-number scope — per-org vs. per-run. **Recommendation: per-org.**
      Per-run gaps are rare and PM can compute them client-side.
    - Cron cadence — 30s in v1 vs. faster. **Recommendation: 30s** as the
      latency floor until Phase 18 Inngest migration removes it.

- **(d) `?returnUrl` pass-through on guest run view.**
  - **Frontend:** guest run view route reads `?returnUrl` on mount, validates
    against `outbound_webhook_credential.allowed_return_url_prefixes` for the
    run's org, renders a "Return to <PM brand>" affordance on completion / close
    of the guest UI. [packages/api/modules/runs/procedures/get-run-for-guest.ts](../packages/api/modules/runs/procedures/get-run-for-guest.ts) +
    sibling guest procedures + the guest-run page.
  - **No new schema** beyond what (c) already ships.
  - **Ship order:** blocks on (c)'s `outbound_webhook_credential` table so the
    allowlist is real. (d)-by-itself with a temporary `organization`-level
    allowlist column was considered and rejected — (d) without inbound
    PM-as-agent registered isn't useful in isolation.

**Recommended ship order for Step 3:**

1. **(a)** — schema + procedure for `workflow.slug` + slug acceptance on
   `runs.launch`. One commit. Unblocks PM's outbound client without touching
   emission. Pack installer slug-set update follows.
2. **(b)** — callback columns on `run` + `runs.launch` accepts `callback`. One
   commit. Builds on (a)'s `launchRun()` signature work.
3. **(c) part 1 — `outbound_webhook_credential` table + admin UI to register PM's
   URL / secret / allowlist.** Schema + thin settings surface. Gates the rest of
   (c) and all of (d).
4. **(c) part 2 — outbox table + run-lifecycle emission + Vercel Cron delivery
   worker + HMAC + retries + tests.** The biggest piece; multiple commits.
5. **(d)** — frontend + validation against the credential allowlist. One commit.
6. **`run.comment_added` emission** lands when `runs.addComment` procedure
   ships (post-v1 per D-035); the outbox + delivery worker already accept the
   event type as of (c).

**Step 4 of 11a — agent introspection + capability gating — SHIPPED.**
Agent introspection was already in place as `runs.listMyTasks` (dual-auth,
shipped in Phase 11a.2) -- same row shape for both user + agent principals; no
separate `listMyAssignments` procedure was needed. Per-agent capability gating
shipped with three action-surface capability slugs (`action.runs.launch`,
`action.runs.set_field_value`, `action.runs.complete_step`) seeded with
`defaultEnabled: true` at org level (org always has the surface; gating is
per-agent). The `requireAgentCapability` helper at
[packages/api/orpc/procedures.ts](../packages/api/orpc/procedures.ts) is the
single chokepoint: no-op for user principals, throws FORBIDDEN with
`{ capability, agentId }` in `data` for agent principals lacking the grant.
Wired into `launchRunProc`, `setFieldValueProc`, `completeStepProc`. Five
gate-behavior tests + the existing MCP tests still passing (agent mocks updated
to grant the action set).

Note: PM-as-agent receives these grants at agent-creation time (the admin
registering the cross-product credential also grants the action capabilities);
no special-case bypass for cross-product callers. Tenant-internal AI agents
(ai_assisted / automated mode) are granted whichever subset matches their role.

**Sub-phase 11b — Thin MCP wrapper (good-citizen alternative).**

- Wrapper exposes the same oRPC procedures from 11a via the MCP protocol — read
  procedures as MCP `tools` and `resources`, write procedures as MCP `tools`.
  Credential validation happens in the oRPC middleware (11a), so the wrapper
  doesn't reimplement auth.
- Deployable as a sibling endpoint (e.g. `mcp.ops.virn.com` or
  `ops.virn.com/mcp`) — deployment shape to settle when 11b ships.
- **Branding:** "Virn Ops MCP" when referring to this wrapper specifically; the
  canonical surface is "Virn Ops Action API" (or just "the action surface" in
  internal docs).
- **Splittable.** If 11b complicates the 11a build, ship 11a alone and split
  11b as Phase 11.5 — the strategic value is in 11a; the wrapper is the
  ecosystem-compatibility cherry.

**Why this matters.** This is the load-bearing seam for S-07 mode (b) and (c) —
without an agent-credentialed write path, "AI-assisted" and "automated" runs
have nothing to drive them. It's also the **integration surface for Virn PM** —
PM calls these same oRPC procedures (directly, not via MCP) to launch
work-order runs from tenant service requests. One contract, multiple consumers
(humans-via-UI, agents-via-credential, sibling-product-via-credential, MCP-hosts-
via-wrapper).

**Asymmetry note (D-033, 2026-05-27 cross-repo).** This phase ships Ops's Action
API + MCP wrapper. **PM does not ship a symmetric `Virn PM Action API` in v1** —
PM's inbound surface is webhook-only (per D-025). The integration is
one-directional initiation: PM initiates work in Ops (`runs.launch`); Ops reports
back to PM via webhook. The symmetric "Virn PM Action API" + "Virn PM MCP"
together complete the "Virn MCP family" at PM v1.1+, when a concrete
bidirectional-live-query use case emerges (e.g. Ops needs to query PM live for "is
this vendor on AP hold right now").

### Phase 12 — AI authoring (S-01b/c) — kill the blank page

Two ingress paths into the existing builder API:

- **Prompt → workflow.** Free-text description ("a turnover checklist for a 2BR
  STR; clean, inspect, photo, restock; vendor signs off") → structured
  `workflow_version` draft via the LLM emitting structured output that matches the
  section/step/field/key shape. Goes through the same draft-create + structure-add
  procedures the manual builder uses.
- **Doc → workflow.** Markdown / plain text / extracted PDF text → structured draft.
  Same target shape.

LLM provider: per agents.md / `packages/ai`. Cache aggressively (prompt cache for the
schema-emit instruction; per-customer instructions in the system slot).

**v1.5b — Layer-3 AI authoring grounded in tenant entity schema, full spec in [PRD_WORKFLOW_SOP_BUILDER.md](PRD_WORKFLOW_SOP_BUILDER.md) §1.1, §6.3.**

- **Sequence:** ships immediately after Phase 11 (action surface) and before
  Phase 10 (three-views unification + reader surface) in build order. The
  pull-forward is driven by D-021 ("AI-credible v1") — natural-language SOP
  authoring is the table-stakes on-ramp without which Pass 3 stays a
  blank-canvas tax.
- **Architectural commitment (PRD §1.1 Layer 3): AI authoring grounds in the
  tenant's entity schema.** Per the 2026-05-27 strategic reframe, this is what
  makes a horizontal builder feel like Besty even when the underlying nouns are
  configurable. In v1.5b the tenant entity schema is the property-ops fixed set
  (listing today; vendor / owner / work_order from Phase 8 schema as adapters
  land) fetched via the `EntityAdapter` registry (Phase 9.5) and embedded as a
  cached block in the system prompt. When Layer-1 full configurable entity
  model ships post-v1, the same code path serves tenant-defined entities — no
  changes to AI authoring procedures or validator structure.
- **Lives on the agents oRPC router** (Phase 11), not as a direct Claude SDK
  call inside a workflows procedure. Two new procedures:
  - `agents.authorWorkflow({ prompt, sourceText?, templateHintId?, entitySetHints? }) → { workflowId }`
  - `agents.regenerateStep({ workflowId, stepId, refinementPrompt }) → { updatedStep }`
  Reusing the action surface (a) gives one audit trail for every Claude call,
  (b) lets MCP hosts inherit AI authoring for free via the Phase 11b wrapper,
  (c) keeps the model-swap seam narrow (per-org or per-tier).
- **AI output validated against entity schema + builder contract.** Per Appendix A
  of the PRD: step types restricted to `task | approval | heading | one_off`;
  `dueType` restricted to `none | offset_from_start`; entity references emitted
  by the AI are cross-checked against the live entity adapter registry (rejects
  "for each Booking" if no `Booking` entity exists); conditional branches emitted
  as `precondition_note` comments on relevant steps so authors can wire them when
  Phase 6 (automation rule firing) ships. Two retry attempts max before
  surfacing "couldn't parse your SOP — try simplifying."
- **Two-pane review UX** after generation: original NL/source text on the left,
  generated workflow as read-only canvas snapshot on the right. Per-step
  accept/edit/regenerate; whole-workflow accept-all / regenerate-with-addendum /
  start-over. Routes to `/library/workflows/[id]?view=author&aiAuthored=1`.
- **Multi-block prompt caching.** Four stable cached blocks in the system prompt:
  (1) builder JSON contract, (2) palette/dueType constraints + action vocabulary
  from Phase 9.5, (3) few-shot examples from the property-ops pack templates,
  (4) **tenant's entity schema block** (per-org cacheable; invalidated when
  entity definitions change). Per-request user input uncached.
- **Model default:** `claude-sonnet-4-6` (cost); fall back to `claude-opus-4-7`
  during dogfood if Sonnet's structured-output reliability is insufficient.
- **Provenance row:** every authoring call writes an `ai_authoring_prompt` row
  with `entity_schema_snapshot jsonb` (the schema sent to the AI, for
  reproducibility) plus org/user/prompt/source/response/model/timestamp;
  `workflow.ai_authoring_prompt_id` FK lets the builder header link back to the
  source prompt.
- **Dogfood profile (per D-034):** STR operator. AI grounding examples skew STR
  per the dogfood lead, but the schema-grounding pipeline is property-type-
  agnostic so the same pipeline serves Commercial/Residential/IT Ops packs when
  D-034 revisit triggers fire.

### Phase 13 — Tango / Scribe import path (S-01d)

Import a Tango or Scribe export (their public export formats) as a draft
`workflow_version`. Step → step, screenshot → attachment, instructions → step
description. Closes the capture gap via partnership rather than rebuilding
screen-recording ourselves.

Defer Scribe Optimize-style "what should be automated" intelligence to post-v1; the
v1 ingress is one-time import.

### Phase 14 — Lightweight monitor (S-06)

A thin "all runs of one workflow" view + a small set of saved-view variants over
`run`/`run_step` status. Mostly read-only aggregation over patterns already in
`drizzle/queries/runs.ts`. No full Reports / BI stack.

- Per-workflow runs index (status, due, assignee, started, completed, overdue).
- Org-level "active runs" / "overdue" / "needs attention" rollups.
- Filter + sort; no charting in v1.

### Phase 15 — Thin compliance / evidence surface (S-10)

Surface what the data already supports — audit/evidence views per workflow / run /
acknowledgment. A "compliance pack" capability flag enabling reviewer roles,
mandatory sign-off, evidence retention, scheduled re-attestation — slotted into
the existing capability × permission gating, no new schema for v1.

### Phase 16 — Governance flows (approvals + reviews + acknowledgments)

UX over the data-model already shipped in Phase 1 Batch 3:

- Request-approval / approve / reject UI for `version_approval`.
- Acknowledgment-due notifications + the acknowledge action surface (the data path
  used by the reader-KB Phase 10).
- Suggestion submission + accept/reject/merge for `suggestion`.
- Scheduled re-attestation surface using `next_review_at` / `review_interval_days`.

### Phase 17 — Property-ops pack (the first and only v1 pack)

Build the property-ops solution pack end-to-end as the v1 *content*. Pack mechanism
ADR-001 is already built; this is the content shape.

**Phase 17a (2026-05-27 — done) — install machinery + vendor categories + STR turnover.**
Pack install procedure (idempotent at the `pack_install` boundary; row-level
idempotency for vendor categories + workflow roles); platform-seed tooling script
(`pnpm --filter @virn/scripts seed:property-ops-pack`); admin UI button on
`/settings/general`. Content shipped:
  - 10 vendor categories (pest-control, HVAC, plumbing, electrical, landscaping,
    cleaning, pool-spa, locksmith, appliance-repair, general-contractor)
  - 4 workflow roles (Property Manager [initiator], Housekeeper, Inspector, Owner)
  - 1 published seed workflow: STR Turnover & Housekeeping (17 steps across 4
    sections, 8 kickoff fields, stop-task on the final "mark ready" gate)

**Phases 17b-17e (follow-up chunks — each one its own session-sized commit):**
  1. ~~STR turnover & housekeeping~~ (17a — done)
  2. Property inspection (move-in / move-out / periodic)
  3. Maintenance work-order routing
  4. Vendor onboarding (insurance attestation, W-9, scope of work)
  5. Tenant / guest onboarding

**Deliberately deferred (not part of Phase 17):**
- Pack manifest capabilities / settings auto-grants — pack manifest jsonb today
  is a content-type discriminator; richer manifest semantics (capability
  auto-grants, setting defaults) land when there's a real second pack that
  demands them.
- **Data sets** seeded by the pack (room types, common SKUs, inspection
  criteria) — depends on Phase 9 (Data Sets minimal subset).
- **Reference automations** (schedule-on-checkout, escalate-on-overdue,
  notify-owner-on-completion) — depends on Phase 18 (automation execution).
  The escalate-on-overdue case is partially covered by Phase 8 step 5's
  SLA-sweep (writes `run.escalated` audit/activity rows when runs go past
  `dueAt`); routing those to a manager notification + reassignment requires
  Phase 18.

### Phase 18 — Automation execution + Playbooks (Inngest landing)

Three features justify the Inngest investment at this phase: `automation_rule`
execution, SLA-sweep migration from Vercel Cron, and Playbooks. Sub-phase split:

**Phase 18 (core) — Automation execution.** Inngest functions evaluate
`automation_rule` on events and apply actions; `run_rule_fired` idempotency so
each rule fires once per run. SLA-sweep cron migrates from Vercel Cron to an
Inngest scheduled handler (per Phase 8 step 5's successor note). Required for the
property-ops pack's reference automations (Phase 17) and for S-07 mode (c) fully
automated runs.

**Phase 18a — Playbooks authoring** (see [PRD_PLAYBOOKS.md](PRD_PLAYBOOKS.md) §11).
Playbook CRUD + builder UI (vertical step list) + dry-render preview +
library tab + reader-KB integration via the v1.5c three-views unification (the
Playbook detail page becomes a view-switcher on `?view={author|read}`, same
pattern as Workflows; `/sop` indexes both). Read-only `playbookRuns.list/get`.
No execution.

**Phase 18b — Playbooks execution.** Inngest dispatcher + orchestrator functions
emit + subscribe to `run.completed` / `run.state_changed` / `listing.entity_set_added`
/ `vendor.upserted` lifecycle events. `playbookRuns.launchManual` lights up. The
orchestrator uses Inngest's `step.sleep` / `step.waitForEvent` for the
`wait_for_duration` / `wait_for_event` step types — synchronous orchestration
isn't an option once waits exist (rationale for the 18a/18b split). Cancellation
flow (`playbookRuns.cancel`). Audit + activity attribution per D-027 (synthetic
per-org system-agent; `crossProductOrigin` propagated from trigger).

**Phase 18c — Playbooks AI authoring.** `agents.authorPlaybook` +
`agents.regeneratePlaybookStep` on the agents oRPC router; system prompt grounded
in tenant entity schema (same Layer-3 pattern as Workflow AI authoring per
[PRD_WORKFLOW_SOP_BUILDER.md](PRD_WORKFLOW_SOP_BUILDER.md) §6.3). Reuses
`ai_authoring_prompt` (no new provenance table) and prompt-caching strategy from
v1.5b.

### Phase 19 — v1 polish + launch readiness

- Rich step content (verify gap #10 — confirm video/images/tables/links work in
  step instructions; fix if not).
- Empty-state copy across all v1 surfaces.
- Onboarding flow refresh — vertical-first language, property-ops pack pre-installed
  for new orgs (the mode picker stays as a power-user surface but isn't the v1
  default path).
- Marketing-site copy aligned with the vertical-first / one-procedure-three-modes
  story (separate repo — see BRANDING.md).
- Pricing surface — single property-ops plan in v1 per S-08's working assumption.
- Performance + safety-check passes (`pnpm safety-check`, `pnpm safety-check:auth`).

---

## v1.1+ (post-launch — not in scope for the initial release)

- **In-flow delivery (S-09)** — Slack first, Teams second (or together — see
  STRATEGY §8 open question).
- **Pack marketplace, third-party publishing** — the platform-of-products moat
  begins compounding post-v1 once the property-ops vertical is proven.
- **Second vertical pack** — likely the concentric property-ops expansion
  (commercial property, multifamily) before any cross-vertical jump.
- **Full Reports / BI stack** — saved views, dashboards, exports.
- **iPaaS hub** — broader integration catalog beyond the property-ops-relevant
  set in v1.
- **White-label / custom domains** — premium tier, roadmap commitment per D-032
  (2026-05-27). Ops scope is **narrower** than Virn PM's: operator dashboards, run
  editor, settings UI. No SoR or portal layer to brand on the Ops side. Optional:
  outbound email + emitted artifacts (run reports, KB excerpts). Shared primitives
  with PM: `organization_domain` table, hostname→org middleware, `branding_settings`
  group under the data-driven settings registry, Cloudflare-for-SaaS / Vercel
  custom-domain cert provisioning, Resend verified-domains per-org. Trigger: first
  customer who pushes back on Virn branding in an Ops surface they control. Likely
  fires in PM first (residential / commercial PM market is more brand-conscious).
  See `docs/BRANDING.md` for full scope split.
- **Virn PM Action API + MCP wrapper symmetric to Ops's** — per D-033 (2026-05-27,
  cross-repo). Together with Ops's Action API + MCP forms the "Virn MCP family."
  Trigger: concrete bidirectional-live-query use case (e.g. Ops needs to query PM
  live for "is this vendor on AP hold right now," not just receive PM-pushed
  webhook updates). PM-side build; Ops-side has nothing to do here beyond
  consuming PM's API as a machine principal when it lands.
- **Ops-side BACKLOG.md (potential)** — Virn PM has a BACKLOG.md as its tracking
  surface for triggered work; Ops currently uses this v1.1+ list. If Ops's
  post-v1 backlog grows, migrate this list into a dedicated BACKLOG.md at that
  point. Not urgent — the v1.1+ list here covers the current surface.
- **Scribe Optimize-style intelligence** — "what should we automate" derived from
  run analytics + agent attempt logs.
- **Full Data Sets** — multi-field records, the full data-set builder.
- **Property-ops compliance flavors** — STR municipal records, vendor insurance
  attestations, owner-required inspection cadences (decide which first based on
  early-customer pull).
- **Agent action policy / governance layer** — per-org rules constraining what
  agent principals (ADR-006) can send / post / do, evaluated in the same
  middleware as capability gating (Phase 11). Pattern inspired by Besty's
  Autopilot Messaging guardrails; becomes load-bearing when S-07 mode (c) (fully
  automated runs) deepens into regulated PM contexts. Lives next to the existing
  capability × permission gating; no new schema until a real policy use case
  demands it.
- **AI voice receptionist (integration, not flagship)** — inbound AI voice for
  after-hours commercial maintenance / IT Ops incident lines. Integrate with
  EliseAI or a voice-AI specialist rather than building in-house; the lane has
  significant specialist funding (see SCRATCHPAD competitive read). What's worth
  studying from Besty's implementation is the **triage handoff design** — how
  the AI hands off to humans or workflows when it hits its limits — not the
  voice tech itself.
- **Mobile field-execution app (work-order tech UX)** — offline-capable task
  queue, photo / note proof of completion, time logging. Pattern inspired by
  Besty's Cleaning & Ops module; the *differentiator* is the field-team app
  design (its own discipline), not the underlying work-order data model.
  Property-side build (PM owns work-order ownership per D-030); Ops contributes
  the run/step surfaces that the field app reads from (Phase 7 already ships
  these).

---

## Propvana graft (parallel, woven into Phases 2 & 4 — completed)

Port the KEEP list from the sibling repo `C:\Projects\Virn\virn-pm` (formerly
`propvana-app`): auth customizations, the org-config resolver/procedures/admin UI,
the oRPC procedures + middleware, shared packages, cross-cutting conventions.
Completed during the v1 foundation phases.
