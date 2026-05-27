# PRD — Workflow & SOP Builder v1.5

**Status:** Draft v2 (architectural re-anchoring per D-034)
**Date:** 2026-05-27
**Owner:** pgrennell
**Inspiration:** [getbesty.ai/features/workflow-sop-builder](https://www.getbesty.ai/features/workflow-sop-builder) (friendly parity with PM-side cross-repo partner per D-024..D-033) + 2026-05-27 strategic-architecture conversation (synthesized below)
**Supersedes:** Draft v1 of this PRD. Extends [docs/BUILD_PLAN.md](BUILD_PLAN.md) Phase 5 and pulls Phase 12 AI authoring forward.

---

## 1. Background and architectural frame

The Builder Pass 3 work shipped in Phase 5 gives operators a powerful authoring canvas with draft/publish, dry-render preview, and field-key locking ([docs/UX_SPEC.md](UX_SPEC.md) §5, [docs/DECISIONS.md](DECISIONS.md) D-017–D-020). The underlying schema in [packages/database/drizzle/schema/workflows.ts](../packages/database/drizzle/schema/workflows.ts) is strong: versioned, snapshot-immutable, audit-only governance, mode-aware participants.

What it doesn't have is the *on-ramp*. Operators start at a blank canvas, must learn the palette, and have no way to express "this workflow applies to my pet-friendly homes but not the rest." Besty's pitch — "turn any SOP into a visual, branching workflow in plain English" — is exactly the wedge our v1 pivot (D-021: AI-credible v1) calls for.

But: Besty's builder feels effortless because **they hard-coded the nouns**. STR is a fixed world — Listing, Guest, Reservation, Owner. Templates like "Late Checkout" and "Pet Approval" are written *against those nouns*. Narrowness is the feature. The moment a horizontal builder loses those fixed nouns, the naive result is n8n: powerful, intimidating, the opposite of "describe it and it builds itself."

The whole design problem reduces to one sentence: **keep Besty's "it just works for my world" feel while making the underlying nouns configurable.**

### 1.1 The three-layer architecture

This PRD adopts the three-layer architecture from the 2026-05-27 strategic conversation. v1.5 ships the **seams** for each layer; the full configurable build of Layer 1 is a separate post-v1 phase (per D-034).

| Layer | What it is | What v1.5 ships | What's deferred |
|---|---|---|---|
| **Layer 1 — Configurable entity model** | A custom-object system: tenants define entity types with typed fields, statuses, and relationships. STR = Listing → Guest → Reservation; commercial = Building → Suite → Tenant → Lease → WorkOrder → Vendor; IT Ops = Site → Asset → Incident → Ticket. Hybrid storage (core columns + JSONB attrs + relationship graph). | **Seams only.** `entity_set` (with `entity_type` discriminator) replaces the v1-draft `listing_cohort`. A thin entity-adapter TS interface fronts entity lookups. Only `entity_type='listing'` is wired in v1.5. | Full custom-object system (tenant-defined entity types, JSONB attrs, relationship graph, UI). Post-v1 phase. |
| **Layer 2 — Vertical-agnostic workflow engine** | Triggers (entity events + schedules + inbound comms + webhooks + manual) → conditions/branches (rules over entity fields + context) → composable actions (send message, create/assign task, update entity, request approval, wait/delay, escalate, call integration, generate document, run AI step). Scope = filter over an entity set. | Generalize the cohort filter into entity-set scoping. Document the existing action vocabulary as the v1 composable set. Run-launch dispatcher reads `entity_set` membership. | Entity-event triggers (Phase 6+18). Inbound-comms triggers (S-09, v1.1+). Webhook triggers beyond cross-repo. |
| **Layer 3 — AI authoring layer** | LLM takes plain-English description + the **tenant's entity schema** + the action vocabulary → emits a validated structured workflow graph. Grounding in the tenant's real schema is what makes a horizontal builder feel like Besty. | AI authoring procedures on the agents oRPC router; system prompt embeds the tenant's entity schema (in v1.5: the property-ops fixed set, fetched from the entity adapter and cached); Zod validator checks entity references are real. | Vertical-agnostic AI grounding once Layer 1 is configurable. Same code path, different cached schema per tenant. |

### 1.2 The three-views unification (an architectural commitment)

Besty keeps its Knowledge Base and Workflow Builder as separate features — same content lives in two places, edited twice. Virn makes a different call: **the SOP, the KB article, and the runnable workflow are three views of one object**.

- **Author view** — the existing builder canvas. Edits the workflow's source of truth.
- **Read view** — the published version rendered as an SOP / KB article. Read-only, acknowledgeable, searchable. No "Start a run" button (runs launch from listings / triggers / runs index).
- **Execute view** — what a run participant sees when actually performing a step. Already exists (the run UI).

Editing the workflow in Author view updates Read view automatically (and propagates to Execute view on next publish via the existing snapshot mechanism). The AI authoring layer can both **tell someone how a process works** (read-view rendering + RAG) and **run it** (run engine) from the same object. This is the human / AI / agent-executable bridge from day one — Besty doesn't have it.

### 1.3 The discipline ("configurable underneath, never blank on top")

The trap that kills every horizontal/configurable tool: configurability tempts you to expose a blank canvas, and a blank canvas destroys the Besty feel. The discipline that v1.5 commits to:

> **Configurable underneath, never blank on top.** Every customer lands inside a pack with live templates and the AI author. Never an empty node graph.

Besty avoids the blank canvas by being narrow. Virn avoids it with **vertical packs + AI authoring**. v1.5 ships the property-ops pack (STR-first per D-034) as the v1 content wedge, with the architecture neutral enough that future packs (commercial PM, residential, IT Ops) are days of curation rather than months of engineering.

### 1.4 Horizontal positioning + pack ordering (D-034)

Virn is property-ops *horizontal* — D-021 locks the vertical domain to property operations (covering STR, long-term residential, commercial, multifamily, mixed-use), and D-034 specifies STR as the first sub-vertical within it. The v1 pack content ships STR-first; the *architecture* (three layers + three views) is neutral so additional packs (Commercial PM, Residential, IT Ops as proof-of-engine) can ship cheaply post-v1.

This PRD is property-ops-pack-aware: examples skew STR per D-034's dogfood profile, but no schema, validator, UX, or copy decision hard-codes an STR-only worldview.

## 2. Problem

Three concrete blockers prevent operators from moving SOPs out of Notion / Slack / heads:

1. **Blank-canvas tax.** Pass 3 requires the author to know the palette, dependency graph, and field-key conventions before they can express the SOP they already have. Time-to-first-publish is high.
2. **Rigid scoping.** Multi-property orgs need workflow differences by entity set — pet-friendly vs no-pets (STR), furnished vs unfurnished (LTR), retail vs office (commercial), garden vs mid-rise (multifamily). Today: duplicate the workflow per cohort and maintain N copies.
3. **No read-only reference; SOPs and workflows are siloed.** Even published workflows can only be encountered through a run. There's no "operator opens the SOP to remember the rule" surface (Process Street's KB gap from [docs/SCRATCHPAD.md](SCRATCHPAD.md)) — and even when there is, every other tool keeps KB and Builder as separate features that drift apart.

## 3. Users & jobs

| User | Job |
|---|---|
| **Property ops lead** (primary; STR-first per D-034 dogfood; same surface serves LTR, commercial, multifamily — typically 5–50 doors) | "Capture every recurring process so I stop being the bottleneck, without spending a Saturday in a builder." |
| **VA / on-site staff / contractor** (secondary) | "When I'm executing a turnover, a tenant request, a vendor coordination, or a guest issue, give me the canonical procedure I can read once and act on." |
| **Property owner / asset manager** (tertiary) | "Show me that the team has documented, repeatable processes for the things I care about." |

## 4. Goals

- **G1.** Operators paste/dictate an SOP and get an editable draft workflow within 60 seconds — not a blank canvas.
- **G2.** A workflow can be scoped to an entity set (in v1.5: a set of listings); no copy-paste duplication for variants.
- **G3.** AI authoring is **grounded in the tenant's entity schema** — the AI knows what entities exist and refers to them by name, so outputs feel like "for my world" rather than generic templates.
- **G4.** The SOP / KB article / runnable workflow are reachable as three views of the same object. Editing once updates all three.
- **G5.** A `draft → in_review → published` lifecycle gives orgs an optional gate before a workflow goes live.
- **G6.** A starter pack of property-ops templates spans STR, LTR, commercial, multifamily, and cross-cutting flows. Curated as the first instance of the Vertical Pack primitive (D-034: STR-leaning for v1 dogfood).
- **G7.** The schema seams (entity_set + entity_type discriminator + entity adapter interface) make Layer 1's full configurable entity model a content-and-UI build later, not a schema migration.

## 5. Non-goals (v1.5)

- Full Layer-1 configurable entity model (custom objects, tenant-defined entity types, JSONB attribute UI, relationship graph editor). Post-v1 phase.
- Multi-pack support (Commercial PM pack, Residential pack, IT Ops pack) — deferred per D-034. v1.5 ships seams that make these cheap later.
- Entity-event triggers, inbound-comms triggers, webhook triggers (Phase 6, Phase 18, v1.1+).
- Conditional step visibility (Phase 6).
- Automation rule firing (Phase 6).
- `dueType ∈ {offset_from_step, from_date_field}` (Pass 4).
- Agent step execution (Phase 11 — the `step.type='ai'` enum value stays a reserved seam).
- Voice input for AI authoring.
- In-house concierge review service (we ship the flag, not the team).
- Multi-org template marketplace.

## 6. Scope — six capabilities organized by layer

### 6.1 Layer 1 seams — `entity_set` + entity adapter

**Model.**
- New table `entity_set` (org-scoped, named, color label, `entity_type` discriminator).
- New table `entity_set_member` — polymorphic by `entity_type` + `entity_id`. In v1.5, `entity_type` is constrained to `'listing'`; the column exists so the model is entity-agnostic without future schema breakage.
- New column `workflow.entity_set_ids uuid[] DEFAULT '{}'` — empty array means "applies to all entities of any type" (preserves current behavior).

**Entity adapter (TS interface).**

```ts
interface EntityAdapter<T extends EntityType> {
  type: T;
  listForOrg(orgId: string): Promise<EntityRef[]>;
  getById(orgId: string, id: string): Promise<EntityRef | null>;
  schemaForAI(): EntitySchemaForAI;  // describes the entity to the AI authoring system prompt
}
```

In v1.5 there's exactly one implementation: `ListingAdapter`. Adding `BuildingAdapter`, `IncidentAdapter`, etc. post-v1 is additive — no changes to `entity_set`, the workflow engine, or the AI authoring layer beyond registering the adapter.

**Why this matters for v1.5.** The cost of naming it `entity_set` vs `listing_cohort` is one column (`entity_type`) and one polymorphic join. The cost of *not* doing it is a forklift rename when Layer 1 lands. Cheap seam, expensive omission.

### 6.2 Layer 2 — generalized entity-set scoping + documented action vocabulary

**Builder UX.**
- Workflow settings panel gains a **Scope** section: multi-select of entity sets. Empty = applies to all. Example sets an org might create (STR-flavored per D-034 dogfood, but architecturally entity-type-agnostic):
  - STR (v1.5 dogfood profile): "Pet-Friendly Homes", "Luxury", "Beachfront", "Overseas Owners"
  - LTR (post-v1, illustrative): "Section 8", "Furnished", "Single-Family"
  - Commercial (post-v1, illustrative): "Retail Ground Floor", "Office Suites"
  - IT Ops (post-v1, illustrative): "P1 Incidents", "Production Sites"
- Listings index gains an **Entity sets** column showing chip badges. (Future entity types will gain their own indexes with the same UI pattern.)
- Listing detail page gains an **Entity sets** field (multi-select, editable inline).

**Run launch behavior.**
- When `runs.launch` is invoked from an entity context, the dispatcher filters available workflows by `workflow.entity_set_ids ∩ entity.entity_set_ids ≠ ∅ OR workflow.entity_set_ids = '{}'`.
- When `runs.launch` is invoked workflow-first, no scope filtering; the user picks the entity freely (UI warns if mismatch).

**Reuse hook.** Entity sets become reusable for vendor-pool routing (D-027) — same set can later scope "which vendor pool serves these entities." Out of scope for v1.5 but the data model assumes it.

**Action vocabulary (documented, not new).** Layer 2 calls out the v1 action vocabulary that workflows compose from: task, approval, heading, one_off, [reserved: code, ai]. Documenting it explicitly in this PRD (rather than leaving it implicit in code) is the architectural commitment — the AI authoring layer treats this as the closed set it can emit. New action types are additive and gated through the same enum.

### 6.3 Layer 3 — AI SOP authoring grounded in tenant entity schema

**The architectural commitment.** AI authoring must ground in the **tenant's actual entity schema**, not generic placeholders. This is what makes a horizontal builder feel like Besty even when the underlying nouns are configurable. In v1.5 the "tenant entity schema" is the property-ops fixed set (listing today; vendor, owner, work_order as Phase 8 schema is already in place); when Layer 1 ships, the same code path serves tenant-defined entities.

**Entry points.**
- New button in the workflow list: **"Describe an SOP"** (sits beside "New blank workflow" and "Install from templates").
- New section in onboarding: "Have an existing SOP? Paste it here."

**Input modes (v1.5b).**
- Free-text prompt — placeholder rotates across property-ops types so the affordance reads as horizontal even with STR-first content:
  - STR: "Pets are allowed only with a $200 fee; photos of the pet required; cleaner gets a heads-up."
  - LTR: "When a tenant gives 60-day notice, schedule a move-out inspection, coordinate cleaner and painter, post the listing 30 days out, route security-deposit reconciliation to ops manager for sign-off."
  - Commercial: "Quarterly HVAC service — notify tenant 5 business days ahead, send vendor a work order with after-hours access details, capture service report, file with insurance binder."
  - Multifamily: "Resident reports a leak — log to maintenance system, dispatch on-call plumber within 2 hours, notify adjacent units if shutoff required, post-repair photo and resident sign-off."
- Paste of SOP text from Notion / Word / Google Docs (markdown- or plain-text-pasted).
- File upload of `.txt` / `.md` / `.pdf` (PDF text extracted client-side; if extraction fails, prompt for paste).

**Pipeline.**
1. Client sends `{prompt, sourceText?, fileName?, entitySetHints?}` to `agents.authorWorkflow` oRPC procedure (new — see §8.3).
2. Server fetches the tenant's entity schemas via the entity adapter registry (cacheable per org).
3. Server calls Claude API with a system prompt that embeds:
   - The builder's JSON contract + the palette/dueType constraints (§10).
   - **The tenant's entity schemas** — what entities exist, their fields, their relationships. The AI is told it may reference these by name in step descriptions, field labels, and `entityReference` payloads.
   - The action vocabulary from §6.2.
   - Few-shot examples drawn from the starter pack (§6.5).
4. Claude returns a strict-JSON `WorkflowDraft` object matching the builder mutation contract.
5. Server validates with Zod; cross-references entity-references against the live entity schema (rejects "for each Booking" if no `Booking` entity exists); on schema failure, retries once with the validator error appended; on second failure, surfaces "couldn't parse your SOP — try simplifying" to the user.
6. Server creates a `draft` workflow + `workflow_version` + steps/fields and returns the workflow id.
7. Client routes to `/library/workflows/[id]?view=author&aiAuthored=1` with the side-by-side review pane open.

**Review surface.**
- Two-pane: left = original NL/source text, right = generated workflow as a read-only canvas snapshot.
- Per-step inline actions: **accept**, **edit**, **delete**, **regenerate this step from prompt: "<refine prompt>"**.
- Whole-workflow actions: **accept all → goes to builder**, **regenerate workflow with addendum**, **start over**.

**Constraints (AI must respect — encoded in system prompt + validator).**
- Step types limited to `task`, `approval`, `heading`, `one_off`. `code` and `ai` are reserved seams and MUST NOT be emitted.
- `due_type` limited to `none` and `offset_from_start`. Any due relative to other steps gets flagged with a comment on the step ("AI suggests: due 1 day after Step 3 — wire manually when conditional due dates ship") but the field is set to `none`.
- Conditional branching is flattened: AI emits all steps and adds a `precondition_note` comment on conditionally-relevant steps so the author can wire them when Phase 6 lands.
- Approval-typed steps are emitted as `approval`, ready for the Phase 5+ approval engine.
- Field keys: AI proposes keys; field-key lifecycle lock (D-017) applies as soon as a generated merge variable references a key.
- Entity references: AI may only reference entities the validator confirms exist in the tenant's schema. Unknown references rejected at validation.

**Provenance.**
- `workflow.ai_authoring_prompt_id` set to the `ai_authoring_prompt` row that produced it (audit + retroactive regeneration support).
- Visible in builder header: "Authored from prompt on 2026-05-27 — view source".

### 6.4 Three-views unification (Author / Read / Execute)

**The model.** One workflow object; three views over its published version.

| View | URL | Surface | Permissions |
|---|---|---|---|
| **Author** | `/library/workflows/[id]?view=author` (default for authors) | Builder canvas, edits source-of-truth | Author / Admin / Owner |
| **Read** | `/library/workflows/[id]?view=read` (default for readers) | SOP/KB markdown rendering: steps, descriptions, field labels, role hints, expected outputs. "Mark as read" action. | Any org member |
| **Execute** | `/runs/[runId]` (unchanged from today) | Run engine UI: live field inputs, complete actions, comments/activity | Run participants |

**Browse-ergonomic surfaces.**
- `/library/workflows` — authors' index (all states, all workflows the user can see).
- `/sop` — readers' index (published only, opens detail pages in `?view=read`). Both lead to the same `/library/workflows/[id]` detail page; the `view` query param controls mode. Authors landing in `?view=read` see a toggle to switch to author; readers landing in `?view=author` are redirected to read mode if they lack write perms.

**Why two indexes if it's one object?** The audiences are different. The authors' index needs filters by state, owner, last edit. The readers' index needs filters by topic, recency, "what's new since I last read." Same backing data, different lenses. Both deep-link to the same detail page with the appropriate view default.

**Acknowledgements.**
- Read view's **Mark as read** button → inserts `sop_read_receipt` row (`workflow_id`, `version`, `user_id`, `read_at`).
- Org admins see per-workflow read receipts on the workflow detail page in any view ("12 of 17 ops members have read this SOP").
- Reconciliation note: existing `acknowledgment` table (used by Phase 16 governance flows) is for *active sign-off* (compliance). `sop_read_receipt` is for *passive read*. Both can render on the same timeline at Phase 15 if useful.

**Permissions.**
- Read view: any org member with `member` role or above.
- Author view: existing builder permissions unchanged.
- Editing in Author view updates Read view immediately on save (draft) or on publish (published). Snapshot-immutability per D-019 preserved — Read view of a published version always reflects that snapshot.

**Strict no-execution constraint.** Read view never shows a "Start a run" button. Runs launch from entity contexts (listings index, run dispatcher, triggers) — keeps the mental model clean and matches the SCRATCHPAD note about Process Street's KB gap.

### 6.5 Property-ops starter pack content (the first Vertical Pack)

**Pack framing.** Per the 2026-05-27 architectural reframe (and D-034), the GTM unit is the **Vertical Pack** = entity schemas + workflow templates + integration presets + AI grounding vocabulary. v1.5 ships the property-ops pack's *workflow template library* as a refreshed curated set; entity schemas + integration presets + AI vocabulary for this pack already exist in the codebase (Phase 17a, the vendor module, the AI authoring system prompt).

**Curation goal.** Span property-ops types out of the box so an org of any property mix sees relevant starters on first install. STR-leaning by count per D-034 dogfood profile, but horizontal in surface area to keep the engine honest.

| Property-ops type | Templates |
|---|---|
| **STR / vacation rental** (Besty parity + STR-native; v1.5 dogfood lead) | Pet Approval Request · Noncritical Issue Triage · Discount Request Handling · Guest Complaint Escalation · Inbound Call Routing · Lockout Resolution · Early Check-In Request · Late Checkout Request · Post-Stay Review Request · STR Turnover & Housekeeping (standard) · Deep-clean cadence · Pre-arrival prep |
| **Long-term residential** | Lease renewal · Move-in (tenant onboarding + walkthrough) · Move-out (inspection + deposit reconciliation) · Late-rent collection · Resident complaint / nuisance triage · Periodic interior inspection |
| **Commercial** (office / retail / industrial) | Tenant fit-out coordination · Quarterly preventive-maintenance dispatch · Certificate-of-insurance refresh · After-hours access request · Lease expiration / renewal notice · CAM reconciliation prep |
| **Multifamily** | Common-area inspection · Amenity-incident response · Mid-lease unit inspection · Building-system outage response |
| **Cross-cutting** (any property type) | Maintenance work-order triage · Vendor onboarding (insurance, W-9, scope of work) · Owner / asset-manager monthly report · Emergency response (fire / flood / outage) · New-listing / new-unit setup |

**Mechanics.**
- All ship as platform-published `template_listing` rows (`publisherOrganizationId IS NULL`) using the existing install flow ([packages/database/drizzle/schema/library.ts](../packages/database/drizzle/schema/library.ts)).
- AI authoring (§6.3) uses templates as priors via a "similar to…" affordance: `"Like Late Checkout Request but for pets"`, `"Like Periodic Inspection but quarterly"`, `"Like Move-Out but for furnished short-term lease"`. Server fetches the template version + appends to the system prompt.
- Templates surface in the builder onboarding: "Install a template", "Describe your own", "Start blank" — with "Start blank" the third option, never the default (per §1.3 discipline).

**Forward-looking note.** Future packs (Commercial PM, Residential, IT Ops per D-034 revisit triggers) bundle their own entity schemas + templates + integration presets + AI grounding vocabulary as a unit. v1.5's pack mechanism (Phase 17a) handles install; v1.5 doesn't expand the mechanism, just adds content.

### 6.6 Review states

**Lifecycle change.**
- Current: workflow versions are `draft` or `published` (or `archived`).
- v1.5: add `in_review` between `draft` and `published`.
- New column `workflow.review_state pg_enum('draft','in_review','published','archived')` (workflow-level lifecycle, independent of version snapshots).

**Per-org gate.**
- New org setting `requireConciergeReview: boolean` (default `false`).
- When `true`, the "Publish" button on a draft becomes "Submit for review", which transitions to `in_review` and notifies org admins.
- Admins see an inbox: **Workflows awaiting review** with diff against last published version (uses existing `getVersionEditBundle` query) and **Approve & publish** / **Send back to draft** actions.

**Concierge stays opt-in self-serve (per D-034 / proposal decision #3).**
- We do not provide an in-house review service in v1.5. The flag exists so orgs can wire their own internal review gate.
- Audit row on every transition (who, when, action).

## 7. UX flows

**Flow A — AI SOP authoring (happy path).**
1. Operator clicks **Describe an SOP** on the workflow list.
2. Modal: text area + file drop + "Use template as starting point" picker. Submits.
3. Loader (5–15s typical) → routes to `/library/workflows/[id]?view=author&aiAuthored=1` with side-by-side review pane.
4. Operator skims, edits one step inline, clicks **Accept all**.
5. Workflow is now a normal `draft` — operator can publish (or submit for review if their org requires).

**Flow B — Entity-set-scoped run launch.**
1. Operator opens a listing, clicks **Launch run**.
2. Workflow picker shows only workflows where `entity_set_ids` is empty OR intersects the listing's entity sets (entity-set chip badges shown for context).
3. Picks workflow, run launches as today.

**Flow C — Review-required publish.**
1. Operator finishes draft, clicks **Submit for review** (button label flipped because org has `requireConciergeReview: true`).
2. Workflow moves to `in_review` state; org admins notified.
3. Admin opens the diff view, approves → workflow publishes; or sends back with a comment.

**Flow D — Reader finds and acknowledges an SOP.**
1. Reader opens `/sop` and searches for whatever they need — "pet" (STR), "lease renewal" (LTR), "HVAC quarterly" (commercial), "leak" (multifamily), "vendor onboarding" (cross-cutting).
2. Clicks a result — lands at `/library/workflows/[id]?view=read` (the same detail URL the author would use, but defaulted to read mode).
3. Reads the SOP, clicks **Mark as read**.
4. Receipt logged; visible to org admins on the workflow detail page in any view.

**Flow E — Author edits, all three views update.**
1. Author opens `/library/workflows/[id]?view=author`, edits a step description ("…cleaner gets a heads-up via SMS, not email").
2. Save → draft updated. Read view immediately reflects the change (latest draft visible to authors; readers still see the last published version).
3. Author publishes → snapshot created. Read view for readers now reflects the new version. Any newly-launched runs use the new snapshot. (Existing in-flight runs continue on their snapshot per D-019.)

## 8. Data model & architecture

### 8.1 Schema deltas

```sql
-- New: Prerequisite — `listing` table did not previously exist in the schema (verified
-- 2026-05-27; only `template_listing` / `template_listing_version` were present, which
-- are library-distribution tables, not runnable entity data). Created here as part of
-- v1.5a because it's the first registered EntityAdapter type and is referenced
-- load-bearingly by Phase 17 (property-ops pack) and Phase 8 (vendor / participant
-- model). Minimum shape; richer columns (lat/lng, capacity, amenities) ship later
-- as actual customers dictate the field set.
CREATE TABLE listing (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organization(id),
  name text NOT NULL,
  external_listing_id text,    -- nullable; populated by cross-system sync (Hospitable id, Guesty id, etc.)
  property_type text,          -- free text in v1.5: 'str' | 'ltr' | 'commercial' | 'multifamily' | 'mixed_use'.
                               -- Deliberately not enum'd — cohort membership (entity_set) is the canonical
                               -- categorization mechanism. This column is a convenience hint for filters.
  address jsonb,               -- optional structured address {street, city, region, postal, country}
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE UNIQUE INDEX listing_org_external_id_uniq
  ON listing (organization_id, external_listing_id)
  WHERE external_listing_id IS NOT NULL;

-- New: Layer-1 seam
CREATE TYPE entity_type AS ENUM ('listing'); -- only one value in v1.5; future packs add values

CREATE TABLE entity_set (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organization(id),
  entity_type entity_type NOT NULL,
  name text NOT NULL,
  color text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, entity_type, name)
);

CREATE TABLE entity_set_member (
  entity_set_id uuid NOT NULL REFERENCES entity_set(id) ON DELETE CASCADE,
  entity_type entity_type NOT NULL,
  entity_id uuid NOT NULL,
  PRIMARY KEY (entity_set_id, entity_type, entity_id),
  CHECK (
    (entity_type = 'listing' AND EXISTS (SELECT 1 FROM listing WHERE listing.id = entity_id))
    -- CHECK extended as new entity_type values land
  )
);

-- (Optional v1.5 alternative: store the per-type FK in a separate column with a partial-index pattern.
-- The CHECK above is conceptually clean but may be expensive; final shape decided at migration authoring.)

-- New: review state
CREATE TYPE review_state AS ENUM ('draft','in_review','published','archived');

-- New: AI authoring provenance
CREATE TABLE ai_authoring_prompt (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organization(id),
  user_id uuid NOT NULL REFERENCES "user"(id),
  prompt text NOT NULL,
  source_text text,
  response_json jsonb NOT NULL,
  entity_schema_snapshot jsonb NOT NULL, -- snapshot of the entity schema sent to the AI, for reproducibility
  model text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- New: Read view acknowledgments
CREATE TABLE sop_read_receipt (
  workflow_id uuid NOT NULL REFERENCES workflow(id),
  workflow_version int NOT NULL,
  user_id uuid NOT NULL REFERENCES "user"(id),
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workflow_id, workflow_version, user_id)
);

-- Altered: workflow gains scope, review state, AI provenance
ALTER TABLE workflow ADD COLUMN entity_set_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE workflow ADD COLUMN review_state review_state NOT NULL DEFAULT 'draft';
ALTER TABLE workflow ADD COLUMN ai_authoring_prompt_id uuid REFERENCES ai_authoring_prompt(id);

-- Altered: org gains concierge-review flag
ALTER TABLE organization ADD COLUMN require_concierge_review boolean NOT NULL DEFAULT false;
```

Migration notes (per [feedback memory on Drizzle migrations](../docs/) — migrations are tracked, hand-edit before applying): backfill `entity_set_ids` to `'{}'`; backfill `review_state` to `'published'` for already-published workflows and `'draft'` otherwise; respect the Postgres enum-in-same-txn-CHECK constraint per memory by casting to `::text` in CHECKs if a new `entity_type` value is added in a single migration alongside the CHECK.

### 8.2 Entity adapter registry (TS interface, not schema)

```ts
// packages/api/modules/entities/adapters/index.ts
export interface EntityAdapter<T extends EntityType> {
  type: T;
  listForOrg(orgId: string): Promise<EntityRef[]>;
  getById(orgId: string, id: string): Promise<EntityRef | null>;
  schemaForAI(): EntitySchemaForAI;
}

export const adapters: { [K in EntityType]: EntityAdapter<K> } = {
  listing: ListingAdapter,
  // future: vendor, work_order, building, suite, tenant, lease, asset, incident, ticket, site
};
```

`schemaForAI()` returns a structured description of the entity (name, fields, relationships) that the AI authoring system prompt consumes. In v1.5 there's one adapter; the registry shape makes adding more a one-line change.

### 8.3 Builder mutation contract changes

- `workflows.update` gains `entitySetIds: string[]` (optimistic — array swap).
- `workflows.submitForReview` (new, AWAIT) — only valid from `draft`, only when org has `requireConciergeReview: true`.
- `workflows.approveReview` (new, AWAIT) — admin-only, transitions `in_review → publish` via existing publish path.
- `workflows.sendBackToDraft` (new, AWAIT) — admin-only, transitions `in_review → draft` with optional comment.
- `entitySets.*` (new, full CRUD) — `list`, `get`, `create`, `update`, `softDelete`, `addMember`, `removeMember`.

### 8.4 AI authoring via agents oRPC router

Per the proposal-stage decision #2: AI authoring lives behind the agents oRPC router ([packages/api/modules/agents/router.ts](../packages/api/modules/agents/router.ts)), not as a direct Claude SDK call inside a workflows procedure. This:

- Reuses the same surface MCP hosts will hit later (S-01a — oRPC is canonical, MCP wraps).
- Gives us a single audit trail for every Claude call (cost, latency, tokens, model id).
- Lets us swap the underlying model per-org or per-tier without touching workflows code.

**New procedures (agents router).**
- `agents.authorWorkflow(input: { prompt, sourceText?, templateHintId?, entitySetHints? }) → { workflowId }` — creates the draft + `ai_authoring_prompt` row + `workflow_version` and returns the new workflow id.
- `agents.regenerateStep(input: { workflowId, stepId, refinementPrompt }) → { updatedStep }` — used by the per-step regenerate action in the review pane.

**Prompt-caching strategy.** The system prompt has three stable parts cached together: the builder JSON contract + palette/dueType constraints + action vocabulary + few-shot examples. The **entity schema** for the tenant's org is a fourth cacheable block, invalidated when the tenant's entity definitions change. Per-request input (the user's NL prompt) is uncached.

**Model default.** `claude-sonnet-4-6` for cost; switch to `claude-opus-4-7` if Sonnet's structured-output reliability is insufficient in dogfood.

## 9. Cross-repo touchpoints (D-024..D-033)

- **Workflow source-of-truth stays in virn-ops.** Besty does not get an authoring surface; PM-side workflows live in Besty's own product.
- **Besty can launch entity-set-scoped workflows via `runs.launch`** (outbound creds + HMAC webhooks per D-024). The scope filter applies on the virn-ops side, transparent to Besty.
- **Entity sets are virn-ops-owned** but the set id may appear in run metadata Besty receives so PM-side dashboards can group by it.
- **AI authoring is virn-ops-only in v1.5.** No symmetric NL builder shipped to Besty (per D-033 — Virn PM Action API + MCP wrapper are v1.1+).

## 10. Constraints honored (Pass 3 invariants)

| Invariant | Where it comes from | How v1.5 respects it |
|---|---|---|
| Palette gates on `isEnabled` | Memory note on Pass 3 constraints | AI authoring system prompt restricts emitted step types to the enabled set |
| Key rename = AWAIT | Memory note on Pass 3 | No change — AI-generated keys go through same lifecycle |
| `FIELD_KEY_LOCKED` drives "clear references first" | D-017 + memory | AI never emits a rename; locked-chip mechanic unchanged |
| Locked-chip can't be triggered in-app until conditions/due-rules ship | Memory note | AI emits `precondition_note` comments on conditionally-relevant steps; no in-app trigger before Phase 6 |
| `due_type` UI must match what `launchRun` resolves | Memory + `launch-run.ts:241-248` | AI restricted to `none` / `offset_from_start`; no UI exposure of deferred modes |
| Top-level routes must be in `forbiddenOrganizationSlugs` | Memory note | `sop` added to [packages/auth/config.ts](../packages/auth/config.ts) + snapshot in the same migration as the route |
| Org-scoping invariant | [docs/ARCHITECTURE.md](ARCHITECTURE.md) §4 | All new tables org-scoped or composite-keyed through org-scoped parents |
| Snapshot immutability on publish | [docs/ARCHITECTURE.md](ARCHITECTURE.md) §5 + D-019 | Review states are workflow-level, not version-level — no change to snapshot semantics. Read view of a published version always reflects that snapshot. |
| No Docker | Memory feedback | All work in-process; no compose changes |
| `ALTER TYPE ADD VALUE` + same-txn CHECK | Memory feedback | If new `entity_type` values land alongside CHECKs, cast columns to `::text` in CHECKs |

## 11. Phasing

**Total: ~5 weeks** (AI authoring is the long pole).

### v1.5a — Layer-1 seams + Layer-2 scoping + review states + pack refresh (2 weeks + ~1 day for listing-table prerequisite, no AI dependency)
- **Week 1, days 1–2:** **Listing table prerequisite** (validated 2026-05-27 — the table did not exist; see §8.1 schema delta). New `listing` table with minimum shape; minimum CRUD oRPC procedures (`listings.list / get / create / update / softDelete`); minimum listings index UI under `/library/listings` or as a settings section so something can create listings in v1.5a. Sample listings seeded by the property-ops pack install (Phase 17a) so dogfood orgs land with non-empty data.
- **Week 1, days 3–5:** Schema migrations (`entity_set`, `entity_set_member`, workflow column adds, review_state enum); `ListingAdapter` + `EntityAdapter` registry; entity-set CRUD + listing assignment UI; workflow Scope panel; `runs.launch` entity-set filter.
- **Week 2:** Review state column + transitions, admin inbox, property-ops starter pack content refresh (curate templates from §6.5 as platform-published rows).

### v1.5b — Layer-3 AI authoring grounded in tenant entity schema (2 weeks)
- Week 1: `agents.authorWorkflow` procedure, system prompt assembly (with entity schema block), Zod contract + entity-reference validation, Claude API integration with multi-block prompt caching, `ai_authoring_prompt` table.
- Week 2: "Describe an SOP" modal, side-by-side review pane, per-step regenerate, accept-all flow, dogfood pass on the STR template intents (per D-034 dogfood profile) to validate output quality.

### v1.5c — Three-views unification + reader surface (1 week)
- `/sop` readers' index, `/library/workflows/[id]?view=read` Read view + Mark-as-read + receipt model, view-mode toggle on detail page, `forbiddenOrganizationSlugs` update for `sop`, permission-aware default-view resolution.

### Post-launch (1.5d, not scoped here)
- Voice input for AI authoring.
- Template community / sharing.
- Entity-set-scoped vendor pools (D-027 follow-on).

## 12. Open questions

1. **Entity-set uniqueness across orgs?** Currently scoped per org per entity type. Should platform-published templates suggest entity sets ("this template assumes a Pet-Friendly Listings set exists")? Lean: yes, with a one-click "create matching set" affordance during install. **Punt to dogfood.**
2. **AI authoring rate-limits.** Per-org per-day cap to control Claude spend, or per-user? Lean: per-org, with `5 free authoring runs / day / paid seat`. **Confirm with billing model owner.**
3. **Review state vs version state.** Should `in_review` block all new version drafts, or only block publish? Lean: only block publish (drafts can keep accruing). **Confirm with first dogfood org.**
4. **Read-mode default for authors.** When an author opens a workflow detail page, should they land in Author view or Read view? Lean: Author view (their primary job), with a visible toggle. Non-authors default to Read view (Author view redirects them). **Confirm in v1.5c implementation.**
5. **Source-text retention.** `ai_authoring_prompt.source_text` could contain sensitive content. Lean: 90-day retention, then redact body but keep metadata. **Confirm with legal/compliance posture.**
6. **Entity-set member polymorphism.** The CHECK constraint in §8.1 (validate referenced entity exists per `entity_type`) is conceptually clean but may be expensive. Alternative: separate per-type FK columns + partial indexes. **Decide at migration authoring.**
7. **`entity_set` label vocabulary.** "Entity set" reads technical. Should the UI label it "Cohort" / "Group" / "Segment"? Lean: "Set" in UI ("Workflow applies to these listing sets…"); "entity_set" stays in the schema. **Pick during v1.5a UX detailing.**
8. **Read-receipt vs acknowledgment reconciliation.** Per Phase 10 update in BUILD_PLAN — keep separate (`sop_read_receipt` passive, `acknowledgment` active sign-off) or unify under `acknowledgment.type='read_receipt'`. Lean: separate for v1.5; reconcile at Phase 15 compliance pack if needed.

## 13. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Claude returns invalid `WorkflowDraft` JSON | Medium | Strict Zod validation + one retry with validator error appended; surface a graceful "couldn't parse" message rather than hanging. |
| AI emits entity references that don't exist in tenant schema | Medium | Validator cross-references against live entity schema and rejects on failure; retry once with error appended. |
| AI generates field keys that collide with existing locked keys on the same workflow | Low (new workflows are empty) | First-pass: only check uniqueness within the generated draft. Cross-workflow key collisions are a non-issue per current schema. |
| Entity-set seam over-engineered for one entity type in v1.5 | Low | The cost is one enum, one polymorphic join, and one adapter interface. Cheaper than a forklift rename when Layer 1 lands. |
| Entity-set filter silently hides workflows operators expect to see | Medium | Workflow picker shows a "Filtered by entity sets: X, Y" pill with a one-click "Show all" escape hatch. |
| Concierge review flag turned on accidentally locks an org out of publishing | Low | Admin can always disable the flag in org settings; ship with feature gated behind admin role to flip on/off. |
| Read view confused with execution surface | Medium | Strict copy: "Reference only — to run this SOP, launch from a listing." No "Start" button anywhere in Read view. |
| AI authoring spend balloons in dogfood | Medium | Rate limit per org (see open question #2); log token use per call; weekly cost review during dogfood. |
| Three-views toggle confuses authors who expected an editor | Low | Authors default to `?view=author`; toggle is visible but not modal. Readers don't see Author view at all. |
| Pulling AI authoring forward delays Phase 6 (conditional visibility) | Medium | Phasing keeps v1.5a fully decoupled from AI; Phase 6 can start in parallel with v1.5b/c. |

## 14. Success metrics

Tracked in PostHog + ops dashboard, reviewed at 30 / 60 / 90 days post-launch:

| Metric | Target |
|---|---|
| % of new workflows started via AI authoring vs blank canvas | >60% by day 30 |
| Median time from "Describe an SOP" submit → "Accept all" → publish | < 10 min |
| Templates installed per org (first 7 days after signup) | ≥ 3 |
| Entity-set-scoped workflows per org (orgs with > 1 entity set) | ≥ 1 per set by day 30 |
| `/sop` weekly active readers / total org members | > 40% |
| Read-receipt coverage on most-active SOP per org | > 70% of intended audience |
| AI authoring Claude API cost per active workflow | Tracked; target TBD post-dogfood |
| AI output entity-reference validation pass rate (first try) | > 85% |

## 15. Out-of-scope but design-aware

These are explicitly punted but the v1.5 design must not foreclose them:

- **Full Layer-1 configurable entity model.** Custom-object system with tenant-defined entity types, JSONB attrs, relationship graph editor. v1.5 ships the seams (`entity_type` discriminator, polymorphic `entity_set_member`, adapter registry) so the full build is content-and-UI work, not a schema migration.
- **Additional packs (Commercial PM, Residential, IT Ops).** Deferred per D-034 with revisit triggers. v1.5 ships the pack-content mechanism (already in Phase 17a) generically enough to absorb new packs.
- **Vertical-agnostic AI grounding once Layer 1 lands.** Same `agents.authorWorkflow` code path; different cached entity schema per tenant. v1.5's entity-schema block in the system prompt is the seam.
- **Conditional visibility (Phase 6).** AI emits `precondition_note` comments on conditionally-relevant steps; author wires them when the mechanic ships.
- **Automation rule firing (Phase 6).** Same — AI emits intent as notes, author wires when available.
- **Agent step execution (Phase 11).** `step.type='ai'` reserved seam unchanged. AI authoring never emits this type in v1.5.
- **Entity-event triggers (Phase 6+18).** Engine-side; not exposed in v1.5 builder.
- **Inbound-comms triggers (S-09, v1.1+).** Slack/Teams/email/SMS/form/call triggers.
- **Entity-set-scoped vendor pools (D-027 follow-on).** Entity-set model is intentionally reusable as a vendor-pool scope target.
- **Multi-org template marketplace.** Template library stays platform-curated in v1.5; community publishing is a separate v1.6+ surface.
- **Voice input for AI authoring.** Same pipeline; adds a transcription step on the client. Defer to v1.5d or v1.6.

## 16. Roadmap implications

What v1.5 enables and forecloses for the longer trajectory:

| Future work | v1.5 enables it because… | v1.5 does not foreclose it because… |
|---|---|---|
| **Layer-1 full build** (custom-object system) | `entity_type` discriminator, polymorphic `entity_set_member`, adapter registry are in place. Adding `BuildingAdapter` etc. is additive. | No assumption that `entity_type='listing'` is the only value. Schema, validator, AI prompt all parameterized. |
| **Pack #2 (Commercial PM) per D-034 trigger** | Pack mechanism (Phase 17a) handles install; entity-set model is entity-agnostic; AI authoring grounds in whatever entity schema the pack ships. | Property-ops templates aren't load-bearing on STR-specific entities (use the generic property-ops entity adapter set). |
| **Three packs in parallel** (STR + Commercial + Residential) | Adapter registry, AI grounding, entity sets are all multi-pack-ready. | No single-pack-wins assumption in any v1.5 schema or UX. |
| **Pack marketplace (v1.1+)** | `template_listing` already supports `publisherOrganizationId` for non-platform packs. | v1.5 only ships platform-published templates but the model supports community packs. |
| **Virn PM symmetric Action API (v1.1+, per D-033)** | Cross-repo touchpoints in §9 don't assume one-way. | Entity sets propagate to PM via run metadata; PM can echo back at v1.1+ without virn-ops schema changes. |
| **Vertical-agnostic AI grounding** | System prompt's entity-schema block is the seam; new entity types appear in the cached block automatically. | No hard-coded entity names anywhere in the AI prompt. |
| **Three views become four** (e.g. Audit view for compliance) | Detail page is a view-switcher pattern; adding a fourth view is a route param + permission check. | No assumption that there are exactly three views. |
| **Reader KB → AI Q&A surface (RAG)** | Read view content is structured + searchable; can feed RAG over the same workflow corpus. | `/sop` index and Read view are clean read surfaces with content well-shaped for embedding. |

What v1.5 *does* foreclose (intentionally):

- **Blank-canvas onboarding.** §1.3 commits to "configurable underneath, never blank on top." Future surfaces that violate this principle should be challenged.
- **Separate KB and Builder products.** Three-views unification is a one-way door. Future PRDs that propose "let's build a standalone KB" should reference §6.4 and explain why.
- **STR-specific schema or copy.** Even with STR-first dogfood (D-034), no v1.5 column, validator, or copy hard-codes STR. Future PRDs that add STR-only schema fields should be questioned.

---

## Appendix A — Builder mutation contract (AI output shape)

The validator used in §6.3. Authoritative source-of-truth lives next to the procedure in code; this is the PRD snapshot.

```ts
const WorkflowDraft = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  // Entity references the AI suggests this workflow operates on. Validated against
  // the tenant's entity adapter registry (§8.2) — unknown types or names rejected.
  entityReferences: z.array(z.object({
    type: z.string(), // must match a registered EntityType
    role: z.string(), // free text, e.g. "the listing being turned over"
  })).default([]),
  sections: z.array(z.object({
    title: z.string(),
    steps: z.array(z.object({
      title: z.string(),
      type: z.enum(["task", "approval", "heading", "one_off"]),  // gated palette
      description: z.string().optional(),
      // Free-text — workflow roles are per-workflow content (per Phase 17a precedent:
      // "Property Manager", "Housekeeper", "Inspector", "Owner"). Property-ops
      // covers STR (guest), LTR (tenant), commercial (tenant rep, facilities mgr),
      // multifamily (resident, on-site staff), so no fixed role enum at the AI seam.
      role: z.string().min(1).max(60).optional(),
      dueType: z.enum(["none", "offset_from_start"]),            // gated dueType
      dueOffsetDays: z.number().int().nullable(),
      preconditionNote: z.string().optional(),                   // AI hint for Phase 6
      fields: z.array(z.object({
        label: z.string(),
        proposedKey: z.string().regex(/^[a-z][a-z0-9_]*$/),
        type: z.enum(["text", "number", "date", "select", "photo", "checkbox"]),
        required: z.boolean().default(false),
      })).default([]),
    })),
  })),
});
```

## Appendix B — Reference

- Builder Pass 3 UI: [apps/saas/modules/builder/](../apps/saas/modules/builder/)
- Workflow schema: [packages/database/drizzle/schema/workflows.ts](../packages/database/drizzle/schema/workflows.ts)
- Template install model: [packages/database/drizzle/schema/library.ts](../packages/database/drizzle/schema/library.ts)
- Agents router (extends in §8.4): [packages/api/modules/agents/router.ts](../packages/api/modules/agents/router.ts)
- Run launcher (entity-set filter integration point): [packages/api/modules/runs/lib/launch-run.ts](../packages/api/modules/runs/lib/launch-run.ts)
- Auth config (route reservation): [packages/auth/config.ts](../packages/auth/config.ts)
- Strategy decisions: [docs/DECISIONS.md](DECISIONS.md) D-017–D-021, D-024–D-034
- Build plan context: [docs/BUILD_PLAN.md](BUILD_PLAN.md) Phases 5, 6, 9.5, 10, 11, 12, 17
- UX context: [docs/UX_SPEC.md](UX_SPEC.md) §5
- Architecture invariants: [docs/ARCHITECTURE.md](ARCHITECTURE.md) §4–5
