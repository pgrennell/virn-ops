# Paste-back for virn-pm — Stakeholder Stack (Portal + Inbox + Unified Inbox)

**Direction:** virn-ops → virn-pm
**Date drafted:** 2026-05-27
**Author:** virn-ops session, Paul Grennell
**Purpose:** Brief a virn-pm Claude Code session, cold, on three PRD prompts derived from a Besty AI competitive read. Expect a paste-back of PM's design decisions / PRD drafts to mirror into Ops's `docs/DECISIONS.md`.

> **How to use this file.** Open a fresh virn-pm session. Paste this entire file into the first message. The PM agent has zero context from the virn-ops session that produced it — everything it needs is here.

---

## 1. Context the PM session needs

A virn-ops session reviewed Besty AI's feature surface (`besty-vs-virn-overlap-map.html`) for patterns worth lifting into the Virn product family. The decision was to keep Ops focused on its current scope (SOP Builder + AI authoring + Reader KB, plus a new **Playbooks** primitive — see Ops's `docs/PRD_PLAYBOOKS.md` for that one) and to route the **three biggest Besty-inspired patterns that don't belong in Ops** to PM:

1. **Stakeholder Portal Engine** — one configurable portal engine, multiple per-relationship configurations (Tenant / Vendor / Owner).
2. **Scoped Stakeholder Inbox** — filtered, role-scoped views of the same portfolio data per relationship (owner sees only their assets, broker sees only their listings, etc.).
3. **Unified Inbox** — channel-agnostic, entity-scoped communication threading (email + SMS + portal messages + Ops run comments + vendor comms, chronological per property/tenant).

These three are **distinct primitives**, not one feature. The temptation to mash them together will be high; the chat that produced this paste-back was explicit that they should be designed as three discrete engines:

- The **Portal Engine** is "what self-service surface does this relationship type get?"
- The **Stakeholder Inbox** is "what filtered slice of portfolio data does this role see?"
- The **Unified Inbox** is "where does the property manager see all the comms on a given property/tenant in one place?"

Resist the urge to collapse them. Stakeholder Inbox ≠ Unified Inbox — first is *filtered view of shared data*; second is *channel aggregation*.

## 2. Rules that already apply (don't relitigate)

The PM session should respect the cross-repo decisions already locked in PM's `docs/DECISIONS.md` 2026-05-27 entry, especially:

- **D-024 — Mutually-standalone.** PM must work with no Ops installed. Any of the three primitives below must function for a standalone-PM customer (small residential PM who never adopts Ops). Where they *can* enrich themselves with Ops data when Ops is present (e.g. work-order status in the Tenant Portal), do so via the existing webhook surface, not via a live Ops API call (per D-033, Ops does not expose a symmetric Action API consumer for PM in v1).
- **D-025 — Webhook event catalog is locked.** `run.state_changed`, `run.completed`, `vendor.upserted` are the only Ops → PM events in v1. If a Stakeholder Portal feature wants more (e.g. a tenant seeing the *current step* of a maintenance run, not just its overall status), that requires mutual cross-repo agreement first. Don't unilaterally add inbound events.
- **D-026 — Asymmetric storage of cross-product links is fine.** Ops uses typed columns; PM uses `external_identifiers`. Don't propose schema changes on Ops's side.
- **D-027 — `actorKind` + `crossProductOrigin`** attribution columns are already in place on both sides. Inbox + Portal writes from PM that touch Ops via webhook should set `crossProductOrigin='virn-pm'`.
- **D-028 — Vendor sync surface.** What's synced is locked. If a Vendor Portal wants to expose Ops-owned fields (vendor capability grants, run-participation history), the Portal reads them from Ops via webhook subscription, not live API.
- **D-032 — White-label scope.** PM's scope is the full app + portals + email + PDFs. The Portal Engine should design with this in mind from day one — branding/theming primitives are PM's surface, not Ops's.
- **D-033 — Ops's Action API is the v1 cross-product interface; PM does not ship a symmetric Action API in v1.** Don't propose one as part of the Portal/Inbox work. The trigger for a symmetric Action API is a concrete bidirectional-live-query use case, which neither portal nor inbox supplies.

## 3. The three PRD prompts

For each, the PM session should produce a draft PRD modeled on PM's existing PRD conventions (or Ops's `docs/PRD_WORKFLOW_SOP_BUILDER.md` shape if PM doesn't have a local convention yet). Write each PRD as a separate file under `docs/` on the PM side.

---

### PRD-1 — Stakeholder Portal Engine

**Architectural call needed at the top of the PRD:** one engine with per-relationship-type configuration vs. three separate portal products. Recommendation from the Ops chat that produced this paste-back: **one engine**, configurable per relationship.

**Pattern lifted from Besty.** Besty's "Guest Portal" handles rental agreements, ID verification, check-in, damage waivers, and digital guidebooks. The *underlying pattern* is per-relationship-type, branded, configurable self-service portals. Once you generalize, this becomes the most important PM building block after the data model itself.

**Per-relationship configurations to support in v1.**

- **Tenant Portal** — lease docs, rent payment, maintenance request submission, document storage, certificate-of-occupancy compliance, in-portal messaging.
- **Vendor Portal** — POs, invoices, COI submission + expiry tracking, work-order acceptance, time/expense logging, document storage.
- **Owner Portal** — statements, distributions, approval workflows, performance reporting, document storage.

**What the engine itself owns (vs. what each configuration owns).**

- **Engine:** authentication, branded theming (per D-032), document storage primitive, in-portal messaging primitive, audit + activity attribution, per-relationship invitation flow + access tokens.
- **Configuration:** module set (which screens/widgets surface for this relationship), data-source bindings, role-specific copy, permission scope.

**Integration with Ops (mutually-standalone).**

- Maintenance request submission in the Tenant Portal creates a PM-side `service_request`. If Ops is linked, PM calls Ops's `runs.launch` with the standard payload (D-029). If Ops is not linked, the service request stays PM-internal.
- Vendor Portal work-order acceptance: same pattern. Work order completion + status updates from Ops arrive via the existing webhook surface; Portal renders them.
- Owner Portal approval flows: PM-internal. If Ops is linked and a workflow run requires owner approval, Ops launches the run with an `owner` participant kind via the existing tokenized-guest path; the Owner Portal can optionally surface those guest links as in-portal items.

**Things to flag to PM that the Ops chat thought were load-bearing.**

1. **Branding/theming as a first-class engine concern, not a follow-up.** D-032 commits PM to white-label scope including portals. Design the Portal Engine assuming custom branding from day one (per-org domain, per-org logo + colors + email-sender identity).
2. **One auth surface across all three portals.** A single tenant who is also a vendor at another property (rare but real) should not need two logins. Same for an owner who is also a tenant of one of their own properties.
3. **Document storage primitive must be shared.** Tenant lease docs, vendor COIs, owner statements all live in the same underlying storage. Per-relationship configurations control visibility, not storage location.

**Out of scope for v1 of the engine.**

- Bring-your-own-domain (deferred per D-032's broader white-label roadmap).
- Native mobile apps (web-responsive only for v1).
- Tenant-to-tenant messaging.
- Public-facing marketing site components.

---

### PRD-2 — Scoped Stakeholder Inbox

**Pattern lifted from Besty.** Besty separates the "Owner Inbox" from the main inbox because owners need a different filtered view of the same property data. The pattern is scoped, context-aware communication threads per stakeholder relationship.

**Why this is its own PRD, not a Portal feature.** The Portal Engine (PRD-1) is the *external-facing* surface for tenants/vendors/owners. The Scoped Inbox is the *internal-facing* surface — a portfolio manager at an owner-investor wants a filtered inbox showing only their assets' issues, approvals pending, financial alerts. This is for PM's own users (property managers, asset managers, leasing brokers, head-of-facilities at corporate tenants) — not for the stakeholders the Portals serve.

**v1 scoped views to support.**

- **Asset manager view** — scoped to one or more assets in a portfolio; surfaces only that portfolio's issues, approvals, financial alerts.
- **Portfolio manager view** — scoped to one or more portfolios; rolled-up view of underlying assets.
- **Leasing broker view** — scoped to listings the broker is authorized on.
- **Property manager view** — the *unfiltered* baseline (their existing inbox).

**The architectural commitment.** One inbox primitive with a **scoping rule engine**. Scoping rules combine:

- Entity-type scope (asset, portfolio, listing, tenant, vendor)
- Entity-id scope (specific IDs the user is authorized on)
- Communication-channel scope (only-approvals, only-financials, all)
- Time scope (recency filter)

Don't build five different inbox products. Build one threaded-comms primitive with a rule-based filter layer on top. The user-visible "view" is a saved combination of those scope rules.

**Integration with Ops.** A scoped inbox view can include Ops-driven items (run state changes, completions, escalations) when Ops is linked. The webhook events Ops already emits (D-025) carry enough context to filter into a scoped view; no new event types needed for v1.

**Things to flag to PM that the Ops chat thought were load-bearing.**

1. **Don't conflate this with the Portal Engine.** The Stakeholder Inbox is *PM-user-facing*; the Portals are *stakeholder-facing*. Two different surfaces, two different data shapes, two different auth models.
2. **The scoping rule engine is the architectural commitment.** Spend design time on the rule shape — it's the part that determines whether "view as asset manager" is a real product or a hardcoded toy.
3. **Saved views should be shareable across users.** A portfolio manager building "all overdue approvals for Class A office assets" should be able to save and share it with their analyst.

**Out of scope for v1.**

- Customizable column layouts per view.
- AI-generated view suggestions ("you keep filtering by X — save this view?").
- External-stakeholder access to PM's inbox (use the Portal Engine instead).

---

### PRD-3 — Unified Inbox (channel-agnostic, entity-scoped threading)

**Pattern lifted from Besty.** Besty pulls OTA + email + SMS + WhatsApp + voice into one threaded surface per listing/guest. The pattern is channel-agnostic, entity-scoped communication threading. The Ops chat that produced this paste-back flagged it as "the single biggest daily-pain reduction in commercial PM" — property managers' single biggest UX complaint is "where did I see that conversation about the HVAC issue?"

**v1 channel set.**

- Email (in + out)
- SMS (in + out)
- Portal messages (from any of the three Portals in PRD-1)
- Work-order comments (from Ops, via webhook)
- Vendor comms (from Vendor Portal in PRD-1, or inbound email tagged to a vendor)
- Internal notes (from PM users; not externally visible)

**v1 channel set — explicit non-includes.**

- Phone calls (no transcription layer in v1 — log call notes as Internal Notes manually).
- WhatsApp (defer; jurisdictional + integration cost).
- Voicemail (same as phone calls).
- Internal team chat (Slack / Teams) — out of scope by design. The Unified Inbox is for *property/tenant/vendor communications*, not for the PM team's internal back-channel. Teams that want to surface property events in Slack/Teams will do so via PM's notification surface, not by ingesting their Slack/Teams workspace into the Unified Inbox.

**v1 entity scopes (each comm is threaded under exactly one):**

- Property / unit
- Tenant
- Vendor
- Work order (Ops-driven, when linked)
- Lease

**The architectural commitment.** A single `communication_message` primitive with a polymorphic `entity_type` + `entity_id` reference (mirrors Ops's `entity_type` discriminator pattern, per D-011 + D-016). Channel-specific adapters write into this single primitive; the inbox UI reads from it.

**Integration with Ops.** Work-order comments from Ops arrive via the existing webhook surface (already in the v1 catalog under `run.state_changed` — comment events would be a *separate* event type that Ops does NOT currently emit). If the Unified Inbox needs run-comment events, that requires a new webhook event added to D-025's catalog by mutual agreement. **Don't ship Unified Inbox v1 assuming run-comment events exist** — design it so they're an additive enhancement.

**Things to flag to PM that the Ops chat thought were load-bearing.**

1. **The unified primitive matters more than the channel adapters.** Channel adapters are conventional integration work; the primitive that lets a property manager see "all comms about Unit 3B" in one chronological thread is the product win.
2. **Inbound channel resolution is the hard part.** When an email arrives, how does it get threaded under a property/tenant/vendor? v1 can lean on explicit reply-to tagging + a simple matching heuristic; v2 can add AI-assisted resolution. Don't try to be clever in v1 — explicit beats clever for inbound routing.
3. **Search across all channels per entity is the highest-leverage feature.** A "find every conversation about the HVAC at Unit 5C in 2026" search is what drives daily adoption.

**Out of scope for v1.**

- Phone / voicemail / WhatsApp (see non-includes above).
- AI auto-tagging of inbound channel resolution.
- Cross-tenant search (search is always scoped to one entity in v1).
- Sentiment analysis / priority scoring.

---

## 4. Sequencing recommendation

If PM agrees with all three PRDs as v1-scoped, the suggested sequencing (from the Ops chat):

1. **PRD-1 (Portal Engine)** first — it's the substrate the other two leverage and the single biggest "is Virn PM a real platform or a toy?" determination.
2. **PRD-3 (Unified Inbox)** second — daily-pain reduction is the stickiest UX win; ships with email + SMS + Portal messages + Internal Notes; Ops work-order comments deferred until D-025 catalog adds a comment event.
3. **PRD-2 (Stakeholder Inbox)** third — depends on portfolio/asset/listing data models being mature in PM; benefits from inbox primitive already existing (some scoped views are just filters over the Unified Inbox data).

## 5. What the PM session should return as a paste-back

After producing the three PRD drafts, return a paste-back to Ops containing:

- One-paragraph summary of each PRD's positioning + key architectural calls made.
- Any **cross-repo decisions** that emerged (new webhook events Ops would need to emit, new shared schema concepts, new auth coordination needs). These become candidate D-034+ entries in Ops's DECISIONS.md.
- Any **assumptions made about Ops behavior** that should be sanity-checked against the actual Ops codebase before PM commits to them.
- A flag on any decision where the PM session went *against* the recommendation in this paste-back (Ops should know if PM rejected "one engine, three configurations" in favor of three separate products, for example).

Ops will mirror cross-repo decisions into its own DECISIONS.md as a new dated block (per the convention in Ops's memory: "if a PM session returns a paste-back block, append it to Ops's DECISIONS.md under a new dated heading, and apply any Ops-side action items in the same commit").

## 6. Out of scope for this paste-back (do not address)

- AI Voice Receptionist — Ops chat concluded "buy / integrate, don't build" (EliseAI + specialists own this lane). Mention as v1.1+ note in PM's BACKLOG if relevant, but no PRD.
- Smartlock / IoT integration — Ops's `automation_rule.triggerType` is reserving an `iot_event` value. PM can do the same on its side without coordination.
- Cleaning / mobile field app — Ops chat concluded this is a future PM PRD (work-order execution + mobile field UX), but separate from the Stakeholder Stack and not load-bearing for the three above. Defer.
- Upselling Engine / Direct Booking Widget / VoIP — skip per Ops chat.
- Autopilot Messaging governance layer — Ops will capture this as an agent-policy gate in v1.1+; no PM coordination needed in v1.

---

## 7. Reference

- Ops's Playbooks PRD (the Ops-side counterpart to this work): `docs/PRD_PLAYBOOKS.md` in virn-ops
- Locked cross-repo decisions: PM's `docs/DECISIONS.md` 2026-05-27 entry (mirrored to Ops's `docs/DECISIONS.md` 2026-05-27 cross-repo block, entries D-024 through D-033)
- Ops's architecture invariants: virn-ops `docs/ARCHITECTURE.md` (cross-product surface, ADR-006 agent principal, ADR-007 vendor primitive)
- Besty competitive read source: virn-ops `docs/besty-vs-virn-overlap-map.html`
