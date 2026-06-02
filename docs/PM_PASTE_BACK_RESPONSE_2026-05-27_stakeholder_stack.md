# PM paste-back response — Stakeholder Stack PRD review

**Direction:** virn-pm → virn-ops
**Date received:** 2026-05-27
**Author:** virn-pm session, Paul Grennell
**Outbound brief this responds to:** [PM_PASTE_BACK_2026-05-27_stakeholder_stack.md](PM_PASTE_BACK_2026-05-27_stakeholder_stack.md)
**Live decisions arising from this paste-back:** [DECISIONS.md](DECISIONS.md) D-035 through D-038, dated 2026-05-27.

> **Snapshot artifact.** This file is a point-in-time copy of PM's response, preserved
> for deliberative-chain forensics (why D-035..D-038 came out the way they did,
> what payload shapes were proposed before final wording, which assumptions PM was
> about to commit to). It is **not live spec.** Refer to `DECISIONS.md` D-035..D-038
> for current state — those entries supersede anything below where they conflict.

---

## 1. The three PRDs (one paragraph each)

### PRD-1 — Stakeholder Portal Engine (`docs/PRD_STAKEHOLDER_PORTAL_ENGINE.md`)

**Positioning.** One Portal Engine substrate, three per-relationship-type configurations (Tenant,
Vendor, Owner). PM accepts Ops's recommendation against three separate portal products. The
engine owns auth, branded theming (read from `branding_settings` per PM DECISIONS.md §M day-one),
the document storage primitive, the in-portal messaging primitive, invitations + access tokens,
audit attribution with a new `portalContext` column, and notification preferences. Configurations
own module sets, data-source bindings, role-specific copy, and permission scope. Ops integration
touchpoints are the existing PM DECISIONS.md §H (`runs.launch`) for tenant intake and the
existing webhook surface (D-025 catalog) for status updates — **no new Ops events required for
the engine itself**, but Vendor / Owner portals want to render Ops's tokenized-guest pages as
in-portal items (see §4.1 sanity-check). One auth surface across all three portal kinds; a single
user can hold tenant + vendor + owner contexts across different orgs.

### PRD-2 — Scoped Stakeholder Inbox (`docs/PRD_SCOPED_STAKEHOLDER_INBOX.md`)

**Positioning.** PM-user-facing filtered view of portfolio data — distinct from the external
Portals. The architectural commitment is a JSON-shaped scoping rule engine, not a hardcoded set
of inbox products. v1 ships with property manager (baseline), asset manager, portfolio manager,
and leasing broker default saved views. Saved views are org-scoped data, shareable with the org
or with explicit users. Authorization is applied first; scope rules narrow, never widen. Reads
from existing `activity_events` + `pending_approvals` + `service_requests` + `work_orders` +
notifications — no new storage required. The existing PM BACKLOG entry "Saved views (named filter
combinations)" is consumed by this PRD. **No new Ops events required** — Ops-originated rows flow
in via the existing D-025 catalog with `crossProductOrigin='virn-ops'` already in place per §F2.

### PRD-3 — Unified Inbox (`docs/PRD_UNIFIED_INBOX.md`)

**Positioning.** Single polymorphic `communication_message` primitive with entity threading
(`entityType ∈ {property, tenant, vendor, work_order, lease}`) — mirrors Ops's polymorphic
discriminator pattern. Channel adapters (email, SMS, portal messages from PRD-1, internal notes,
vendor comms) write into the shared row shape; the inbox UI reads from one place. v1 inbound
routing leans on **explicit reply-to tagging** + a sender-email matching heuristic, with
unrouted messages surfacing for staff triage. No AI routing in v1. Per-entity full-text search
across channels is the highest-leverage v1 feature. **One additive cross-repo agreement
proposed** (see §3.1) — a new `run.comment_added` webhook event from Ops to surface run-comment
threads under PM work_order entities. The PRD is designed so v1 ships **without** that event;
it's an enrichment, not a blocker.

---

## 2. Architectural calls made (key decisions)

| # | Call | Per Ops's recommendation? |
|---|---|---|
| 1 | One Portal Engine with three configurations (vs. three portal products) | ✅ Accepted |
| 2 | Day-one branding/theming via `branding_settings` resolver (not a follow-up) | ✅ Accepted |
| 3 | One auth surface across all three portal kinds; per-user multi-portal-context membership | ✅ Accepted |
| 4 | Shared document storage primitive; per-config visibility, not per-config storage | ✅ Accepted |
| 5 | One scoping rule engine, not five hardcoded inbox products | ✅ Accepted |
| 6 | Scope rules as JSON; v1 supports flat AND composition; OR / boolean composition deferred | PM-judgment (Ops did not specify) |
| 7 | Saved views are org-scoped data, sharable; consume PM BACKLOG "Saved views" entry | ✅ Accepted |
| 8 | One polymorphic `communication_message` primitive with `entityType` discriminator | ✅ Accepted |
| 9 | Explicit reply-to tagging for inbound email routing in v1; no AI routing | ✅ Accepted |
| 10 | Per-entity scoped search in v1; no cross-entity search | ✅ Accepted |
| 11 | Internal team chat (Slack/Teams) stays out of Unified Inbox | ✅ Accepted |
| 12 | Internal notes default visibility = all-staff; manager-only deferred | PM-judgment |
| 13 | `readByUserIds` array column in v1; promote to a `message_read_state` table at scale | PM-judgment |
| 14 | Unified Inbox v1 ships without Ops run-comment events; enriches when §3.1 lands | ✅ Accepted (additive design) |
| 15 | Sequencing: Portal Engine → Unified Inbox → Scoped Inbox; all after Accounting M4 | ✅ Accepted |

> Correction added 2026-06-01 (per PM D-PM-001): "after Accounting M4" → "after PM's operational
> financial layer (per-property/unit P&L) ships." PM removed deep accounting (GL / chart of
> accounts / M1–M4) into the new sibling product **Trustline**; the per-property P&L wedge these
> three PRDs sequence behind still exists, just not as an accounting milestone. See Ops
> DECISIONS.md D-047.

**No decisions taken against Ops's recommendations.** Where PM exercised judgment beyond the
brief (rows marked PM-judgment), the calls are flagged but not divergent.

---

## 3. Cross-repo decisions emerging — candidate D-034+ entries

These are the **new** cross-repo agreements that surface from the three PRDs. PM is opening each
for Ops's response before either side commits. None are v1-blocking for PM; all are enrichments.

### 3.1 Add `run.comment_added` to the D-025 webhook catalog

**Proposed event:** Ops emits a webhook to PM when a comment is added to a run that PM launched
(i.e. when `pmCallback.pmServiceRequestId` was set on the original `runs.launch` payload per
PM DECISIONS.md §H).

**Payload shape (proposed):** see `PRD_UNIFIED_INBOX.md` §7.2 for the full proposal — fields are
`runId, commentId, authorPrincipalKind, authorDisplayName, body, bodyFormat, attachmentUrls,
isInternal, parentCommentId, createdAt, pmCallback.{pmServiceRequestId, pmWorkOrderId}`.

**Why both sides want this:** PM's Unified Inbox surfaces run-comment threads under the
work_order entity for the user. Ops gets a tighter v1 integration acceptance test — the worked
example in PM DECISIONS.md §A becomes richer (vendor comment on an Ops run surfaces in PM staff's
Unified Inbox without an additional tab-hop).

**Why deferrable:** PM ships Unified Inbox v1 without it. Email + SMS + Portal + Internal Notes
+ Vendor email cover the v1 channel set. Adding this later is purely additive.

**Ops-side action requested:** confirm willingness in principle + suggested timing relative to
Ops's own roadmap. Schema / payload can be finalized in a follow-up exchange.

### 3.2 Add `run.step_state_changed` to the D-025 webhook catalog (lower priority)

**Proposed event:** Ops emits a webhook when a run advances from one step to the next, including
the new current-step identity. PM's Tenant Portal wants this to render "we're at Step 3 of 5" on
an active maintenance request; the Unified Inbox uses it less directly.

**Why deferrable:** All current PM surfaces work fine with the existing `run.state_changed`
catalog event (which fires on run-level state changes, not step-level). Step-level visibility is
a UX nicety, not a v1 requirement.

**Ops-side action requested:** no commitment needed today. Logged here so it's in the cross-repo
record if it ever pulls forward.

### 3.3 Render-or-link convention for Ops tokenized-guest pages from PM portals

**Proposed agreement.** Where PM's Vendor or Owner portals want to surface an Ops-driven workflow
step that a guest is authorized for (a vendor accepting a work order via a tokenized link, an
owner approving via the same), PM needs to decide between two patterns:

- **(a) Embed.** Ops's tokenized page supports `?embed=true` with theme parameters; PM iframes it
  into the portal context. Pro: single auth context for the user. Con: cross-product iframe
  permission, CSP, branding.
- **(b) Link out + return.** PM links the user out to Ops's tokenized page; Ops's page has a
  "return to portal" button hitting a PM-supplied return URL. Pro: simpler cross-origin story.
  Con: two-context UX.

**Why both sides want this.** Without an agreed convention, PM either ships portals with a
"click here to manage in Ops" button (which is a real UX cliff) or PM duplicates Ops's
tokenized-page surface (which fights mutual-standalone). The cleanest answer is a small protocol
both sides honor.

**Ops-side action requested:** weigh in on (a) vs (b). PM leans toward **(b) link out + return**
for v1 — simpler cross-origin, lower coordination cost. Embed becomes a v2 enrichment when shared
sign-in (PM DECISIONS.md §L) lands. Ops's preference would lock the convention.

---

## 4. Assumptions about Ops behavior — sanity-check needed

These are claims PM's PRDs implicitly assume about how Ops works. PM has not read the Ops
codebase. Before PM commits to any of the PRDs, the listed assumptions need a quick verification
from someone who has.

### 4.1 Ops's tokenized-guest pages are reachable from a fresh browser session

Assumption: a vendor or owner clicking a tokenized link from a PM portal arrives at Ops without
needing to be logged into Ops first. The token authorizes the page. PM portals plan to render
those links as in-portal items per PRD-1 §4.2 / §4.3.

If false: PM has to choose between (i) waiting for shared sign-in (§L) or (ii) routing the
stakeholder through an awkward sign-up flow.

### 4.2 D-025 catalog events fire reliably with at-least-once delivery semantics

Assumption: PM's webhook receiver (§E) can de-dup via the event's stable id + idempotency on
write. PM's PRDs (especially the Scoped Inbox) assume Ops delivers state transitions exactly
once OR with stable event ids that PM can de-dup against.

If exactly-once isn't guaranteed: PM needs an idempotency key column on the inbound webhook
log; cheap to add but should be confirmed now.

### 4.3 `run.state_changed` payload carries enough metadata for Scoped Inbox filtering

Assumption: the payload includes `runId`, `workflowSlug`, `previousState`, `currentState`,
`severity` (or equivalent priority/category), and the original `pmCallback.pmServiceRequestId`
echoed back. PRD-2's scope rule dimensions (entity type + severity + originator) rely on this.

If the payload is thinner than assumed: PM either adds an extra Ops API lookup per webhook (live
query — adds latency + reliability dependency) or asks Ops to enrich the payload (cheaper).

### 4.4 Vendor sync uses the agreed PM DECISIONS.md §G surface (no creep)

Assumption: PM's existing §G locks the vendor sync surface, and Ops will not extend it
unilaterally (e.g. starting to sync `serviceCategories` before PM's controlled-vocabulary
promotion lands per §G2). PRD-1's Vendor Portal assumes the vendor surface is stable.

If Ops has plans to extend the sync surface: surface it in the §3 paste-back loop before PM
ships the Vendor Portal.

### 4.5 Ops's `runs.launch` Action API accepts the payload shape in PM DECISIONS.md §H

Assumption: §H's payload (workflowSlug + mode + participant + kickoff + callback) is the
contract Ops's Action API actually exposes. The Tenant Portal in PRD-1 §4.1 calls it.

If §H drifted on the Ops side: PM needs to update its outbound client (per BACKLOG "Virn Ops
integration: outbound credentials + webhook receiver + first AI agent") to the actual shape
before the Tenant Portal ships.

---

## 5. Where PM went against the Ops recommendation

**Nothing material.** All three of Ops's load-bearing architectural recommendations (one Portal
Engine, one scoping rule engine, one polymorphic `communication_message` primitive) are
accepted as-is.

PM exercised judgment in places Ops did not specify (e.g. scope rule expressivity flat-AND-only
in v1; internal-note visibility defaults; read-state column vs table at scale). None of those
are divergent from the brief — they're choices the brief explicitly left open.

---

## 6. Sequencing — relative to PM's wedge

Ops's paste-back recommended ordering: Portal Engine → Unified Inbox → Scoped Inbox. PM accepts
that relative ordering across the three.

**Important context for Ops's planning.** All three PRDs are **post-wedge** on PM's side. PM's
v1 wedge is per-property P&L (Accounting M4), per PM DECISIONS.md §K. The three Stakeholder
Stack PRDs ship after that wedge, alongside the BACKLOG "Virn Ops integration" bundle (outbound
credentials + webhook receiver + first AI agent — the Service Request Router).

> Correction added 2026-06-01 (per PM D-PM-001): the v1 wedge is now PM's **operational
> financial layer (per-property/unit P&L)**, not "Accounting M4." PM removed the deep-accounting
> milestones M1–M4 (GL / chart of accounts) into the sibling product **Trustline**; the
> operational P&L these PRDs ship behind is retained. See Ops DECISIONS.md D-047.

Practically: Ops can plan §3.1 (`run.comment_added`) for "any time before the Unified Inbox v2
that surfaces it," and §3.2 / §3.3 for whenever fits Ops's roadmap. None are gating PM v1.

---

## 7. Files produced

- `virn-pm/docs/PRD_STAKEHOLDER_PORTAL_ENGINE.md`
- `virn-pm/docs/PRD_SCOPED_STAKEHOLDER_INBOX.md`
- `virn-pm/docs/PRD_UNIFIED_INBOX.md`
- `virn-pm/docs/PASTE_BACK_STAKEHOLDER_STACK_TO_OPS.md` (this file's PM-side source)

---

## 8. Next loop

PM is waiting on:

1. Ops's response on §3.1 (`run.comment_added` event) — willingness in principle + rough timing.
2. Ops's response on §3.3 (tokenized-page render convention — embed vs link-out).
3. Verification of §4.1–§4.5 assumptions against the actual Ops codebase.

PM will not start build on any of the three PRDs until **Accounting M4 lands**. The conversation
on cross-repo agreements above can happen at any time before then — earlier is better, because

> Correction added 2026-06-01 (per PM D-PM-001): read "Accounting M4 lands" as **"PM's
> operational financial layer (per-property/unit P&L) ships."** Deep accounting (GL / M1–M4) moved
> to the sibling product **Trustline**; the operational P&L gate this references still holds. See
> Ops DECISIONS.md D-047.
the BACKLOG "Virn Ops integration: outbound credentials + webhook receiver" bundle codifies the
inbound webhook receiver shape, and §3.1 lands naturally if accepted before that bundle ships.
