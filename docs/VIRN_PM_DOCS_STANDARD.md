# VIRN PM DOCS STANDARD & SCAFFOLD

**Source:** `virn-ops` repo `docs/` + root dev docs, extracted 2026-06-01.
**Audience:** the `virn-pm` Claude Code session. **Self-contained** — assume zero context from the Ops session.
**Purpose:** mirror the Ops documentation standard in `virn-pm`, reuse shared-foundation content verbatim, and cleanly fence off Ops-domain-specific material (the workflow/run/SOP/playbook engine) that must NOT carry to PM.

> **How to use this file.** Open a fresh `virn-pm` Claude Code session (VSCode extension or CLI, opened on the `virn-pm` repo). Paste this entire file into the first message, or tell that session to read it by path. It has everything needed to build PM's doc set from scratch.

> **PM's current pivot (the thing this package is built around):** PM is removing **all deep accounting** — GL tables, accounting milestones M1–M4, chart of accounts — and moving it to a separate product, **Trustline** (AI-native cross-PMS trust-accounting agent). PM keeps an **operational financial layer** (charges, payments/rent collection, work-order costs, attribution) and exposes it to Trustline + other AI tools via a PMS-agnostic contract + PM's own MCP/Action API. With accounting gone, **PM's wedge is the operational core of residential property management** (maintenance/work-orders, tenant/owner experience, leasing, rent collection, stakeholder portals), AI-ready, integrated with Ops (process) and Trustline (books). Every PM-specific TODO below assumes this pivot.

---

## ⚠️ LIVE CROSS-REPO ACTION REQUIRED (Virn Ops side)

**PM's accounting-removal pivot is not self-contained — it breaks a reference in the Virn Ops repo that must be corrected.** Ops's cross-repo docs gate work on *"PM's Accounting M4"* (e.g. a paste-back states *"Build remains gated on Accounting M4 per §K of the original pivot entry"*). With milestones **M1–M4 removed**, every Ops-side reference to PM's accounting milestones is now **stale**.

**Required action (highest-priority paste-back):** the PM session must send Virn Ops a paste-back announcing the split (`D-PM-001`) so Ops can append a **correction entry** to its `DECISIONS.md` (in-place `> Correction added <date>` blockquote, preserving the original reasoning per the append-only convention) and update any BUILD_PLAN/paste-back lines that gate on PM accounting milestones. Until that lands, Ops's docs describe a dependency that no longer exists.

Draft to produce: `docs/PM_PASTE_BACK_2026-06-01_accounting_removal_to_ops.md` (see Part 5.3). This is the one cross-repo item that touches *Ops's* working docs, so it should not wait behind PM's internal doc build.

---

## PART 1 — DOC-SYSTEM INVENTORY

The Ops `docs/` system is a small set of **normative, agent-loaded markdown files** plus a large **review-artifact tree**. Every primary doc opens with a `**Status:** Draft vN · **Date:** · **Owner:**` line and a blockquote `> **For AI agents (Claude Code, etc.):**` telling the agent *when to load this file* and *what in it is non-negotiable*. Files cross-link heavily by section number (`ARCHITECTURE.md §3`, `STRATEGY S-07`, `D-021`).

### 1.1 Root-level dev docs

| File | Purpose | Structure / template | Detail level |
|---|---|---|---|
| `agents.md` | THE first-read file every session. **Part 1 — orientation** (project-specific, authoritative: what the product is, read-order, safety tiers, invariants summary, house rules, runtime-efficiency rules) + **Part 2 — framework conventions** (cross-cutting Next.js/oRPC/Better Auth/Drizzle/UI/forms/i18n inherited from supastarter). | `# Part 1` / `# Part 2`; Part 1 ends with House rules + Runtime efficiency; Part 2 is a stack-conventions cheat sheet with ✅/❌ code blocks. | ~865 lines. Very high. |
| `CLAUDE.md` | One line: `agents.md`. | trivial | trivial |
| `README.md` | 10-line product blurb + pointers to `agents.md`, `ARCHITECTURE §3`, `BUILD_PLAN`. | Title, paragraph, bullet pointers, `Product · Domain · Repo` line. | Minimal by design. |
| `CHANGELOG.md` | Consumer-impacting change log, conventional-commit style. | Dated/versioned entries. | Medium. |
| `CODE_REVIEW.md` | Batch-organized review plan (Batch A–F) other docs reference. | Batched checklist. | High. |
| `docs/STACK.md` | **(NEW, created 2026-06-01)** Canonical stack reference consolidated from `agents.md` Part 2 + `ARCHITECTURE §8`. Descriptive-not-normative. | Header + one-line summary, technology stack, monorepo structure, path aliases, DB/env, tooling, related refs. | Medium. |

### 1.2 `docs/` primary normative docs

| File | Purpose | Section structure | Key conventions |
|---|---|---|---|
| `ARCHITECTURE.md` | **The foundation ADR.** Stable; invariants + strategic seams. | §1 Vision · §2 Layered architecture · **§3 Invariants** · §4 Strategic seams (ADR-001…008) · §5 Domain-core decisions · §6 Conventions · §7 MVP scope matrix · §8 Stack · §9 Open questions. | Numbered invariants; ADRs as **Context/Decision/Rationale/Now-Defer/Consequences**; MVP scope as `In v1 / Reserved / Deferred` table. |
| `STRATEGY.md` | Positioning + bets (the *why*). **Subordinate to ARCHITECTURE.** | §1 The bet · §2 Competitive frame · §3 Where we lead · §4 Gaps ranked · §5 Bets (`S-0x`) · §6 Scorecard · §7 How to use · §8 Open questions · Appendix A. | Bets `S-0x` as **Bet/Why/Build-implication/Status**; "supersede, don't delete"; status vocab `v1 / v1.1 / post-v1 / reserved / superseded`. |
| `DECISIONS.md` | **Append-only running log** of smaller decisions. | Dated `## YYYY-MM-DD — <theme>` → `### D-### — <title>` with **Context/Decision/Rationale/Consequences**. | Serial `D-###`; cross-repo blocks get a **Cross-repo mapping** table; supersede via in-place `> Correction added <date> (per D-0xx)` blockquotes preserving original reasoning. |
| `BUILD_PLAN.md` | Phased roadmap; "each phase ≈ one Claude Code session — verify and commit between phases." | "What changed" → dated `### Update` re-anchoring blocks → phases with acceptance gates + explicit build-order lines. | Phases reference `S-0x` + `D-###`. |
| `CONFIGURATION.md` | Normative spec for the **capability/setting registry** + 3-level resolver (L1 platform / L2 profile presets / L3 per-org overrides). | §1 Three levels · §2 Resolver · §3 Capabilities vs settings · §4 Write helpers · §5 Packs reserved seam · §6 Gotchas · §7 Key files. | Tables + resolver pseudo-logic + file links. |
| `AUTH_CONTRACT.md` | **Normative contract** for auth/session/org/tenancy — what Better Auth ships, what Virn extends, what CI pins. | §1 Scope · §2 Surface inventory · §3 oRPC ladder · §4 Tenancy chain · §5 Behaviors to preserve · §6 CI-pinned invariants · §7 Sharp edges · §8 Pre-merge checklist · §9 Reference files · §10 Change log. | Config-knob tables; the **procedure ladder**; numbered pinned invariants; literal checklist. |
| `BRANDING.md` | Brand + domain architecture for **all** Virn products — "keep a copy in each product repo." | Master brand · Products & domains table · Subdomain system · Per-app config · Shared sign-in (roadmap) · White-label (roadmap, asymmetric) · How products relate. | Branded-house model. |
| `UX_SPEC.md` | UI/UX + nav spec. | §1 Scope · §2 Gating model (capability × role) · §3 App shell & nav · §4 Screen specs `[NOW]` · §5 Operator screens · §6 Decisions mirror. Each screen: purpose·layout·key elements·states·gating·MVP cut·data ties. | Wireframes = reference only; spec normative; every screen gated via §2. |
| `SCRATCHPAD.md` | **Intentionally disconnected** scratch file. Not loaded by agents. | Date-grouped entries with `Kind/Source/Status/Tags`. | "Would future-Paul be annoyed to lose this?" bar. |
| `PRD_*.md` | Per-feature PRDs. | Header (`Status/Date/Owner/Inspiration/Supersedes`) → §1 Background & architectural frame → §2 Problem → §3 Users & jobs → data model → phases. | Layered-architecture framing; references `D-###`/`S-0x`/schema. |
| `PM_PASTE_BACK_*.md` / `*_RESPONSE_*.md` | **Cross-repo paste-back protocol** artifacts — point-in-time briefings between sessions. | Header `Direction: A → B / Date / Author / Purpose` + `> How to use` blockquote. Body: recap → don't-re-litigate → action items → mutual questions → what to return. | Snapshot artifact, **not live spec**; numbered items; mapping tables. |

### 1.3 Supporting trees

- `docs/reviews/<topic>-<YYYY-MM-DD>/` — per-phase UI-verification: `ANTIGRAVITY_BRIEFING.md` + `REPORT.md` + sequential screenshots `01-…png`. House rule: copy walkthrough screenshots into the repo. Default verification = headless Playwright spec; Antigravity is last-resort exploratory only.
- `docs/reviews/_template/ANTIGRAVITY_BRIEFING_TEMPLATE.md` — locked briefing template (copy → fill `{{ }}` → drop N/A). Structure: header, Prerequisites, Test plan (P0/P1/P2), "What to send back", "Kickoff prompt".
- `docs/wireframes/*.html` — static one-file-per-screen mockups, reference only.

### 1.4 The doc-precedence ladder (load-bearing)

```
ARCHITECTURE.md  (invariants + ADRs — non-negotiable, the law)
        ▲ subordinate to
STRATEGY.md      (direction + bets — may argue to promote a seam, never override an invariant/ADR)
        ▲ feeds order into
BUILD_PLAN.md    (phase sequencing + acceptance gates)
        ▲ records "we did it" in
DECISIONS.md     (append-only log; ARCHITECTURE §4 holds the heavyweight ADRs)

CONFIGURATION / AUTH_CONTRACT / UX_SPEC / STACK = normative/reference specs for their slice
BRANDING = cross-product, copied into every repo
SCRATCHPAD = disconnected; PRD_* = per-feature; reviews/ = verification artifacts
```

When a STRATEGY bet is acted on → record in DECISIONS referencing the bet (`per STRATEGY S-0x`) and update BUILD_PLAN if phase order changes. The 2026-05-26 pivot that re-anchored everything is `D-021`.

---

## PART 2 — FOUNDATION vs OPS-SPECIFIC CLASSIFICATION

### 2.1 SHARED FOUNDATION — transfers verbatim or near-verbatim

| Pattern / content | Where in Ops | Transfer note |
|---|---|---|
| **Branded-house brand + domain system** | `BRANDING.md` | Copy verbatim; PM is already a row. Update only "how the products relate" for the pivot. |
| **Subdomain + org-slug-in-path routing** (`<product>.virn.com/[orgSlug]/…`) | BRANDING, AUTH_CONTRACT §2.9, UX_SPEC §3 | Verbatim. PM is `pm.virn.com`. |
| **Identity / Better Auth contract** (org plugin, magic-link, OAuth, passkeys, 2FA, invitation-only plugin, session model) | `AUTH_CONTRACT.md §2` | Shape verbatim; PM re-verifies values against its own `packages/auth/config.ts` (separate Neon DB + auth instance). |
| **oRPC authorization ladder** (`publicProcedure / protectedProcedure / protectedOrgProcedure / adminOrgProcedure / adminProcedure`) | AUTH_CONTRACT §3, agents.md | Verbatim. Default-for-tenant-data = `protectedOrgProcedure`, org from session not input. |
| **Tenancy invariant #1** (`organizationId NOT NULL`, `withOrg(orgId)`, RLS deferred) | ARCHITECTURE §3.1, AUTH_CONTRACT §4 | Verbatim. |
| **Tenancy end-to-end chain** | AUTH_CONTRACT §4 | Verbatim. |
| **CI-pinned auth invariants + snapshot + pre-merge checklist + two-tier safety check** | AUTH_CONTRACT §6/§8, agents.md | Verbatim. |
| **Configuration/settings registry** (L1/L2/L3, resolver, write helpers, capability×setting, packs reserved seam) | `CONFIGURATION.md` | Mechanism verbatim; PM's capability *keys/profiles* are PM-domain content. |
| **Two-axis gating** `visible = capabilityEnabled(org) ∧ permitted(user)` | UX_SPEC §2 | Verbatim — the access-control spine. |
| **RBAC + tenant-hierarchy seam** (ADR-004) | ARCHITECTURE §4, D-009/D-010 | Mechanism transfers; PM's role *names* differ. |
| **Entitlements unify billing + config** (ADR-005) | ARCHITECTURE §4 | Verbatim. |
| **Agent-principal model** (ADR-006: org-scoped `agent` table + `participant.kind=agent` + credential + capability grants + `actorKind` audit; "agent" = any non-human caller incl. sibling products) | ARCHITECTURE §4, D-022 | **Highly relevant** — PM's MCP/Action API + Trustline integration use this exact shape. |
| **Schema conventions** (cuid PKs via `id()`; timestamps/softDelete/orgId helpers; one file per domain group + relations; pgEnum vs lookup+`_translations`; polymorphic = entityType enum + entity_id + CHECK; three-bucket deletes; **money = integer minor units + ISO-4217 snapshot**) | ARCHITECTURE §6, agents.md | Verbatim. Money convention is load-bearing for PM's operational financial layer. |
| **Neon dual-URL rule** (`DIRECT_URL` migrations / `DATABASE_URL` runtime) | agents.md, D-005, STACK.md | Verbatim — PM has its own Neon DB, same hazard. |
| **Drizzle migration discipline** (tracked not gitignored; generate + show SQL; never push without confirmation) | agents.md, D-013 | Verbatim. |
| **agents.md Part 2 framework conventions** (monorepo, aliases, naming, RSC, oRPC shape, TanStack Query, notifications, forms RHF+Zod, i18n, Tailwind/shadcn, perf, tooling) | agents.md Part 2 | **Verbatim** except the `apps/saas/modules/*` list. |
| **agents.md house rules + runtime-efficiency rules** | agents.md | Verbatim (path-substituted). |
| **Stack reference doc** (languages, runtime, monorepo, `@virn/*` aliases, Neon dual-URL, tooling, two-tier safety check) | `docs/STACK.md` | **Verbatim, path-substituted.** Descriptive-not-normative; defers to agents.md Part 2 + ARCHITECTURE §6. |
| **Doc taxonomy + precedence ladder + status/owner headers + agent-load blockquotes** | all docs | Verbatim — this package IS that taxonomy. |
| **DECISIONS append-only ADR-lite format + supersede + cross-repo mapping tables** | DECISIONS.md | Verbatim. |
| **Cross-repo paste-back protocol** (snapshot artifact, fresh-session paste, direction header, don't-re-litigate, mirror both sides, mapping table) | `PM_PASTE_BACK_*` | Already a PM↔Ops shared protocol; extend to PM↔Trustline. |
| **Antigravity briefing template + verification routing** (Playwright-default, P0/P1/P2, sequential screenshots, REPORT.md) | reviews/_template | Verbatim; swap repo path + seed. |
| **Memory conventions** (file-per-fact, frontmatter `name/description/metadata.type`, MEMORY.md index, `[[links]]`, update-don't-duplicate, absolute dates) | harness memory | Verbatim — app-agnostic. |
| **Shared sign-in + white-label roadmap** (D-031/D-032; `organization_domain`, hostname middleware, `branding_settings`, certs, Resend verified domains) | BRANDING, DECISIONS | PM's white-label scope is the **broader** one (staff app + portals + email + PDFs). |

### 2.2 OPS-DOMAIN-SPECIFIC — must NOT carry to PM

PM may later *consume* Ops's engine via the action surface, but does not re-implement it.

| Pattern / content | Where in Ops | Why it stays in Ops |
|---|---|---|
| **Workflow content-object substrate** (`workflow → workflow_version → section → step → field`; `workflow.type`; definition/execution split; snapshot-on-publish) | ARCHITECTURE §3 inv #2–#5, §5 | This IS Ops. PM is a system-of-record, not a procedure engine. |
| **Run/execution model** (`run → run_step → field_value`; three modes human/ai_assisted/automated — S-07) | UX_SPEC §5, STRATEGY S-07 | Ops's headline wedge. |
| **SOP/KB reader surface + three-views unification** (S-03, S-08) | STRATEGY, PRD | Ops content-object views. |
| **Playbooks** (lifecycle-sequence primitive) | PRD_PLAYBOOKS | Ops process primitive. |
| **Automation engine** (event → rule → action; ADR-003) | ARCHITECTURE §4 | Ops engine. PM may *trigger* Ops runs, not host it. |
| **Template library / packs as the process-product mechanism** (ADR-001; the property-ops pack) | ARCHITECTURE §4/§5 | **ARCHITECTURE §1 rule: ERP/SoR apps like PM are NOT packs on Ops.** |
| **Field-key lifecycle, AI workflow authoring, regenerate-step provenance** (D-017, D-039/40/41, ADR-008) | DECISIONS, ARCHITECTURE §4 | Authoring-engine internals. |
| **STR turnover content, kickoff field-key vocabulary, vendor-as-participant-kind** (ADR-007) | ARCHITECTURE §4, STRATEGY S-04 | Ops vertical content. PM keeps its *own complete vendor entity* (linked, not inherited). |
| **Ops competitive frame** (Scribe/Tango/n8n/Besty; STR comps) | STRATEGY §2 | PM's frame is PM/SoR suites + AI-PM entrants. |

### 2.3 The bright line (state it in PM's ARCHITECTURE §1, quotable verbatim)

> The pack/config model applies to **process-shaped** products. It does **not** apply to **system-of-record / ERP-shaped** products — those with a bespoke domain core (property management with leases and records). Those are **separate applications with their own databases** that share the platform *foundation* (identity, billing, org model, UI, conventions, and optionally the Ops workflow engine for their process features) — but they are **not** packs on Ops. The end state is a **product family on a shared foundation**, not a single app.

**PM's pivot sharpens this:** with deep accounting leaving for Trustline, PM is now a *leaner* SoR — operational records + an operational financial layer — that **publishes** to two AI surfaces (Trustline for books, Ops for process). PM is the **operational system-of-record**; Trustline is the **books**; Ops is the **process**.

---

## PART 3 — PM DOCS SCAFFOLD

> **PM's doc set = Ops's doc set, minus the Ops-domain engine docs, plus exactly ONE genuinely new doc: `TRUSTLINE_CONTRACT.md`.** Every other PM doc is either a verbatim foundation copy or a PM-domain reskin of an existing Ops doc. `TRUSTLINE_CONTRACT.md` is the only structurally new artifact — it exists because the PM↔Trustline financial boundary is a load-bearing seam with no Ops analogue, and it's modeled on `AUTH_CONTRACT.md` (Ops's precedent for documenting a pinned cross-boundary contract).

```
virn-pm/
├── agents.md                         # two-part; Part 2 verbatim from Ops, Part 1 PM-specific
├── CLAUDE.md                         # one line: agents.md
├── README.md                         # PM blurb + pointers
├── CHANGELOG.md                      # conventional commits
└── docs/
    ├── ARCHITECTURE.md               # foundation + PM domain core + Trustline boundary
    ├── STRATEGY.md                   # PM competitive frame + bets
    ├── DECISIONS.md                  # append-only; seed with the pivot decision
    ├── BUILD_PLAN.md                 # PM phases (accounting-removal first)
    ├── CONFIGURATION.md              # registry verbatim; PM capability/profile list TODO
    ├── AUTH_CONTRACT.md              # verbatim shape; PM values TODO
    ├── BRANDING.md                   # verbatim copy (cross-product)
    ├── UX_SPEC.md                    # PM screens; gating model verbatim
    ├── STACK.md                      # VERBATIM, path-substituted (Ops now has one too)
    ├── BACKLOG.md                    # PM already has one (referenced in paste-backs)
    ├── SCRATCHPAD.md                 # disconnected scratch
    ├── TRUSTLINE_CONTRACT.md         # NEW — PMS-agnostic financial contract + MCP/Action API
    ├── PRD_*.md                      # per-feature PRDs
    ├── reviews/_template/ANTIGRAVITY_BRIEFING_TEMPLATE.md   # verbatim
    └── PM_PASTE_BACK_*.md            # cross-repo artifacts (Ops + Trustline)
```

Below: skeleton + pre-filled content. **[VERBATIM]** copies straight from Ops; **TODO(pm)** marks PM work.

### 3.1 `agents.md`

```markdown
# Coding Agent Guidelines — Virn PM
Read first, every session. Part 1 = PM orientation (authoritative). Part 2 = framework
conventions inherited from supastarter.

# Part 1 — Virn PM orientation

## What this is
Virn PM is the operational system-of-record for residential property management — maintenance
& work-orders, tenant & owner experience, leasing, rent collection, stakeholder portals. Sibling
to Virn Ops (process/workflow engine) on the shared Virn foundation. Separate app, OWN Neon DB,
NOT a pack on Ops.
TODO(pm): one-paragraph wedge statement.

## The accounting-removal pivot (load-bearing — read before any financial work)
ALL deep accounting REMOVED from PM → moved to Trustline (separate AI-native trust-accounting
agent). DROPPED: GL tables, accounting milestones M1–M4, chart of accounts. KEPT: operational
financial layer (charges, payments/rent collection, work-order costs, attribution). EXPOSED to
Trustline + AI tools via a PMS-agnostic contract + PM's MCP/Action API. See DECISIONS.md D-PM-001
and docs/TRUSTLINE_CONTRACT.md. When you encounter GL/CoA/M1–M4 code, FLAG it for removal — never
extend it.

## How the three products relate
PM = operational SoR (records, leases, work-orders, rent collection). Ops = process/workflow
engine (PM dispatches process work to Ops's Action API; Ops never touches PM's DB). Trustline =
books (PM publishes its operational financial layer via the contract). Mutually-standalone
(D-024): every cross-product link nullable; PM runs with no outbound calls.

## Read before working (in order)
1. docs/ARCHITECTURE.md  2. docs/BUILD_PLAN.md  3. packages/database/drizzle/schema/*.ts
## Read before touching auth-adjacent code  → docs/AUTH_CONTRACT.md §8  [VERBATIM pattern]
## Read before scope/prioritization  → docs/STRATEGY.md (PM frame, not Ops's)
## Two safety-check tiers  [VERBATIM] pnpm safety-check / safety-check:auth
## Stack  [VERBATIM one-liner — also see docs/STACK.md]
## Conventions  [VERBATIM — see ARCHITECTURE §6]
## Invariants  [VERBATIM #1 org-scoping, append-only audit; TODO(pm): no-GL invariant]
## House rules  [VERBATIM]
## Runtime efficiency  [VERBATIM]

# Part 2 — Framework conventions
[VERBATIM, ENTIRE — copy Ops agents.md Part 2 unchanged except the apps/saas/modules/* list.]
```

### 3.2 `docs/ARCHITECTURE.md`
- §1 Vision — TODO(pm) PM wedge post-pivot; **[VERBATIM]** bright-line (Part 2.3); guiding principles incl. Product-independence-with-linking + a new "books are Trustline's" principle.
- §2 Layered architecture — **[VERBATIM]** kernel/foundation layer; TODO(pm) PM domain core above the kernel (not packs).
- §3 Invariants — **[VERBATIM]** org-scoping, cuid PKs, append-only audit; **TODO(pm)** no-GL invariant + Trustline-reads-only-through-the-contract.
- §4 Strategic seams — **[VERBATIM]** ADR-004/005/006 (PM's MCP/Action API + Trustline use ADR-006). TODO(pm) ADR-PM-001 financial-layer boundary, ADR-PM-002 PM-owned vendor entity, ADR-PM-003 Trustline contract. DO NOT carry ADR-001/003/008.
- §5 Domain-core — TODO(pm) property/unit/lease/tenant/owner/work_order/charge/payment; mark GL/CoA/M1–M4 removed.
- §6 Conventions — **[VERBATIM, ENTIRE]** (money convention load-bearing).
- §7 MVP scope matrix — TODO(pm). §8 Stack — **[VERBATIM]**. §9 Open questions — TODO(pm).

### 3.3 `docs/STRATEGY.md`
- §1 bet — TODO(pm) operational-core wedge; accounting ceded to Trustline as a positioning bet.
- §2 competitive frame — TODO(pm) PM/SoR suites (AppFolio, Buildium, Yardi, DoorLoop, RentManager, Propertyware) + AI-PM entrants.
- §3 where we lead — **[VERBATIM foundation strengths]** (agent-native, two-axis gating, first-class participants) + PM-specific.
- §4 gaps ranked, §5 bets `S-PM-0x` (Trustline contract, Action API, rent collection, work-order lifecycle, portals), §6 scorecard, §7 **[VERBATIM]**, §8 open questions, Appendix A = pre-pivot accounting framing (historical, like Ops's D-021 demotion).

### 3.4 `docs/DECISIONS.md`
- **[VERBATIM preamble]** (append-only, ADR-lite, supersede-don't-delete, ARCHITECTURE §4 holds heavyweight ADRs).
- Seed **D-PM-001** — Remove deep accounting; move to Trustline (Context/Decision/Rationale/Consequences; the PM analogue of Ops's D-021).
- Seed a **mirror block** of Ops D-024..D-038 with a Cross-repo mapping table.

### 3.5 `docs/CONFIGURATION.md`
- **[VERBATIM mechanism, ENTIRE]** (L1/L2/L3, resolver, write helpers, packs reserved seam, gotchas).
- TODO(pm) replace example capability keys with PM keys (`leasing.online_applications`, `maintenance.work_orders`, `payments.online_rent`, `portals.owner`, `portals.tenant`, `financials.trustline_export`); replace profiles with PM modes.
- **Reconciliation (R1):** Ops filters disabled-capability settings *out entirely*; PM historically did *visible-but-disabled*. Decide explicitly and record as a D-PM-###. (Don't copy Ops's resolver blindly if PM keeps visible-but-disabled.)

### 3.6 `docs/AUTH_CONTRACT.md`
- **[VERBATIM shape, ENTIRE]** all 10 sections. Re-verify every *value* against PM's own `packages/auth/config.ts`. TODO(pm) PM's `forbiddenOrganizationSlugs`; re-baseline the §6 snapshot test.

### 3.7 `docs/BRANDING.md`
- **[VERBATIM, ENTIRE]** (it's explicitly "copy into each repo"). PM already in the table.
- TODO(pm): update PM's "how products relate" one-liner (operational SoR; books→Trustline; process→Ops); decide whether **Trustline gets a product row** (`trustline.virn.com`?). PM's white-label scope is the broader one (staff app + owner/tenant portals + email + PDFs).

### 3.8 `docs/STACK.md`
- **[VERBATIM]** from Ops `docs/STACK.md`. Substitute: React/Next versions if PM differs, the `apps/saas/modules/*` list, and add a note that **the operational financial layer uses money = integer minor units + ISO-4217**, and **deep accounting/GL is NOT in the stack — it lives in Trustline** (link `TRUSTLINE_CONTRACT.md`). Neon dual-URL, tooling, aliases, two-tier safety check transfer unchanged.

### 3.9 `docs/TRUSTLINE_CONTRACT.md` (NEW — the one genuinely new PM doc)
Model on `AUTH_CONTRACT.md` structure:
- §1 Scope & purpose — what PM owns (operational financial records) vs Trustline (GL, double-entry, trust reconciliation, books); contract is PMS-agnostic.
- §2 Financial-layer inventory — KEPT (charge, payment, work_order_cost, attribution); REMOVED (GL, chart_of_accounts, M1–M4); money convention.
- §3 The PMS-agnostic contract — stable versioned data shape Trustline reads (precedent: Ops's kickoff field-key vocabulary + event catalog, D-025/D-029).
- §4 Action API / MCP surface — **[VERBATIM agent-principal shape ADR-006/D-022]**: Trustline auths as an org-scoped `agent` row, capability-gated, audited with `actorKind='agent'` + `crossProductOrigin`; same write path as humans; optional MCP wrapper over oRPC.
- §5 Must-not-regress. §6 Pinned invariants (no GL in PM; Trustline reads only through the contract; financial mutations audited). §7 Sharp edges. §8 Pre-merge checklist.

### 3.10 `docs/BUILD_PLAN.md`
- **[VERBATIM preamble]**. "What changed (the accounting-removal pivot)" → Phase 0 = accounting-removal migration (drop GL/CoA; preserve charge/payment/cost) → operational financial layer → Trustline contract → Action API → work-order lifecycle → tenant/owner portals → Ops dispatch integration. Phases reference `S-PM-0x` + `D-PM-###`.

### 3.11 Smaller files
- `CLAUDE.md` — one line `agents.md` **[VERBATIM]**.
- `README.md` — PM blurb + `Product: Virn PM · Domain: pm.virn.com · Repo: virn-pm` + pointers. TODO(pm).
- `docs/SCRATCHPAD.md` — **[VERBATIM preamble]**, empty body.
- `docs/BACKLOG.md` — PM already has one; keep, ensure cross-repo notes blocks.
- `docs/reviews/_template/ANTIGRAVITY_BRIEFING_TEMPLATE.md` — **[VERBATIM]**, swap repo path → `c:\Projects\Virn\virn-pm`, swap seed/auth specifics.
- `docs/PRD_*.md` — per-feature, Ops PRD template. First: `PRD_OPERATIONAL_FINANCIAL_LAYER.md`, `PRD_WORK_ORDER_LIFECYCLE.md`, `PRD_STAKEHOLDER_PORTALS.md`.

---

## PART 4 — AGENTS.MD + MEMORY + BRANDING DEEP-DIVE

### 4.1 agents.md (PM-ready in §3.1)
Two parts with stated precedence ("Virn-specific wins"). Part 1 = orientation that **routes the agent to the right doc at the right time** ("read before X" sections) and states the non-negotiable invariants inline. Part 2 = the verbatim-shared supastarter substrate. Key property to carry: it **budgets its own token cost** (loaded every turn). PM's biggest addition is the **accounting-removal pivot section** — every session must FLAG (not extend) GL/CoA/M1–M4 and route process→Ops, books→Trustline.

### 4.2 Memory / context
Two systems, both inherited unchanged: (1) **file-based auto-memory** (`~/.claude/projects/<project>/memory/`, one fact per file, frontmatter `type ∈ user|feedback|project|reference`, `MEMORY.md` index, `[[links]]`, absolute dates, update-don't-duplicate) — PM gets its **own** project memory dir; (2) **SCRATCHPAD.md** (in-repo, disconnected, lower bar than DECISIONS). Escalation path: SCRATCHPAD → DECISIONS → ARCHITECTURE/STRATEGY. Context rule: at ~60% window, extract to `.claude/context/*.md` then tailored `/compact`; never `/clear` without asking; batch always-loaded-file edits to task end. **TODO(pm):** seed `project_pm_accounting_removal_pivot.md` + `project_trustline_contract.md`. **Critical caveat:** memory does NOT sync across Claude Code / Antigravity / the Ops/PM/Trustline sessions — non-trivial cross-product decisions must be pasted back and logged in BOTH repos' DECISIONS.md.

### 4.3 BRANDING (PM-ready in §3.7)
The one doc designed to be copied identically into every repo. Encodes: branded-house master brand (Virn), products-&-domains table, subdomain-per-product + org-slug-in-path routing, per-app config, **shared sign-in (roadmap, D-031)** with two shapes (shared auth store / OAuth federation) + trigger, **white-label (roadmap, asymmetric, D-032)** where **PM's scope is the broader one** (staff app + owner/tenant portals + email + PDFs) with shared primitives (`organization_domain`, hostname middleware, `branding_settings`, certs, Resend per-org domains). PM pivot adjustments: update "how products relate"; decide Trustline's branding row. Because PM owns the broader white-label scope + the portals, the white-label primitives are **nearer-term for PM** than for Ops.

### 4.4 Cross-repo paste-back protocol (PM now has TWO partners)
A paste-back is a self-contained briefing for a *fresh* session: header (`Direction / Date / Author / Purpose`) + `> How to use` blockquote; body recap → don't-re-litigate → numbered action items → mutual questions → what-to-return. Both repos mirror cross-repo decisions with a **Cross-repo mapping table** (Ops uses serial `D-###`; PM uses §-letters in dated entries). Responses preserved as snapshot artifacts. Corrections respect append-only via in-place `> Correction added <date>` blockquotes. **PM-ready:** keep Ops↔PM artifacts; add a parallel `TRUSTLINE_PASTE_BACK_*` series for PM↔Trustline, with `TRUSTLINE_CONTRACT.md` as the locus.

---

## PART 5 — RECONCILIATION NOTES & CROSS-REPO PASTE-BACK CANDIDATES

### 5.1 Where the Ops standard differs from likely PM content — and how to reconcile

| # | Divergence | Ops stance | PM reconciliation |
|---|---|---|---|
| R1 | Settings gated by a disabled capability | Ops **filters them out**; doc names PM as visible-but-disabled. | Decide explicitly; record D-PM-###. Resolver code differs — don't copy blindly. |
| R2 | Accounting / GL | Ops has none. | Pivot removes PM's GL/CoA/M1–M4. Flag pre-pivot refs; preserve framing in STRATEGY Appendix A. |
| R3 | Domain core packs-shaped? | Ops: config-over-code. | PM's record model is a bespoke SoR, NOT config-over-code. Carry config-over-code only for *configuration*. |
| R4 | Vendor entity | Ops owns a vendor *primitive* (ADR-007). | PM keeps its **own complete vendor entity**, linked via nullable FKs (D-026). Don't inherit Ops's vendor schema. |
| R5 | Competitive frame | Scribe/Tango/n8n/Besty. | PM = PM/SoR suites + AI-PM entrants. Different STRATEGY §2. |
| R6 | White-label / portals priority | Ops: narrow, post-v1. | PM: broad + portals are core → nearer-term. Re-sequence BUILD_PLAN. |
| R7 | Workflow/run/SOP/playbook engine | Ops's core. | **Do not re-implement in PM.** PM dispatches to Ops's Action API. If a PM doc starts specifying a workflow engine, that's a flag. |
| R8 | **STACK.md** | **Resolved** — Ops now ships `docs/STACK.md` (2026-06-01). | Shared-foundation doc; PM copies verbatim, path-substituted. No divergence. |
| R9 | Trustline is a new third party | Ops's model is bilateral (Ops↔PM). | PM is a **hub** (PM↔Ops *and* PM↔Trustline). ADR-006 + paste-back protocol generalize to N partners; name both in ARCHITECTURE §1 + agents.md. |

### 5.2 Cross-repo decisions this implies (paste-back candidates)

1. **→ Ops (do first):** the accounting-removal pivot itself. Ops's docs reference "PM's Accounting M4" as a build gate — now **stale**. Send Ops a paste-back so it appends a correction entry. *(See the ⚠️ banner at the top.)*
2. **→ Ops:** Trustline's existence + whether it needs an Ops-side `agent` identity (ADR-006) or only a PM-side one.
3. **→ Ops:** whether work-order-cost / financial-attribution fields need adding to the kickoff field-key vocabulary (D-029, locked at Ops Phase 17).
4. **→ Ops + Trustline:** re-evaluate shared-sign-in / white-label triggers (D-031/D-032) — a third product raises the two-account-UX cost; mirror in all BRANDING.md copies.
5. **→ Trustline (new series):** the PMS-agnostic financial contract shape (`TRUSTLINE_CONTRACT.md §3`) — the central PM↔Trustline loop (precedent: Ops↔PM `runs.launch` + event catalog, D-025).
6. **Mutual convention:** extend the numbering + mapping-table convention to the PM↔Trustline series.

### 5.3 Suggested first PM paste-backs to draft

- `docs/PM_PASTE_BACK_2026-06-01_accounting_removal_to_ops.md` — announces D-PM-001 to Ops; lists Ops-side stale "Accounting M1–M4" references to correct; asks Ops to confirm the agent-principal slot for Trustline. (Covers candidates 1–4.)
- `docs/TRUSTLINE_PASTE_BACK_2026-06-01_financial_contract.md` — opens the PM↔Trustline loop on the contract + Action API. (Covers candidate 5.)

---

## APPENDIX — Quick-start checklist for the PM session

1. **Copy verbatim, no edits:** `BRANDING.md`, `CONFIGURATION.md` (mechanism), `AUTH_CONTRACT.md` (shape), `STACK.md`, agents.md **Part 2**, `SCRATCHPAD.md` preamble, the Antigravity briefing template, the DECISIONS preamble + cross-repo conventions, the memory rules.
2. **Copy + re-verify values:** AUTH_CONTRACT config knobs + `forbiddenOrganizationSlugs` + pinned-invariant snapshot against PM's `packages/auth/config.ts`. STACK.md versions + module list.
3. **Write PM-specific:** ARCHITECTURE §1/§5/§7 (domain core + no-GL invariant), STRATEGY (PM frame + bets), BUILD_PLAN (accounting-removal first), UX_SPEC (PM screens), `TRUSTLINE_CONTRACT.md` (new), the PRD set.
4. **Seed DECISIONS.md** with D-PM-001 (the pivot) + the mirrored Ops cross-repo block.
5. **Seed memory** with `project_pm_accounting_removal_pivot.md` + `project_trustline_contract.md` (absolute dates, type=project).
6. **Resolve the reconciliations** in 5.1 explicitly (especially R1 settings-gating, R2 GL removal, R3 domain-core-not-packs).
7. **Draft the two paste-backs** in 5.3; log them in both repos.
8. **Send the ⚠️ accounting-removal paste-back to the Ops session** so Ops corrects its stale Accounting-M4 references.

**Non-negotiables that must survive intact in PM:** org-scoping (`organizationId NOT NULL`) · cuid PKs · money = integer minor units + ISO-4217 · append-only audit · the oRPC procedure ladder · two-axis gating · the agent-principal/Action-API shape · the doc precedence ladder (ARCHITECTURE > STRATEGY > BUILD_PLAN, DECISIONS append-only).
