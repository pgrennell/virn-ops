# STRATEGY.md

Competitive positioning and strategic bets for **Virn Ops** — the *why we're building what
we're building*, and what *winning* looks like against the established players in this category.

**Status:** Draft v1 · **Date:** 2026-05-26 · **Owner:** Paul

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

Virn Ops is not competing as *a workflow app* — it's a **platform of process-products** (the
ServiceNow model: process verticals are packs + configuration, not forks; ERP-shaped products
like Virn PM are separate apps on the shared foundation). That is the long-term moat, and **no
incumbent in this category has it.** But the moat only pays off *after* one vertical is genuinely
better than running it in the incumbent tools. Our **structural foundation is ahead of the field**
(immutable publish/snapshot, two-axis capability × permission gating, first-class guests). Our
**exposure is that the market has moved to AI-native authoring and heavy data-reuse**, and both of
those currently sit in our *reserved / deferred* column. The strategy: keep the narrow-first
discipline, win one vertical on its own terms, and **don't let the two market-moving capabilities
(AI, Data Sets) stay deferred long enough that the first vertical ships feeling a generation
behind.**

---

## 2. The reference set — what we take from each, and why

We synthesize the best of four products into one coherent IA (`UX_SPEC.md` §1). This is the
current read on each (re-verify when they ship; see §6 for the live scorecard).

| Product | Their signature strength | What Virn takes | Virn status |
|---|---|---|---|
| **Manifestly** | Recurring runs — scheduling, role/initiator assignment, bird's-eye summary, workflow chaining, unified inbox | The recurring engine + role-based recurring assignment | **On track** (schedule + Inngest + `workflowRole.isInitiator`); summary view is a gap |
| **Process Street** | Unified library + My Work; **Data Sets**; deep conditional logic; **Process AI** | The library/My-Work pattern; the automation engine | **On track** on IA; **gap** on Data Sets + AI |
| **SweetProcess** | SOP/policy governance — version control, approve→sign-off, searchable knowledge base, policy→procedure linking | The governance lifecycle (approve/sign-off/review/suggest) | **On track** on data model; **gap** on the reader-facing KB + doc linking |
| **Tallyfy** | Process builder + automation; **no-login guest access**; AI templates / assign-to-AI / BYO-AI | The no-flowchart inline-logic builder; the guest model | **On par / ahead** on guests; **gap** on AI |

**Reading the table:** structurally we capture all four. The clustering of "gap" cells around
**AI** and **Data Sets** is the signal — those are the two places the category has moved that we
have architected for but not built.

---

## 3. Where we already lead

These are real advantages over the incumbent set. Keep them sharp; they are differentiators, not
hygiene.

- **Immutable publish / snapshot isolation (`DECISIONS.md` D-018).** A run is a self-contained
  snapshot of a *published* version; editing a template never perturbs in-flight runs; editing a
  published workflow forks a new draft (resume-or-fork, one open draft per workflow). Most
  incumbents have "version control" but not this snapshot-isolation *guarantee*. This is the
  correctness backbone the whole product can trust.
- **Two-axis gating (`UX_SPEC.md` §2): capability × permission.** Configuration (what the org has
  enabled) and Members & Roles (what a user may reach) are designed to be read together, with
  Admin/Owner as a clean permission superset. More principled than the per-feature toggles the
  incumbents bolt on.
- **First-class guests (`participant` model + guest run view + tokenized links).** On par with
  Tallyfy's signature capability — external participants complete only their assigned steps, no
  account, scoped and audited.
- **Definition vs. execution split + stable field keys (Invariants #3–#5).** The clean separation
  is what makes packs, cloning, and AI-targeted structured authoring tractable later.
- **Append-only audit + strict org-scoping.** Beyond compliance value, this is the foundation that
  makes an *agent action surface* safe (see S-01).

---

## 4. The gaps that matter (ranked)

1. **AI authoring + an agent action surface (highest leverage).** Every reference product now
   drafts workflows/SOPs from a prompt and imports existing docs into structured workflows. We
   have the seam (`ai/` module, reserved `step.type = ai`) but no shipped AI authoring, AI steps,
   or document import. See **S-01**.
2. **Data Sets (deferred — should be fast-follow).** Store data once, reference it as variables /
   auto-fill / conditional inputs across workflows. Reserved (`data_set`, `data_set_field`,
   `data_set_record`, `lookup` field type — `ARCHITECTURE.md` §5, `BUILD_PLAN.md` Batch 7) but
   deferred. It is the multiplier that makes the automation engine actually valuable. See **S-02**.
3. **Reader-facing knowledge base.** We model the governance data (document/policy types,
   visibility, approvals, acknowledgments, review cadence) but the Library is *builder*-facing.
   The employee who searches, reads, and acknowledges an SOP — SweetProcess's core value — has no
   surface yet. See **S-03**.
4. **Run-summary / reporting view.** Manifestly's bird's-eye "all runs of one workflow" and
   Process Street's saved views are the *manager/monitoring* surface. Reports is deferred
   (`UX_SPEC.md` §3, §9). Monitoring is half the value of running processes. See **S-06**.
5. **Document relationships (minor).** `workflow.type` is a flat discriminator; there is no
   procedure→policy linking (SweetProcess's three-tier hierarchy). Lower priority, but it's what
   turns a pile of documents into a navigable knowledge system.
6. **Rich step content (verify).** Incumbents embed video / images / tables / links in step
   instructions ("a document of *how*", not just *what*). Confirm the builder's step description
   supports rich content, not only plain text.
7. **Integration breadth (known, MVP-acceptable).** Incumbents lean on Zapier/Make (400–1000+
   apps). We have outbound webhooks + Inngest; the iPaaS hub is reserved. Acceptable for the first
   vertical; a roadmap item, not a launch blocker.

---

## 5. Strategic bets

ADR-lite format, mirroring `DECISIONS.md`. Each bet: **Bet · Why · Build implication · Status.**
Supersede rather than delete; reference from implementation decisions.

### S-01 — Win the AI question by being *agent-native first*, generation-capable second

- **Bet.** Don't merely bolt on an "AI generate" button (table stakes everyone has). Make Virn the
  process platform that **AI agents can safely *drive*** — draft a workflow, launch a run, complete
  a step, all through the same org-scoped, audited procedure surface a human uses. Then add the
  table-stakes generation on top.
- **Why.** Our strict org-scoping, append-only audit, and clean oRPC procedure layer are *exactly*
  what a safe, auditable agent action surface needs — and they're things the incumbents would have
  to retrofit. Manifestly is explicitly betting on "be good for the agents teams already run";
  Tallyfy gestures at it with "bring your own AI." Nobody owns it cleanly. We can. And the
  section/step/field/stable-key model is ideally shaped for an LLM to emit as structured output.
- **Build implication.** (a) Expose the workflow/run procedures as an **MCP server** so agent
  actions are first-class and land in `audit_log` like any other actor. (b) Add prompt→workflow
  generation and doc→workflow import that produce real draft `workflow_version`s through the
  existing builder API (not a parallel path). (c) Reserve `step.type = ai` for "a step an agent
  completes," gated like any capability.
- **Status.** Seam exists (`ai/` module, reserved enum). Not built. **Decision needed on
  sequencing** — likely after the first vertical's core loop, but it should not be the *last* thing.

### S-02 — Pull Data Sets forward from "deferred" to "fast-follow"

- **Bet.** Promote Data Sets to the first thing built after the first vertical's authoring/run loop
  is complete, ahead of its current Batch-7 deferral.
- **Why.** It compounds everything already being built — conditions, merge variables, field
  auto-fill all become dramatically more useful once data can be stored once and referenced
  everywhere. Process Street's recent trajectory is the evidence: Data Sets + conditional logic +
  AI is their current value story.
- **Build implication.** The schema seam is reserved; the `lookup` field type is reserved. Promote
  to a planned phase; wire `lookup` fields and variable references into the builder + run engine.
- **Status.** Reserved, deferred. Proposed for promotion.

### S-03 — Specify and build a reader-facing knowledge base surface

- **Bet.** Add a read/search/acknowledge surface for document & policy content, distinct from the
  builder-facing Library.
- **Why.** We already model the data; the missing piece is the *employee* experience SweetProcess
  is built around (searchable KB, categories, mark-as-read/acknowledge, feedback). It's mostly UI
  over existing data and it's what converts the governance investment into realized value.
- **Build implication.** A read-mode surface keyed off `workflow.type ∈ {document, policy}` +
  `visibility`, with search, `acknowledgment` capture, and `suggestion` feedback. Folds into the
  operator/understand nav, not the build nav.
- **Status.** Not specified. Candidate for the next UX_SPEC addition.

### S-04 — Narrow-first: win one vertical before leaning on the platform

- **Bet.** Resist building the meta-platform (packs marketplace, generic object builder) until one
  process-shaped vertical — STR turnover & housekeeping is the natural first — is genuinely better
  than running it in Process Street / Manifestly.
- **Why.** The packs model is the moat, but `ARCHITECTURE.md` §1's own principle ("ambitious model,
  narrow first build") is correct. None of the four reference products are platforms; we don't beat
  them by being a more abstract platform, we beat them by being a better *product* for one job —
  *then* the packs model repeats that win cheaply.
- **Build implication.** Prioritize completeness of the first vertical's end-to-end experience
  (authoring → run → monitor → govern) over breadth of the platform machinery.
- **Status.** Active principle. Guards against scope creep.

### S-05 — Keep the foundation advantages sharp

- **Bet.** Treat the §3 strengths as features to protect and market, not plumbing to take for
  granted.
- **Why.** Snapshot isolation, two-axis gating, and the guest model are genuine differentiators.
  Erosion (e.g., a "quick fix" that mutates a published version, or a gate that leaks an
  admin-only affordance) silently gives up the lead.
- **Build implication.** The structural regression tests guarding these (e.g., the admin-gate
  lexical asserts, the publish-to-launch acceptance test) are strategic assets — keep them green.
- **Status.** Active.

### S-06 — Ship a lightweight monitoring surface early

- **Bet.** A minimal run-summary / "all runs of one workflow" + a small saved-view of My-Work-style
  lists, ahead of the full Reports build.
- **Why.** Monitoring is half the value of running processes (Manifestly's bird's-eye view, PS's
  saved views). A first vertical with great authoring but no "how are my runs doing?" view feels
  half-built.
- **Build implication.** Mostly read-only aggregation over `run` / `run_step` status (the H6
  aggregation pattern already exists). Doesn't need the full analytics stack.
- **Status.** Reports deferred; a thin version is proposed sooner.

---

## 6. Competitive scorecard (living — re-score over time)

Legend — competitor columns: ○ absent · ● basic/partial · ●● solid · ●●● signature
strength (a 0–3 read per product, per capability). Virn column uses words: **Ahead** (we
lead) · **On track** (architected + building/built) · **Reserved** (seam exists, deferred) ·
**Gap** (not addressed). Re-score when we close a gap or a competitor ships.

| Capability | Manifestly | Process St. | SweetProcess | Tallyfy | **Virn status** |
|---|---|---|---|---|---|
| Recurring scheduling | ●●● | ●● | ● | ●● | **On track** |
| Role / initiator assignment | ●●● | ●● | ●● | ●●● | **On track** |
| Unified My Work inbox | ●●● | ●●● | ●● | ●● | **On track** |
| Guest / external participants | ●● | ●● | ● | ●●● | **Ahead** (par w/ Tallyfy) |
| Inline conditions + stop-tasks | ●● | ●●● | ● | ●● | **On track** |
| One library over content types | ●● | ●●● | ●●● | ●● | **On track** |
| Versioned publish / snapshot isolation | ●● | ●● | ●● | ●● | **Ahead** (D-018) |
| Two-axis capability × permission gating | ● | ● | ● | ● | **Ahead** |
| Preview as sandbox / view-as-role | ○ | ●●● | ○ | ○ | **On track** (validated by PS) |
| Governance: approve / sign-off / review | ● | ●● | ●●● | ●● | **On track** (data) / surface gap |
| Workflow chaining | ●●● | ●● | ● | ●● | **Reserved** (`run_workflow` action) |
| **Data Sets / reusable data** | ○ | ●●● | ○ | ○ | **Reserved — S-02** |
| **AI authoring / generation** | ●● | ●●● | ●● | ●●● | **Gap — S-01** |
| **AI / agent action surface** | ●● | ○ | ○ | ●● | **Gap — S-01 (our opening)** |
| **Reader-facing knowledge base** | ● | ●● | ●●● | ● | **Gap — S-03** |
| **Run-summary / reporting** | ●●● | ●●● | ● | ●● | **Gap — S-06** |
| Document linking (policy→procedure) | ○ | ○ | ●●● | ○ | **Gap (minor)** |
| Rich step content (media) | ●● | ●● | ●●● | ●● | **Verify** |
| Integration breadth | ●●● | ●●● | ● | ●●● | **Reserved (iPaaS deferred)** |
| **Platform-of-products / packs** | ○ | ○ | ○ | ○ | **Ahead (structural moat — S-04)** |

Dots are a rough current read, not precise benchmarks — re-verify against the live products before
treating any cell as fact.

---

## 7. How to use and refine this document

- **It's a decision aid, not a backlog.** The scorecard is a *map*, not a to-do list. We do **not**
  win by checking every competitor's box (S-04). Use it to decide what makes the *first vertical*
  competitive and what is genuinely deferrable.
- **Cadence.** Re-read at the start of each build phase; re-score §6 whenever (a) we close a gap, or
  (b) a competitor ships something material. A 15-minute quarterly pass keeps it honest.
- **Relationship to `DECISIONS.md`.** This doc holds *direction and rationale*; when a bet is acted
  on, the implementation is recorded in `DECISIONS.md` referencing the bet (e.g., "per STRATEGY
  S-02"). Strategy says *why and what-wins*; DECISIONS says *we did it, and how*.
- **Precedence.** Subordinate to `ARCHITECTURE.md`. A bet may propose promoting a reserved seam; it
  may not contradict an Invariant or ADR. If it seems to, that's a flag to surface, not to act on.
- **Supersede, don't delete.** Bets (`S-0x`) evolve like decisions — add new ones, mark old ones
  superseded with a pointer, so the reasoning trail survives.
- **Guard against AI-feature theater.** S-01's value is the *agent-native, audited action surface*,
  not a chat box. Resist shipping "AI" that bypasses the gating, audit, or snapshot guarantees that
  are our actual advantage (§3, S-05).

---

## 8. Open strategic questions

- **AI sequencing.** After the first vertical's core loop — but how far after? And: agent surface
  (MCP) first, or generation (prompt→workflow) first? (They share the builder API; either order
  works.)
- **First vertical confirmation.** STR turnover is the working assumption (`ARCHITECTURE.md` §7);
  lock it before the pack-mechanism build so the end-to-end target is concrete.
- **Data Sets depth for v1.** Full `data_set` build, or a minimal "org reference lists" subset that
  unblocks `lookup` fields and auto-fill without the whole feature?
- **KB surface ownership.** Does the reader-facing KB (S-03) live in Ops, or is it a shared
  foundation surface that Virn PM also consumes (per the product-family model, `BRANDING.md`)?
- **Pricing/packaging signal.** Capabilities are already the shared unit of config + entitlement
  (ADR-005) — when does the competitive picture demand turning that into actual plan tiers?
