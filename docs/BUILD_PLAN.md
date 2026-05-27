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

5. **SLA-driven escalation via Inngest scheduled function** (v1 path, *not* full
   SLA event catalog). ADR-003 defers SLA-breach events and the full action
   catalog. But v1 use cases (property-ops pack — e.g. "pest control work order
   not completed within X days, escalate to manager") require basic escalation
   on overdue runs. Implement via an Inngest scheduled function ("every hour,
   find runs past their `dueAt`, fire escalation automation actions") rather
   than as a true SLA event. Cheap, works with existing Inngest infrastructure
   (already wired for scheduled recurring runs), no schema change. The full SLA
   event catalog (proper `event` table, `automation_rule` triggers on SLA
   events, multi-tier breach severities) stays post-v1 per ADR-003 — promote
   when a vertical actually requires the richer model. For v1 the Inngest sweep
   covers the property-ops case; the escalation *actions* themselves are
   existing `automation_action` types (notify, reassign, run_workflow).

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

### Phase 10 — Reader-facing KB surface (S-03)

A read/search/acknowledge surface over `workflow.type ∈ {document, policy}` +
`visibility`. Distinct from the builder-facing Library (which targets authors).

- Index + search over published document/policy `workflow_version` content.
- Reader view per document/policy with the rendered content (re-uses the
  single-content-object renderers — S-08 guardrail).
- Acknowledge action writes `acknowledgment`; suggestion feedback writes `suggestion`.
- Visibility honors `workflow.visibility` (`org-internal | guest-visible | public`).
- Substrate for the post-v1 Slack/Teams delivery (S-09).

### Phase 11 — Agent-safe action surface (S-01a) — the unfair advantage

Expose the workflow/run procedures as a **credentialed, audited, capability-gated
oRPC API** that agent principals (ADR-006) and sibling-product callers (Virn PM)
use through the same write path humans do. A thin **MCP wrapper** ships alongside
for MCP-host compatibility (Claude Desktop, MCP-native agents) — wrapper, not
source of truth. Per STRATEGY S-01a: the architectural bet is the *surface itself*,
not any specific wire protocol. oRPC is canonical; MCP is one wrapper among
possible others.

**Sub-phase 11a — Canonical oRPC action surface (primary deliverable).**

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
  `actorUserId`. Activity events mirror this for the user-facing run timeline.

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

- **Pack manifest** — capabilities (recurring runs, guests, approvals, acknowledgments,
  agent-mode, compliance-pack), settings (STR-specific defaults), seed templates,
  taxonomies, field definitions, role definitions (Owner, Property Manager,
  Housekeeper, Inspector, Vendor, Owner-Guest, Reviewer).
- **Seed templates** (in priority order — depth, not breadth, within property ops):
  1. **STR turnover & housekeeping** (the concrete first shape — full procedure
     with check-in/check-out cadence, room-by-room steps, photo evidence,
     restocking, vendor sign-off).
  2. Property inspection (move-in / move-out / periodic).
  3. Maintenance work-order routing.
  4. Vendor onboarding (insurance attestation, W-9, scope of work).
  5. Tenant / guest onboarding.
- **Data sets** seeded by the pack: room types, common SKUs, vendor categories,
  inspection criteria.
- **Reference automations** (using ADR-003 + Phase 6 automation execution):
  schedule-on-checkout, escalate-on-overdue, notify-owner-on-completion.

### Phase 18 — Automation execution

Inngest functions evaluate `automation_rule` on events and apply actions;
`run_rule_fired` idempotency so each rule fires once per run. Required for the
property-ops pack's reference automations (Phase 17) and for S-07 mode (c) fully
automated runs.

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
- **White-label / custom domains** — premium tier (BRANDING.md).
- **Scribe Optimize-style intelligence** — "what should we automate" derived from
  run analytics + agent attempt logs.
- **Full Data Sets** — multi-field records, the full data-set builder.
- **Property-ops compliance flavors** — STR municipal records, vendor insurance
  attestations, owner-required inspection cadences (decide which first based on
  early-customer pull).

---

## Propvana graft (parallel, woven into Phases 2 & 4 — completed)

Port the KEEP list from the sibling repo `C:\Projects\Virn\virn-pm` (formerly
`propvana-app`): auth customizations, the org-config resolver/procedures/admin UI,
the oRPC procedures + middleware, shared packages, cross-cutting conventions.
Completed during the v1 foundation phases.
