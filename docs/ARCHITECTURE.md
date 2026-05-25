# ARCHITECTURE.md

Foundational architecture decision record for the Virn Ops codebase.

**Status:** Draft v2 · **Date:** 2026-05-25 · **Owner:** Paul

> **For AI agents (Claude Code, etc.):** Load this file into context for any task that
> touches schema, tenancy, configuration, automation, or product structure. The
> **Invariants** section is non-negotiable — do not violate those rules without an
> explicit, recorded decision that supersedes them. Day-to-day choices get appended to a
> separate running `DECISIONS.md` log; this file is the stable foundation.

---

## 1. Vision

**Virn Ops** is an enterprise-grade, multi-tenant **platform** for recurring checklists, living
SOP/policy knowledge bases, and no-code workflow automation. It is configured into distinct
**process-shaped products** — marketing-agency ops, STR turnover & housekeeping, compliance SOPs,
generic business processes — via solution packs, not code forks (the ServiceNow model, where
process applications are configuration and data on a shared core).

### Scope of the platform model — what consolidates and what does not

The pack/config model applies to **process-shaped** products: those whose core is workflows,
checklists, SOPs, approvals, and tasks. It does **not** apply to **system-of-record / ERP-shaped**
products — those with a bespoke financial or domain core (e.g. property management with
double-entry accounting and leases, i.e. **Virn PM**). Those are **separate applications with their
own databases** that share the platform *foundation* (identity, billing, org model, UI,
conventions, and optionally the Ops workflow engine for their process features such as work orders,
turnover, and inspections) — but they are **not** packs on Ops. The end state is a **product family
on a shared foundation**, not a single app. Even within one industry the line holds: property
*operations* (turnover, maintenance, inspections) is process-shaped and Ops-appropriate; property
*records* (GL, leases, invoices) are ERP-shaped and belong to the separate app.

### Guiding principles

1. **Ambitious model, narrow first build.** The data model reserves the extensibility for a
   platform-of-products. The MVP exercises exactly one slice of it (kernel + workflow engine +
   config + one pack + library). Do not build the generic meta-platform before one real vertical is
   in users' hands.
2. **Configuration over code — for process-shaped products.** A new process vertical or customer
   customization is a bundle of configuration (capabilities, settings, templates, taxonomies, field
   definitions, roles) — never a fork. ERP-class verticals are separate apps on the shared
   foundation, not configurations.
3. **Metadata-driven extensibility.** Customers and verticals extend the data model through
   registered definitions + validated JSONB, not new hand-written tables.
4. **Strict tenancy.** Everything a customer runs is org-scoped. The only deliberate cross-tenant
   exceptions are the publishable library and platform-owned packs.

---

## 2. Layered architecture

Four layers, top configures down, each rests on the one below.

- **Tenant configuration** — per-org capability + setting overrides on top of installed packs.
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
2. **The cross-tenant exception is contained.** Only `template_listing(_version)` and platform-owned
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

## 7. MVP scope

| Area | In v1 | Reserved (seam only) | Deferred |
|---|---|---|---|
| Tenancy / auth | Org-scoped, Better Auth, custom org procedures | Business-unit hierarchy | Hard domain separation |
| RBAC | Org roles + custom roles + basic ACL | Groups | ABAC |
| Config | Capability/setting system + 1 pack | Pack marketplace | Third-party packs |
| Workflow core | Definition/execution split, versioning, snapshot | — | — |
| Automation | Run-level rules on the general engine | Non-run events | SLA engine, full action catalog |
| Fields | `field` + `field_definition` registry (JSONB) | `object_type` | No-code object builder |
| Governance | Approvals, reviews, acknowledgments | — | General approval engine |
| Library | Private/org/public listings, install-as-clone, first-party seed | Reviews | Monetized marketplace |
| Data sets | — | Schema reserved | Full build |
| Billing | Entitlement → capability grants | Usage metering | Multi-product billing |
| Integrations | Outbound webhooks + Inngest | Connection registry | iPaaS hub |
| Analytics | `activity_event` stream + run/step status | Saved views | BI / dashboards |
| Platform | — | — | Multi-region / data residency |

**First Ops vertical (pack):** pick a genuinely **process-shaped** one and build it end-to-end. STR
turnover & housekeeping is the natural first pack — it's pure process work, leverages your
operational knowledge, and is self-dogfoodable. (Full property management is **not** a pack — that's
Virn PM, the separate app. Only its process slices, e.g. turnover/work orders, are Ops-appropriate.)
Prove one pack; further process verticals become a packaging exercise.

---

## 8. Stack reference

Next.js (App Router) · React 19 · Better Auth (organization plugin) · Drizzle ORM on Postgres (Neon)
· oRPC + Hono · Inngest · TanStack Query/Table · next-intl · Tailwind + shadcn/ui · Zod · Sentry.
Turborepo + pnpm, `@virn/*` scope. Fresh Supastarter clone with the Propvana KEEP-list grafts.

---

## 9. Open questions

- First Ops vertical (pack): STR turnover vs. marketing ops vs. compliance SOPs (all process-shaped).
- Custom-object framework depth for MVP: JSONB-on-core-records only, or a minimal `object_type` +
  generic `record` table from the start?
- How far to take the shared **foundation** between Ops and Virn PM (shared identity now; shared
  workflow engine for PM's process features later?).
- Approval engine: per-feature now, or one generalized engine sooner than planned?
- Library monetization: free-only at launch, or reserve `template_purchase` from day one?
