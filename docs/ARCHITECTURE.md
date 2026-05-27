# ARCHITECTURE.md

Foundational architecture decision record for the Virn Ops codebase.

**Status:** Draft v3 (post-pivot framing — see DECISIONS.md D-021) · **Date:** 2026-05-26 · **Owner:** Paul

> **For AI agents (Claude Code, etc.):** Load this file into context for any task that
> touches schema, tenancy, configuration, automation, or product structure. The
> **Invariants** section is non-negotiable — do not violate those rules without an
> explicit, recorded decision that supersedes them. Day-to-day choices get appended to a
> separate running `DECISIONS.md` log; this file is the stable foundation.

---

## 1. Vision

**Virn Ops** is the **operating system for property operations** — turnover, inspections,
maintenance routing, vendor & tenant onboarding — built on a substrate where **one authored
procedure runs three ways**: as a human checklist, an AI-assisted checklist, or a fully
automated agent run. Same content, same audit trail, the operator chooses the execution mode
per run.

The **v1 product** is the property-ops vertical, with STR turnover & housekeeping as the
concrete first shape. The **underlying engine** is enterprise-grade, multi-tenant
infrastructure for recurring checklists, living SOP/policy knowledge bases, no-code workflow
automation, and an **agent-safe action surface** (oRPC API + optional MCP wrapper) — all on a single content-object
substrate. The engine is **architected to support** distinct process-shaped products
(marketing ops, agency client ops, compliance SOPs, HR ops) via solution packs the same
ServiceNow way — but that platform-of-products moat is a **long-term destination**, not the
v1 public story. Win property ops first; the pack model repeats the win post-v1. See
`STRATEGY.md` §1 (the bet) and S-11 (the long-term moat preserved as architecture).

### Scope of the platform model — what consolidates and what does not

The pack/config model applies to **process-shaped** products: those whose core is workflows,
checklists, SOPs, approvals, and tasks. It does **not** apply to **system-of-record / ERP-shaped**
products — those with a bespoke financial or domain core (e.g. property management with
double-entry accounting and leases, i.e. **Virn PM**). Those are **separate applications with their
own databases** that share the platform *foundation* (identity, billing, org model, UI,
conventions, and optionally the Ops workflow engine for their process features such as work orders,
turnover, and inspections) — but they are **not** packs on Ops. The end state is a **product family
on a shared foundation**, not a single app. Even within one industry the line holds: property
*operations* (turnover, maintenance, inspections) is process-shaped and Ops-appropriate (and is
Virn Ops's v1 focus); property *records* (GL, leases, invoices) are ERP-shaped and belong to
Virn PM.

### Guiding principles

1. **Vertical-first, then platform.** Win property operations decisively before leaning on the
   platform-of-products mechanic. The data model reserves the extensibility; the v1 build
   exercises *one* slice (kernel + workflow engine + config + the property-ops pack + library +
   reader-KB + agent surface). The platform-of-products moat (S-11) matures post-v1.
2. **Agent-native by construction.** Org-scoping, append-only audit, definition/execution split,
   and stable field keys are not just hygiene — they are the substrate that makes a safe
   agent-safe action surface (S-01a — oRPC API + optional MCP wrapper) tractable. Treat the invariants in §3 as the foundation of
   the unfair advantage, not just correctness plumbing.
3. **One content object, many views.** Procedures, KB articles, training guides, and agent
   instructions are different *views* of the same `workflow_version` substrate (`workflow.type`
   discriminator). No new content-object table without an ADR (STRATEGY S-08).
4. **Configuration over code — for process-shaped products.** A new process vertical or customer
   customization is a bundle of configuration (capabilities, settings, templates, taxonomies, field
   definitions, roles) — never a fork. ERP-class verticals are separate apps on the shared
   foundation, not configurations.
5. **Metadata-driven extensibility.** Customers and verticals extend the data model through
   registered definitions + validated JSONB, not new hand-written tables.
6. **Strict tenancy.** Everything a customer runs is org-scoped. The only deliberate cross-tenant
   exceptions are the publishable library and platform-owned packs.

---

## 2. Layered architecture

Four layers, top configures down, each rests on the one below.

- **Tenant configuration** — per-org capability + setting overrides on top of installed packs.
  See [CONFIGURATION.md](CONFIGURATION.md) for the three-level resolver, profile bulk-setter, and
  per-org override mechanics.
- **Solution packs — the process-shaped products** — installable, versioned config bundles that
  turn Ops into a process vertical (marketing ops, STR turnover, …). ERP-class apps like Virn PM
  are *not* packs; they sit alongside as separate apps on the same kernel/foundation.
- **Platform primitives — the engine** — workflows + runs, the event/automation layer, forms +
  fields, approvals, the template library, notifications, documents.
- **Kernel — the foundation** — identity, RBAC + ACLs, tenancy + business units, audit, billing +
  entitlements. This is the layer separate domain apps (Virn PM) also share.

---

## 3. Invariants (non-negotiable)

1. **Org-scoping.** Every tenant-owned row carries `organizationId text NOT NULL REFERENCES
   organization(id)`. Enforced in code via `protectedOrgProcedure` / `adminOrgProcedure` and the
   `withOrg(orgId)` query-helper pattern. RLS is a deferred backstop, not a substitute.
2. **The cross-tenant exception is contained.** Only `template_listing(_version)`,
   `template_category` (platform-global taxonomy for the listings), and platform-owned
   `solution_pack(_version)` may live outside an org. No other table may relax invariant #1.
3. **Definition vs. execution are separate.** Templates (`workflow → workflow_version → section →
   step → field`) are authored/versioned. Runs (`run → run_step → field_value`) are execution
   instances created by **snapshotting** a published `workflow_version`. Editing a template never
   mutates an in-flight or historical run.
4. **A `workflow_version` snapshot is self-contained.** It holds everything needed to run or to
   publish to the library — so cloning across tenants and pinning history both work without reaching
   back into mutable template state.
5. **Fields are referenced by stable key, never by label.** Every `field` has an immutable `key`
   unique within its version. Merge variables, conditions, and automation rules reference `key`.
6. **Audit/governance is append-only.** `audit_log`, `activity_event`, approval/review records,
   acknowledgments, and signing events are never updated or deleted.
7. **PKs are `cuid()` text** (`@paralleldrive/cuid2`) on every table, matching Better Auth.

---

## 4. Strategic seams (design now, build incrementally)

### ADR-001 — Solution packs are the process-product mechanism

- **Context.** Multiple **process-shaped** products must run on one codebase without forking. (ERP-
  class verticals like Virn PM are separate apps that consume this foundation — not packs.)
- **Decision.** Generalize the capability/setting system into `solution_pack` + `pack_version` +
  `pack_install` (per org), reusing the library's publish/clone/provenance pattern one level up. A
  pack version bundles: capability grants, setting definitions, seed template listings, taxonomy
  rows, field definitions, and role definitions. Installing stamps them into an org; `pack_install`
  records provenance for later updates.
- **Now:** the three tables + install flow; ship exactly one pack. **Defer:** a pack marketplace,
  third-party-published packs.
- **Rationale.** This is the ServiceNow "scoped application" analog and the highest-leverage
  extensibility decision — for process products.

### ADR-002 — Metadata-driven custom fields (objects later)

- **Context.** Verticals and customers must extend the schema without migrations.
- **Decision.** Generalize Propvana's `setting_definitions` into a `field_definition` registry keyed
  by `object_type` + scope (`platform | pack | org`), with values stored as validated `jsonb` on
  records (reuse the `validationSchema jsonb` + stored Zod pattern).
- **Now:** the `field_definition` registry + JSONB-validated storage on core records. **Defer:** a
  full no-code *object* builder. Reserve an `object_type` concept.
- **Rationale.** ServiceNow-style custom fields without EAV join hell; Postgres JSONB + GIN carry it.

### ADR-003 — A general event → rule → action automation layer

- **Context.** Automation must act on any record, not just workflow runs.
- **Decision.** `event` (record created/updated, field changed, schedule, inbound webhook, SLA
  breach) → `automation_rule` (conditions, AND/OR) → `automation_action` (assign, notify, create
  record, call webhook, run a workflow, set a field). Run-level show/hide is one consumer.
- **Runtime:** Inngest.
- **Now:** rule/condition/action tables + run-level consumers. **Defer:** SLA-breach events, the full
  action catalog.

### ADR-004 — Enterprise RBAC + tenant hierarchy

- **Context.** Better Auth's owner/admin/member is a floor, not a ceiling.
- **Decision.** Add custom roles per org, resource-level ACLs (`resource_type`, `action`, `scope`),
  and groups, layered on Better Auth's org roles. Reserve an org-hierarchy / business-unit layer.
- **Now:** custom roles + a basic ACL check + groups. **Defer:** ABAC, hard domain separation.

### ADR-005 — Entitlements unify billing and configuration

- **Context.** Packs/products must be sellable and metered.
- **Decision.** Capabilities are the shared unit of both configuration and entitlement. A plan grants
  capabilities + limits → org defaults → per-org overrides.
- **Now:** an `entitlement`/plan → capability-grant mapping. **Defer:** usage metering, multiple
  separately-billed products.

### ADR-006 — Agent principals: org-scoped identity + per-run participant binding

- **Context.** STRATEGY S-01 (agent-safe action surface) and S-07
  (one-procedure-three-modes: human / AI-assisted / automated) require a third actor
  kind alongside `user` and `guest`. An agent (an AI principal that drives runs via
  the credentialed action surface) needs identity (name, credentials, capability
  grants), org scope, and a way to be assigned to `run_step` rows. Today's `participant`
  table is per-run scoped — a participant row exists in the context of a specific run —
  which fits humans and guests but doesn't fit agents (long-lived, used across many
  runs over months). The open question (resolved here) was whether to add agents as a
  `participant.kind` value only, add a separate `agent` table only, or hybridize.
- **Decision.** **Hybrid.** A new org-scoped `agent` table holds the long-lived identity
  (name, description, credential hash, capability grants, `isActive`, audit metadata).
  The existing `participant` table gains a third kind: `participant.kind ∈ {user, guest,
  agent}`, with a new nullable `agentId` FK pointing at `agent`. `run_step_assignee`
  is unchanged — it continues to FK to `participant.id` regardless of kind. The action
  surface (oRPC API; optionally fronted by an MCP wrapper) authenticates an incoming
  agent action via the credential, resolves to `agent.id`, finds-or-creates the
  `participant` row for the target run with `kind=agent` + `agentId` set, then writes
  through the **same** oRPC procedures the human UI uses (no parallel write path —
  STRATEGY S-01a). Agent actions land in `audit_log` with a new
  `actor_kind ∈ {user, guest, agent}` enum populated from the acting participant. The
  protocol the caller uses (oRPC over HTTP, MCP wrapper, or any future wrapper) does
  not affect this — `agent` identity, capability gating, and audit attribution all
  happen at the procedure boundary, not the wire boundary.
- **Why hybrid, not either pure option.** `participant`-only conflates per-run binding
  with long-lived org identity, has no natural home for credentials, and forces agents
  to either churn participant rows or warp the per-run scoping. Separate-`agent`-only
  forks the assignee model — `run_step_assignee` becomes polymorphic across two FK
  targets, doubling the join complexity of every assignment query. The hybrid keeps
  the assignee infrastructure intact (one assignee model, three principal kinds via
  the existing `participant` row) and gives credentials / capability grants a proper
  home on `agent` (the GitHub-App / AWS-service-account shape). One assignee model
  in the runtime, one identity table in the control plane.
- **Capability composition.** Agent capability grants compose into the existing
  two-axis gating (capability × permission, UX_SPEC §2). An agent only sees / acts on
  workflows where `capability_enabled(org) ∧ agent_has_capability(agentId, capability)`.
  Agents are subject to the same `capability` gates as humans — a workflow type the org
  hasn't enabled is unreachable for any agent in that org. Per-agent grants are an
  *additional* narrowing on top of the org-level capability (an agent may be granted
  fewer capabilities than the org has enabled; never more).
- **Now:** the `agent` table (Phase 8 — `cuid` id, `organizationId NOT NULL`,
  `name`, `description`, `credentialHash`, `isActive`, timestamps); `participant.kind`
  enum extended to include `agent`; nullable `participant.agentId` FK with a CHECK
  enforcing `kind='agent' ⇔ agentId IS NOT NULL`; `audit_log.actorKind` enum column;
  per-agent capability grants reusing the existing `capability` catalog via an
  `agent_capability` join. **Defer:** cross-org agents, agent-to-agent delegation,
  agent OAuth flows (v1 uses opaque API-key-shaped credentials), agent fine-grained
  ACLs beyond capability gating.
- **Rationale.** This is the load-bearing actor decision that S-01 (the action surface)
  and S-07 (three-mode runs) sit on. Getting it wrong is expensive — every assignment query,
  every audit-log read, every capability gate threads through it. The hybrid is the
  shape every mature system converged on once service-account-like principals
  appeared (GitHub Apps, AWS IAM roles, Slack bots). It also keeps Invariant #1
  (`organizationId NOT NULL` on tenant-owned rows) clean — `agent` is org-scoped at
  the top level, `participant` already is, and the join chain to `run_step_assignee`
  is unchanged.
- **Consequences.** Phase 8 (S-07 wedge) lands the `agent` table + `participant` /
  `audit_log` migrations in one schema change before any agent-aware code ships.
  Phase 11 (agent-safe action surface) layers on top: the oRPC API gains
  credential-validation middleware that resolves an incoming request to an `agent.id`
  + capability set; a thin MCP wrapper ships alongside for MCP-host compatibility,
  exposing the same procedures via the MCP protocol. The existing `run_step_assignee`
  join, the existing audit pattern, and the existing capability resolver all work
  unchanged for agent principals — only the writers (`assignAgent`,
  `launchRunWithMode`) need to know about the new kind.

---

## 5. Domain-core decisions (carried forward)

- **Content-type discriminator.** `workflow.type` ∈ `procedure | document | policy | form`.
- **Versioning + snapshot.** `workflow_version.status` ∈ `draft | published | archived`; "current" =
  latest `published`.
- **Automation engine** (ADR-003) replaces the show/hide-only `condition` table. Add a
  `run_rule_fired` ledger — rules fire once per run.
- **Structured deadlines.** `due_type` (`none | offset_from_start | offset_from_step |
  from_date_field`) + anchor/source columns.
- **Step types & dependencies.** `step.type` ∈ `task | approval | heading | one_off` (reserve `code |
  ai`); `requires_all_assignees`; `step_dependency` join for stop-task gating.
- **Governance.** `version_approval`, `suggestion`, `acknowledgment`, `next_review_at` /
  `review_interval_days`. Append-only where noted.
- **Kickoff forms & guests.** Launch-level fields (`field.stepId` null) distinct from step fields; a
  `participant` model that is a Better Auth user *or* a guest email.
- **Template library.** `template_listing` + `template_listing_version` (backed by a published
  `workflow_version` snapshot) + `template_category` + `template_review`. Visibility ∈ `private |
  link | organization | public`; `publisher_organization_id` null = first-party. Install = deep-clone
  with `installed_from_listing_version_id` provenance. Stable field `key` enables merge variables.
- **Data sets** (deferred). Reserve `data_set` / `data_set_field` / `data_set_record` + a `lookup`
  field type.

---

## 6. Conventions (inherited from Propvana — keep verbatim)

- **PKs:** `text("id").$defaultFn(() => cuid())`.
- **Timestamps:** `createdAt defaultNow().notNull()`, `updatedAt $onUpdate().notNull()`.
- **Soft-delete, three buckets:** `deletedAt` (user-deletable); `status`/`lifecycleStatus` (lifecycle
  entities); append-only (audit/governance).
- **Polymorphism:** polymorphic FK + CHECK constraint on `entityType` — not bare text columns.
- **Enums vs lookups:** `pgEnum` for closed sets; a lookup table (+ `_translations`) for growable.
- **Money:** integer minor units + ISO-4217 currency snapshot.
- **Schema files:** one file per domain group, each exporting its `pgTable` + `relations()`,
  re-exported from `postgres.ts`.
- **Migrations:** Drizzle Kit; canonical seeds run as part of the migrate script.
- **Org enforcement:** `protectedOrgProcedure` / `adminOrgProcedure` + `withOrg(orgId)`; active org
  from the URL slug, reconciled to the session.

---

## 7. MVP scope (post-pivot — see DECISIONS.md D-021 and BUILD_PLAN.md)

| Area | In v1 | Reserved (seam only) | Deferred (v1.1+) |
|---|---|---|---|
| Tenancy / auth | Org-scoped, Better Auth, custom org procedures | Business-unit hierarchy | Hard domain separation |
| RBAC | Org roles + custom roles + basic ACL + agent principals | Groups | ABAC |
| Config | Capability/setting system + 1 pack (property-ops) | Pack marketplace | Third-party packs |
| Workflow core | Definition/execution split, versioning, snapshot | — | — |
| Automation | Run-level rules on the general engine | Non-run events | SLA engine, full action catalog |
| Fields | `field` + `field_definition` registry (JSONB) | `object_type` | No-code object builder |
| Governance | Approvals, reviews, acknowledgments + thin evidence surface (S-10) | — | General approval engine; property-ops compliance flavors |
| Library | Private/org/public listings, install-as-clone, first-party seed | Reviews | Monetized marketplace |
| **Reader-facing KB (S-03)** | Read/search/acknowledge over `workflow.type ∈ {document, policy}` | Slack/Teams delivery (S-09) | — |
| **Data sets (S-02 minimal)** | `data_set` + single-field `data_set_record` + `lookup` field type | Multi-field records, full builder | Full build |
| **AI authoring (S-01b/c)** | Prompt→workflow + doc→workflow → draft `workflow_version` | — | Scribe Optimize-style "what should we automate" |
| **Agent-safe action surface (S-01a)** | Credentialed, audited, capability-gated oRPC API + agent principal kind (ADR-006); thin MCP wrapper alongside for MCP-host compatibility | Agent-driven cross-org orchestration | — |
| **Tango/Scribe import (S-01d)** | Import their export formats as draft `workflow_version` | — | Native screen-recording capture |
| **Three execution modes (S-07)** | `runs.launch` mode selector (`human \| ai_assisted \| automated`); `step.type=ai` lifted from reserved | — | — |
| **Operator surfaces (UX_SPEC §5)** | Home, My Work, Run view, Guest run view | — | — |
| **Monitor (S-06 thin)** | Per-workflow runs index + org-level rollups | — | Full Reports / BI |
| Billing | Entitlement → capability grants; single property-ops plan | Usage metering | Multi-product billing |
| Integrations | Outbound webhooks + Inngest + vertical-targeted (Hostfully/Guesty/Airbnb/Stripe/Twilio) | Connection registry | iPaaS hub |
| Analytics | `activity_event` stream + run/step status + thin monitor (S-06) | Saved views | BI / dashboards |
| Platform | — | — | Multi-region / data residency, white-label |

**v1 vertical (pack):** Property operations. Concrete first shape: **STR turnover &
housekeeping**. Concentric expansion *within* property ops post-v1 (inspections,
maintenance routing, vendor/tenant/owner onboarding) before any second-vertical pack.
**This is locked**, no longer an open question — see STRATEGY S-04 and D-021. Full
property management remains a separate app (Virn PM) on the shared foundation; only
its process slices are Ops-appropriate. Prove one pack on one vertical deeply; the
pack model repeats post-v1.

---

## 8. Stack reference

Next.js (App Router) · React 19 · Better Auth (organization plugin) · Drizzle ORM on Postgres (Neon)
· oRPC + Hono · Inngest · TanStack Query/Table · next-intl · Tailwind + shadcn/ui · Zod · Sentry.
Turborepo + pnpm, `@virn/*` scope. Fresh Supastarter clone with the Propvana KEEP-list grafts.

---

## 9. Open questions

**Resolved by the pivot (D-021):** First Ops vertical is **locked to property operations**
with STR turnover & housekeeping as the concrete first shape — was previously an open
question, no longer is.

**Still open:**

- Custom-object framework depth for MVP: JSONB-on-core-records only, or a minimal `object_type` +
  generic `record` table from the start?
- How far to take the shared **foundation** between Ops and Virn PM (shared identity now; shared
  workflow engine for PM's process features later?). Especially relevant now that both target
  property — Virn Ops (operations) and Virn PM (records / accounting) on the same property data.
- Approval engine: per-feature now, or one generalized engine sooner than planned?
- Library monetization: free-only at launch, or reserve `template_purchase` from day one?
- AI sequencing within v1: agent-safe action surface (S-01a — oRPC + agent principal +
  audit) first or prompt→workflow (S-01b) first? See STRATEGY §8 — working assumption is
  the action surface first; the MCP wrapper is a fast-follow within the same phase if
  cheap, or split out if it complicates the oRPC build.
- Data Sets minimal-subset boundary: confirm the single-field `data_set_record` shape per
  STRATEGY §8 working assumption.
- ~~Agent principal model: should `participant.kind = agent` be a first-class participant
  kind, or a separate `agent` table?~~ **Resolved by ADR-006 (2026-05-27): hybrid —
  org-scoped `agent` table for identity/credentials + `participant.kind=agent` +
  `participant.agentId` FK for per-run binding. `run_step_assignee` unchanged.**
