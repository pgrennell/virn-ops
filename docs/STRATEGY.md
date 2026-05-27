# STRATEGY.md

Competitive positioning and strategic bets for **Virn Ops** — the *why we're building what we're building*, and what *winning* looks like.

**Status:** Draft v2 (post-pivot — see DECISIONS.md D-021) · **Date:** 2026-05-26 · **Owner:** Paul

> **For AI agents (Claude Code, etc.):** Load this file for any **product, scope, or
> prioritization** decision — "should we build X now, defer it, or cut it?", "what does this
> screen need to be competitive?", "are we feature-matching or differentiating?". This doc is
> **direction, not law.** It is *subordinate to* `ARCHITECTURE.md` — a strategic bet here may
> argue for pulling a reserved seam forward, but it can never override an Invariant (§3) or an
> ADR without an explicit recorded decision. Pairs with: `ARCHITECTURE.md` (*how* — the stable
> foundation), `UX_SPEC.md` (*what screens*), `BUILD_PLAN.md` (*order*), `DECISIONS.md` (the
> running log of *what we actually did*). When a bet here gets acted on, record the
> implementation in `DECISIONS.md` and reference the bet (`per STRATEGY S-0x`). Re-score §6
> whenever a competitor ships something material or we close a gap.

---

## 1. The bet, in one paragraph

Virn Ops is the **operating system for property operations** — turnover, inspections,
maintenance routing, vendor & tenant onboarding — built on a substrate where **one authored
procedure runs three ways**: as a human checklist, an AI-assisted checklist, or a fully
automated agent run. The same content, the same audit trail, the operator picks the mode
per run. The vertical is locked (property ops, with STR turnover as the concrete first
shape) so the product is deep, not broad. The wedge is **one-procedure-three-modes (S-07)**
— unclaimed white space that none of the four legacy reference comps own and that only
Tango (in capture) is gesturing at. The unfair advantage is **agent-native by construction
(S-01)** — our strict org-scoping, append-only audit, definition/execution split, stable
field keys, and clean oRPC procedure layer are *exactly* what a safe, auditable agent
action surface needs; incumbents would have to retrofit it. The long-term moat — a
platform of process-shaped products via packs (ServiceNow-shaped) — is preserved as
architecture but is **not the public lead** for the next 12 months. We win one vertical on
an AI-credible substrate, then the pack model repeats the win.

---

## 2. Competitive frame — who we measure ourselves against

The strategic frame is the cohort the **capital and mindshare have moved to**, not the
flat-or-fading category we originally modeled the data shape against. The growth-scorecard
read (SCRATCHPAD 2026-05-26) is the evidence: the four legacy reference products are in
Tier 3–4 (defending or bypassed); the AI-native cohort is in Tier 1 with fresh
mega-rounds and 2–10× growth.

### 2.1 Tier 1 — the strategic frame

| Cohort | Examples | Why they matter to us | Our posture |
|---|---|---|---|
| **AI-powered capture** | **Scribe** ($1.3B, 78K paying orgs, 2× rev YoY); **Tango** ($20M, building toward AI-executable docs); Guidde | Scribe Optimize is the bridge: capture → "what should be automated" → handoff. That's the same bridge our S-07 wedge sits on, but they own the *capture* leg and we own the *execute* leg. | **Partner via import**, not compete head-on. Treat a Tango/Scribe export as a draft `workflow_version` ingress path. |
| **AI-native orchestration** | **n8n** ($2.5B, $40M+ ARR, 10× usage YoY); Gumloop ($70M raised, Benchmark-led); Lindy | Different buyer, different product. Their existence raises the bar for what an "AI-credible" 2026 product *looks like* at launch — not a direct competitor. | **Do not try to be n8n.** Our agent-safe action surface (S-01a — oRPC canonical, MCP wrapper optional) is our seam, scoped to process operations, not a general orchestrator. |
| **In-flow delivery / AI-over-KB** | Guru, Slite, Document360 ("Ask Eddy"), Perfect Wiki | Conversational KB Q&A in Slack/Teams is table stakes for the KB layer. | **S-09 fast-follow** after v1 launch. Reader-KB (S-03) is the data substrate; in-flow delivery is the next layer. |

### 2.2 Tier 2 — vertical competitors (the actual battle for the vertical)

The property-operations vertical is **not dominated by a horizontal SaaS** today. The
relevant comps are:

- **Property-management suites that bolt on operations** (Buildium, AppFolio, Yardi,
  Hostfully, Guesty, OwnerRez). They own the system of record (leases, accounting,
  bookings) but their *process / turnover / inspection* surfaces are thin — typically
  embedded checklists and ticket queues, not authored procedures with snapshot isolation,
  agent execution, or governance. Their strength is the SoR ownership; their weakness is
  that ops is not their first-class product. Virn PM is the parallel SoR play; Virn Ops
  wins on the process/automation half.
- **STR-specific operations tools** (Breezeway, Operto, Properly, Doinn, Turno) — these
  are the closest direct competitors for the *initial concrete shape*. They are vertical
  (turnover + housekeeping) but mostly task-management-shaped, without snapshot
  publishing, the agent surface, the content-object substrate, or our governance depth.
- **Field-service / inspection point tools** (HappyCo, zInspector, jobber) — adjacent;
  inform the inspections expansion.

The wedge against this tier is **"one authored procedure, three execution modes" + KB +
governance** on a substrate that the vertical incumbents can't easily build (they'd be
forking their product) and that the horizontal incumbents don't have (they're staying
generic).

### 2.3 Demoted — data-shape lessons (historical)

The four products Virn was originally modeled against — **Manifestly, Process Street,
SweetProcess, Tallyfy** — taught us the right *data shape* (recurring runs +
role/initiator, unified library + My Work, version-controlled SOPs + acknowledgments,
no-login guests + inline conditionals). That work is preserved in the schema and in our
architecture (the §3 strengths). They are **not** the strategic frame anymore:

- **Process Street** last raised in 2020 ($12M Series A); has repositioned to "Compliance
  Operations Platform" with an AI agent (Cora) to defend.
- **SweetProcess** is a bootstrapped ~$2.8M/13-year lifestyle business — a fine company,
  the opposite of a growth signal.
- **Tallyfy** is bootstrapped / VC-independent with a niche footprint.
- **Manifestly** is a small indie tool in the recurring-checklist niche.

Treat the historical four-product analysis (preserved in SCRATCHPAD 2026-05-26) as a
schema-shape reference, not a positioning anchor. We do not benchmark v1 against them.

---

## 3. Where we already lead

These are real advantages over both the legacy cohort and the Tier-2 vertical incumbents.
Keep them sharp; they are differentiators, not hygiene.

- **Agent-native by construction (the unfair advantage).** Strict org-scoping
  (Invariant #1) + append-only audit (Invariant #6) + definition/execution split
  (Invariant #3) + stable field keys (Invariant #5) + a clean oRPC procedure layer is
  *exactly* the shape a safe, auditable agent action surface needs. We don't *add* AI
  safety; we already *are* it. This is the seam that S-01a (the agent-safe action
  surface — oRPC contract + optional MCP wrapper) lands on, and nothing on the
  competitive board has it cleanly.
- **Immutable publish / snapshot isolation (D-018).** A run is a self-contained
  snapshot of a *published* version; editing a template never perturbs in-flight runs;
  editing a published workflow forks a new draft (resume-or-fork, one open draft per
  workflow). Most incumbents have "version control" but not this snapshot-isolation
  *guarantee*. This is the correctness backbone the whole product can trust — including
  agent execution.
- **One content object across procedure / KB article / training / agent instructions
  (S-08).** Almost every incumbent treats KB articles, runnable checklists, training
  guides, and agent instructions as *separate object types* that need to be kept in
  sync. Our `workflow.type` over the same `workflow_version → section → step → field`
  substrate makes them different *views* of the same content. This is what makes S-07
  (one procedure → three execution modes) tractable for us and hard to retrofit.
- **Two-axis gating (UX_SPEC §2): capability × permission.** Configuration (what the
  org has enabled) and Members & Roles (what a user may reach) are designed to be read
  together, with Admin/Owner as a clean permission superset. More principled than the
  per-feature toggles incumbents bolt on, and the substrate that gates agent
  capabilities cleanly.
- **First-class guests (`participant` model + guest run view + tokenized links).**
  External participants complete only their assigned steps, no account, scoped and
  audited. Critical for property ops (vendors, contractors, owners, guests, inspectors
  are all non-employees).
- **Definition vs. execution split + stable field keys (Invariants #3–#5).** The clean
  separation is what makes packs, cloning, AI-targeted structured authoring, and
  agent-driven step execution all tractable on the same substrate.

---

## 4. Gaps that matter for v1 (ranked)

The pivot promotes most of these from "deferred" to "v1 completeness." A property-ops
buyer in 2026 evaluating against the Tier-1 capture cohort + Tier-2 vertical incumbents
will judge v1 on whether these exist, not on whether they're "on the roadmap."

1. **Agent-safe action surface (S-01a, highest leverage).** Expose the workflow/run
   procedures as a credentialed, audited, capability-gated **oRPC API** that agent
   principals (ADR-006) and sibling-product callers (Virn PM) use through the same
   write path humans do. Ship a thin **MCP wrapper** alongside for MCP-host
   compatibility (not the source of truth — protocol-replaceable). This is *the*
   opening on the competitive board — nobody owns the agent-safe surface cleanly.
   **In v1.**
2. **AI authoring — prompt→workflow + doc→workflow (S-01b/c).** Kill the blank-page
   problem. Our section/step/field/stable-key model is ideally shaped for an LLM to emit
   as structured output. **In v1.**
3. **Auto-capture authoring via partnership (S-01d).** Import a Tango/Scribe export as
   a draft `workflow_version`. Cheapest, fastest way to close the capture gap without
   building screen-recording ourselves. **In v1.**
4. **Reader-facing knowledge base (S-03).** The data is modeled; the
   read/search/acknowledge surface is missing. Without it the SOP/policy story is
   half-built. Mostly UI over existing data. **In v1.**
5. **Data Sets — minimal subset (S-02).** Promote `data_set` reference lists +
   `lookup` field type from "Batch 7 deferred" to v1 fast-follow. This is the
   multiplier that makes conditions/variables/auto-fill genuinely useful. Full
   `data_set_record` + multi-field schemas can wait; the minimal "org reference lists"
   subset cannot. **In v1.**
6. **One procedure → three execution modes (S-07) — the wedge surface.** Run launch
   gets a mode selector ("checklist / AI-assisted / automated"); assignee model extends
   to include `agent`; the run UI surfaces which steps an agent will handle. **In v1**
   — this is the headline product story, not a roadmap item.
7. **Operator surfaces (My Work, Run view, Guest run view).** Previously
   `[DESIGNED · build deferred]`. Vertical-first means execution surfaces are
   launch-critical, not v1.1. **In v1.**
8. **Lightweight monitor / run-summary (S-06).** "All runs of one workflow" + saved
   views over `run`/`run_step`. Monitoring is half the value of running processes.
   Thin version in v1; full Reports later. **In v1 (thin).**
9. **Compliance/evidence surface (S-10).** The data is already there
   (`audit_log`, `version_approval`, `acknowledgment`, `next_review_at`). A surfaced
   evidence-pack view turns the foundation into a buying trigger. Thin layer in v1
   alongside the audit log. **In v1 (thin).**
10. **Rich step content (verify).** Incumbents embed video / images / tables / links in
    step instructions. Confirm the builder's step description supports rich content,
    not only plain text. Required for property-ops procedures (checklists with photos /
    diagrams). **In v1.**

**Deferred to v1.1+ (deliberately):**

- **In-flow delivery — Slack/Teams Q&A over KB (S-09).** Right after v1 launch. Reader-KB
  (S-03) is the prerequisite; the data substrate ships in v1.
- **Pack marketplace, third-party publishing.** Pack mechanism is built (single first-party
  pack, the property-ops pack); marketplace is post-v1. The platform-of-products moat
  matures *after* the vertical win.
- **Full BPM-tier approval engine.** v1 ships approvals; a generalized cross-domain
  approval engine waits.
- **iPaaS hub / integration breadth.** Outbound webhooks + Inngest are acceptable for v1
  in a vertical context (property-ops integrations are a known finite set:
  Hostfully/Guesty/Airbnb/VRBO/Stripe/Twilio etc.). The 1000-app hub is later.
- **White-label / custom domains.** Premium tier, post-v1 (BRANDING.md).

---

## 5. Strategic bets

ADR-lite format. Each bet: **Bet · Why · Build implication · Status.** Supersede rather
than delete; reference from implementation decisions. Status uses the v2 vocabulary
(`v1` / `v1.1` / `post-v1` / `reserved` / `superseded`).

### S-01 — Agent-native first, generation-capable second

- **Bet.** Don't merely bolt on an "AI generate" button (table stakes). Make Virn the
  property-ops platform that **AI agents can safely *drive*** — draft a workflow, launch a
  run, complete a step, all through the same org-scoped, audited procedure surface a human
  uses. Then add the table-stakes generation on top.
- **Why.** Strict org-scoping + append-only audit + clean oRPC layer = *exactly* what a
  safe agent action surface needs, and incumbents would have to retrofit it. This is the
  single biggest unclaimed wedge on the competitive board. Combined with S-07, it becomes
  the product story.
- **Protocol posture (load-bearing).** The architectural bet is the **agent-safe action
  surface itself** (credentialed, audited, capability-gated, same write path as humans),
  **not any single wire protocol.** oRPC is the canonical contract — every caller
  (humans, guests, agent principals from ADR-006, sibling product Virn PM, custom
  integrations) writes through it. An **MCP wrapper** ships on top as a *good-citizen
  alternative* for agent hosts that prefer the MCP protocol (Claude Desktop, MCP-native
  agents). If MCP fizzles as an ecosystem, the wrapper goes and the surface is intact;
  if MCP wins, Virn is standards-compliant. **Don't anchor the architecture to MCP-the-
  protocol — anchor it to the concept.**
- **Build implication.**
  - **(a) Agent-safe action surface** exposing workflow/run procedures via oRPC, with
    agent-principal authentication (ADR-006), capability × permission gating, and every
    action landing in `audit_log` with `actorKind='agent'`. The same procedures the
    human UI calls. **A thin MCP wrapper over these procedures ships alongside** for
    MCP-host compatibility — wrapper, not source of truth.
  - **(b) prompt→workflow generation** producing real draft `workflow_version`s through
    the existing builder API (not a parallel path).
  - **(c) doc→workflow import** for plain text / Markdown / PDFs → draft workflow.
  - **(d) Tango/Scribe export import** as a third generation path — partner, don't build.
  - Reserve `step.type = ai` for "a step an agent completes," gated like any capability.
- **Status:** **v1.** All four sub-bets ship in v1. Sequence within v1: (a) action
  surface + agent actor first (unlocks the wedge for S-07; MCP wrapper is fast-follow
  within the same phase if cheap); (b) prompt→workflow second (kills blank-page
  friction); (c)/(d) import paths third.

### S-02 — Data Sets minimal subset in v1

- **Bet.** Ship a minimal `data_set` + `lookup` field type in v1 — org reference lists
  (property list, vendor list, room types, common SKUs) that conditions, variables, and
  auto-fill can target. Full multi-field `data_set_record` builders wait.
- **Why.** Compounds every automation feature already built. Property-ops procedures
  *need* this — turnover SOPs reference the property, the vendor, the booking; without
  reusable data, every workflow re-types the same information. Process Street's recent
  trajectory is the broader evidence.
- **Build implication.** The schema seam is reserved (`data_set`, `data_set_field`,
  `data_set_record`, `lookup` field type — `ARCHITECTURE.md` §5, `BUILD_PLAN.md` Batch 7).
  Promote Batch 7 to a v1 phase. Wire `lookup` fields and variable references into the
  builder + run engine.
- **Status:** **v1.** Minimal subset only — full data-set builder is post-v1.

### S-03 — Reader-facing knowledge base surface

- **Bet.** Add a read/search/acknowledge surface for document & policy content, distinct
  from the builder-facing Library.
- **Why.** We already model the data; the missing piece is the *employee* (or *vendor*,
  or *guest*) experience — searchable KB, mark-as-read/acknowledge, feedback. Mostly UI
  over existing data, and it's what converts the governance investment into realized
  value. Critical for property ops (housekeeping SOPs, vendor policies, owner
  agreements all need reader surfaces).
- **Build implication.** A read-mode surface keyed off `workflow.type ∈ {document, policy}`
  + `visibility`, with search, `acknowledgment` capture, and `suggestion` feedback. Folds
  into the operator/understand nav. Substrate for S-09 (in-flow delivery, post-v1).
- **Status:** **v1.**

### S-04 — Vertical-first: property ops, locked

- **Bet.** Property operations is the v1 vertical. Concrete first shape: STR turnover &
  housekeeping. Concentric expansion within the vertical (inspections → maintenance
  routing → vendor/tenant/owner onboarding) before the pack-marketplace step.
- **Why.** ARCHITECTURE §1's "ambitious model, narrow first build" principle was always
  correct; the pivot tightens it from *narrow* to *locked*. Property ops is unclaimed by
  horizontal incumbents and underserved by the SoR suites (Buildium/AppFolio/Guesty/etc.).
  Paul's PropTech background is the unfair advantage in this specific vertical. Ties
  directly into Virn PM as the SoR sibling.
- **Build implication.** Prioritize end-to-end completeness *within* property ops over
  breadth across verticals. The pack mechanism (ADR-001) is built and ships as the
  property-ops pack — that proves the mechanism with one real pack. Other verticals
  become a packaging exercise post-v1, not a v1 scope expansion.
- **Status:** **v1 — locked, no longer open.** Supersedes ARCHITECTURE §9 open question
  on "first Ops vertical."

### S-05 — Keep the foundation advantages sharp

- **Bet.** Treat the §3 strengths as features to protect and market, not plumbing to take
  for granted.
- **Why.** Snapshot isolation, two-axis gating, the guest model, the content-object
  model, and the agent-safe substrate are genuine differentiators. Erosion (e.g., a
  "quick fix" that mutates a published version, or a gate that leaks an admin-only
  affordance, or a feature that spawns a parallel content object) silently gives up
  the lead.
- **Build implication.** The structural regression tests guarding these (admin-gate
  lexical asserts, publish-to-launch acceptance test, single-content-object guardrails)
  are strategic assets — keep them green. No new content-object table without an ADR.
- **Status:** **Active principle.**

### S-06 — Lightweight monitor surface in v1

- **Bet.** A minimal "all runs of one workflow" view + a small saved-view of My-Work-style
  lists, in v1.
- **Why.** Monitoring is half the value of running processes. A vertical with great
  authoring but no "how are my runs doing?" view feels half-built — and a property
  manager / agency lead's primary need is the bird's-eye.
- **Build implication.** Mostly read-only aggregation over `run` / `run_step` status
  (the H6 aggregation pattern already exists). Doesn't need the full analytics stack.
  Full Reports is post-v1.
- **Status:** **v1 (thin).**

### S-07 — One procedure, three execution modes — the headline wedge

- **Bet.** Treat each published workflow as having three execution modes — (a) human
  checklist, (b) AI-assisted checklist where an agent does some steps and hands off
  others, (c) fully automated run — all driven by *the same authored procedure*. The
  procedure is the bridge between humans and AI agents. **This is the product story** —
  not "we have AI features," but "you author once, you run three ways."
- **Why.** Every direct comp documents SOPs for humans; only Tango (in capture) is
  building SOPs that an agent can execute. The biggest unclaimed wedge on the
  competitive board, and our KB-plus-automation substrate (S-08 single-content-object)
  is exactly what makes one-procedure-three-modes tractable. Distinct from S-01: S-01
  is about *agents driving the platform* (the action surface + generation); S-07 is
  about *the same content being executable at different levels of AI assistance*. They
  compound — S-01a's action surface (oRPC + MCP wrapper) is *how* the agent fulfills
  its assigned step in mode (b) or (c).
- **Build implication.** Extend the assignee model to include an agent assignee —
  shape locked by **ARCHITECTURE.md ADR-006** (org-scoped `agent` table + per-run
  `participant.kind=agent` binding; `run_step_assignee` unchanged); implementation
  specifics in **DECISIONS.md D-022**. Run launch gets a mode selector. `step.type=ai`
  (reserved) is the third mode's primitive. The definition/execution split
  (Invariants #2–#5) means no schema fork — the variation is in *execution*, not
  authoring. UI shows clearly which steps an agent will do and where the
  human-handoff points are.
- **Status:** **v1 — the headline.** Reframes and extends S-01. Together they are the
  product story. Schema foundation locked (ADR-006 / D-022) before Phase 8 lands.

### S-08 — KB / procedure / training / agent instructions as views of one content object

- **Bet.** Preserve and widen the single-content-object architecture. The runnable
  procedure, the KB article (read mode — S-03), the trainee guide, and the agent
  instructions are different *views* of the same `workflow_version`, not separate
  object types that need to be kept in sync.
- **Why.** Partially already realized (`workflow.type` over shared section/step/field
  substrate). The forward bet is to *keep* widening it — every new surface must be a
  renderer, not a parallel table. Almost every incumbent treats KB / SOP / checklist as
  separate objects; that's the gap that's hard to retrofit and easy for us to lose if a
  single feature spawns a parallel content type. Edit the procedure once, every
  surface updates.
- **Build implication.** Design new surfaces as views over `workflow_version` +
  `field_value`. If a feature seems to need a parallel content type, that's a flag —
  usually a discriminator (`workflow.type`) or a render mode covers it. Companion
  structural guardrail: no new content-object table without an ADR.
- **Status:** **Active principle, v1 guardrail.**

### S-09 — In-flow delivery (Slack/Teams) — post-v1 fast-follow

- **Bet.** Surface the right procedure / SOP / answer at the *moment of need* — in
  Slack, in the tool the user is already in — rather than relying on users to navigate
  into Virn and search.
- **Why.** Every winning KB-adjacent tool has moved to a delivery model. Our governance
  and KB investment is wasted if employees still have to know where to look. Combines
  naturally with S-01a's action surface — the same procedure exposure that drives agent
  actions can also answer questions about itself.
- **Build implication.** Slack/Teams app reading from the same `workflow` corpus, scoped
  by org membership. Search-and-answer surface over `workflow_version` content with
  cited answers. Notification triggers when a step's pre-conditions become true in
  connected systems. No new schema — surface work over existing data.
- **Status:** **post-v1 fast-follow.** First release after v1 launch.

### S-10 — Compliance and audit as a buying trigger (positioning)

- **Bet.** Treat "proof it got done" — append-only audit, sign-off, policy enforcement,
  evidence packs, scheduled re-attestation — as a *commercial* wedge, not just a §3
  hygiene strength. For property ops specifically, this is highly relevant (vendor
  insurance attestations, owner-required inspections, regulatory housekeeping records,
  STR municipal compliance).
- **Why.** Process Street has repositioned around exactly this and is charging
  accordingly (~$18k/yr Pro). That's a market signal that compliance ops is where
  the budget is. Our `audit_log`, `version_approval`, `acknowledgment`, `next_review_at`
  data is *already* the foundation.
- **Build implication.** A surfaced audit/evidence view per workflow, per run, per
  acknowledgment. A "compliance pack" capability flag enabling reviewer roles,
  mandatory sign-off, evidence retention, scheduled re-attestation — sits in the
  existing capability × permission gating (§3). No new schema required for the v1
  surface.
- **Status:** **v1 (thin surface).** Property-ops-specific compliance flavors (STR
  municipal records, vendor insurance) layer on top post-v1.

### S-11 — Long-term platform moat preserved as architecture, not v1 product surface

- **Bet.** The packs / multi-vertical / platform-of-process-products architecture
  (ADR-001, ADR-002, ADR-005) is preserved verbatim. It is **not** the v1 public story.
  Win property ops first; the pack model repeats the win post-v1 (marketing ops,
  compliance SOPs, agency client ops, HR ops, etc., each as a pack).
- **Why.** "Ambitious model, narrow first build" was the principle; the pivot tightens
  it to "narrow build that proves the model." Leading with platform language now
  invites comparison against incumbents we don't need to compete with (we'd lose the
  vertical buyer's attention) and dilutes the product story (vertical-first +
  one-procedure-three-modes). The moat compounds *after* the vertical win.
- **Build implication.** Ship the property-ops pack as the *only* pack in v1.
  Pack-install machinery is built (ADR-001) but a marketplace, third-party publishing,
  and cross-pack composition are post-v1. Resist the "let's also do marketing ops as
  a second pack to prove the model" urge in v1 — one vertical, deeply.
- **Status:** **v1 = single pack (property ops). Marketplace post-v1.**

---

## 6. Competitive scorecard (living — re-score over time)

The scorecard frames the gap between our current state and what a property-ops buyer
in 2026 will judge against. Tier 1 (the strategic frame) and Tier 2 (vertical
competitors) are scored; the demoted legacy four are not scored here — see SCRATCHPAD
2026-05-26 for the historical analysis.

Legend — competitor columns: ○ absent · ● basic/partial · ●● solid · ●●● signature
strength. Virn column: **Ahead** · **In v1** (architected + building) · **v1.1+** ·
**Reserved** (seam exists, post-v1) · **Gap** (not addressed).

### 6.1 Capture / generation / agent capabilities (Tier 1 strategic frame)

| Capability | Scribe | Tango | n8n | **Virn status** |
|---|---|---|---|---|
| Auto-capture authoring (screen-recording → SOP) | ●●● | ●●● | ○ | **v1 via import (S-01d) — partner, not build** |
| AI prompt→workflow generation | ●● | ●● | ●● | **v1 — S-01b** |
| AI doc→workflow import | ●● | ● | ● | **v1 — S-01c** |
| Agent-driven step execution | ○ | ● (gesturing) | ●●● (their core) | **v1 — S-01a + S-07 (our wedge)** |
| Agent-safe action surface (credentialed, audited, capability-gated; oRPC + optional MCP wrapper) | ○ | ○ | ● | **Ahead — S-01a (our opening)** |
| One procedure → human/AI/automated modes | ○ | ● (gesturing) | ○ | **Ahead — S-07 (our wedge)** |
| "What should we automate" intelligence | ●●● (Optimize) | ● | ○ | **post-v1 — derives from S-01a + run analytics** |

### 6.2 Process / KB / governance capabilities (vs. vertical Tier 2 + relevant horizontals)

| Capability | STR vertical tools¹ | PM suites² | **Virn status** |
|---|---|---|---|
| Recurring scheduling | ●● | ●● | **In v1** |
| Role / initiator assignment | ●● | ● | **In v1** |
| Unified My Work inbox | ●● | ● | **In v1** |
| Guest / external participants (no login) | ●● | ● | **Ahead** (first-class participant model) |
| Inline conditions + stop-tasks | ● | ● | **In v1** |
| One library over content types | ● | ○ | **In v1** |
| Versioned publish / snapshot isolation | ○ | ○ | **Ahead** (D-018) |
| Two-axis capability × permission gating | ○ | ○ | **Ahead** |
| Reader-facing knowledge base | ● | ● | **In v1 — S-03** |
| Governance: approve / sign-off / review / acknowledge | ● | ● | **In v1** (data model + thin UI) |
| Compliance / audit positioning | ● | ●● | **In v1 (thin) — S-10** |
| Data Sets / reusable data | ● | ●● (SoR has this) | **In v1 (minimal) — S-02** |
| Workflow chaining | ● | ○ | **In v1** (`run_workflow` action) |
| Lightweight monitor / run summary | ●● | ●● | **In v1 (thin) — S-06** |
| Document linking (procedure→policy) | ○ | ○ | **post-v1 (minor)** |
| Rich step content (media) | ●● | ● | **In v1 — verify** |
| In-flow delivery (Slack/Teams) | ○ | ○ | **v1.1 — S-09** |
| Integration breadth (vertical-relevant) | ●●● (Hostfully/Guesty/Airbnb/Stripe) | ●●● (own integrations) | **In v1 (vertical-targeted: webhooks + Inngest + Hostfully/Guesty/Airbnb/Stripe/Twilio)** |
| Platform-of-products (long-term moat) | ○ | ○ | **Architecture preserved (S-11); not v1 surface** |

¹ Breezeway, Operto, Properly, Doinn, Turno. Dots are a rough current read.
² Hostfully, Guesty, OwnerRez, Buildium, AppFolio. Their ops surface only — they win on SoR ownership which is Virn PM's lane, not Ops's.

Dots are a rough current read, not precise benchmarks — re-verify against the live
products before treating any cell as fact.

---

## 7. How to use and refine this document

- **It's a decision aid, not a backlog.** The scorecard is a *map*, not a to-do list. We
  win by being *deeply better at property ops on an AI-credible substrate*, not by
  checking every cell.
- **Cadence.** Re-read at the start of each build phase; re-score §6 whenever (a) we
  close a gap, or (b) a Tier-1 or Tier-2 competitor ships something material. A
  15-minute quarterly pass keeps it honest.
- **Relationship to `DECISIONS.md`.** This doc holds *direction and rationale*; when a
  bet is acted on, the implementation is recorded in `DECISIONS.md` referencing the bet
  ("per STRATEGY S-02"). Strategy says *why and what-wins*; DECISIONS says *we did it,
  and how*. The pivot itself is **D-021**.
- **Precedence.** Subordinate to `ARCHITECTURE.md`. A bet may propose promoting a
  reserved seam; it may not contradict an Invariant or ADR. If it seems to, that's a
  flag to surface, not to act on.
- **Supersede, don't delete.** Bets evolve like decisions — add new ones, mark old ones
  superseded with a pointer, so the reasoning trail survives. The pre-pivot version of
  this doc lives in git history.
- **Guard against AI-feature theater.** S-01's value is the *agent-native, audited
  action surface*, not a chat box. S-07's value is the *one-procedure-three-modes*
  substrate, not a "powered by AI" badge. Resist shipping "AI" that bypasses the
  gating, audit, or snapshot guarantees that are our actual advantage (§3, S-05).
- **Guard against scope-creep back to platform-lead.** S-11 — the long-term moat is
  preserved as architecture, *not* as v1 surface. If a feature proposal frames itself
  as "let's also do marketing ops to prove the platform model," push back: that's a
  post-v1 conversation. v1 is property ops, deeply.

---

## 8. Open strategic questions

- **AI sequencing within v1.** The agent-safe action surface (S-01a — oRPC API +
  agent principal + audit) and prompt→workflow (S-01b) both ship in v1 — which first?
  They share the builder API; either order works. Working assumption: **action
  surface first** because it unlocks the S-07 wedge (agent assignees in run mode
  (b)/(c)) and is the unfair-advantage moat; prompt→workflow is table-stakes
  generation that any competitor can match. The MCP wrapper is a fast-follow within
  the same phase if cheap, or split out if it complicates the oRPC build.
- **Data Sets minimal-subset boundary.** "Org reference lists" is the agreed shape —
  what's the precise schema cut? Working assumption: `data_set` (named list) +
  `data_set_record` (one record per row, with a single `label` + optional `value` JSON)
  + `lookup` field type that references a `data_set`. Multi-field records and the
  full builder are post-v1.
- **Compliance flavor for property ops.** v1 ships the generic thin compliance surface
  (S-10). Which property-ops-specific flavors come in v1.1 first — STR municipal
  records? Vendor insurance attestations? Owner-required inspections? Decide based on
  early-customer pull.
- **KB surface ownership.** Does the reader-facing KB (S-03) live in Ops, or is it a
  shared foundation surface that Virn PM also consumes (per the product-family model,
  `BRANDING.md`)? Working assumption: Ops first, refactor to shared foundation if
  Virn PM needs it.
- **In-flow delivery (S-09) timing within v1.1.** Slack first, Teams second, or both
  together? Decide based on first-cohort customer mix.
- **Pricing/packaging signal.** Capabilities are already the shared unit of config +
  entitlement (ADR-005) — when does the competitive picture demand turning that into
  actual plan tiers? Working assumption: a single property-ops plan in v1, tiering
  post-v1 once usage shape is real.
- **Vertical expansion order post-v1.** Property ops *concentric* expansion (inspections,
  maintenance, onboarding) before any second-vertical pack. Open: which adjacent
  vertical first when packs do start, and who drives that — customer pull or
  cold-strategic choice?

---

## Appendix A — Pre-pivot reference set (historical, for data-shape lessons only)

Preserved for the architectural lessons embedded in our schema. **Not the strategic
frame.** See DECISIONS.md D-021 for why these were demoted. Full historical
analysis: SCRATCHPAD.md 2026-05-26 "Four-app competitive read."

| Product | Data-shape lesson taken | Status |
|---|---|---|
| **Manifestly** | Recurring runs — scheduling + role/initiator + workflow chaining + unified inbox | Schema captures it; not strategically relevant |
| **Process Street** | Unified library + My Work; Data Sets pattern; conditional logic depth; Preview as sandbox | Schema captures it; not strategically relevant |
| **SweetProcess** | SOP/policy governance — version control, approve→sign-off, acknowledgments, review cadence | Schema captures it; not strategically relevant |
| **Tallyfy** | No-login guest model + inline conditions + assignee model | Schema captures it; not strategically relevant |

These products taught us *what data and operations a generic ops platform needs to
express*. The pivot's recognition is that the data-shape lessons are necessary but not
sufficient — the *strategic* frame is the AI-native cohort + the vertical competitors
(§2). Future ARCHITECTURE.md / schema edits may still consult this appendix for
data-shape questions; future STRATEGY edits should not anchor to it.
