# Paste-back to virn-pm — doc coordination follow-up (Stakeholder Stack loop)

**Direction:** virn-ops → virn-pm
**Date drafted:** 2026-05-27
**Author:** virn-ops session, Paul Grennell
**Purpose:** Doc-level cleanup follow-up after the 2026-05-27 Stakeholder Stack
paste-back loop closed. No new product asks, no new architectural calls —
just coordinating PM-side doc state to catch up with what now exists on the
Ops side, plus one mutual convention question.

> **How to use this file.** Open a fresh virn-pm session. Paste this entire file
> into the first message. The PM agent has zero context from the virn-ops session
> that produced it.

---

## 1. What just happened (one-paragraph recap)

PM returned three PRD drafts (Stakeholder Portal Engine, Scoped Stakeholder
Inbox, Unified Inbox) on 2026-05-27 along with three candidate cross-repo
decisions (`run.comment_added` event, `run.step_state_changed` event,
tokenized-page render convention) and five assumptions about Ops behavior that
needed verification. Ops responded by adding **D-035..D-038** to its
`docs/DECISIONS.md` under the heading "2026-05-27 — Stakeholder Stack paste-back
response (cross-repo)". PM's response paste-back is mirrored on the Ops side as
`docs/PM_PASTE_BACK_RESPONSE_2026-05-27_stakeholder_stack.md` for deliberation-
chain forensics.

The four new Ops-side decisions in brief:

- **D-035** — `run.comment_added` accepted in principle; lands with the D-025
  emission layer (Phase 11+).
- **D-036** — `run.step_state_changed` not adopted in v1 catalog; logged for
  future.
- **D-037** — tokenized-page render = **link-out + return** (PM's option (b))
  with `?returnUrl=` query param + PM-domain allowlist.
- **D-038** — sanity-check responses to PM's §4.1–§4.5 assumptions; in
  particular **§4.5 found drift between the real `runs.launch` signature and
  D-029 as PM wrote it.**

## 2. What's already locked on the Ops side (do not re-litigate)

The PM session should treat the following as fixed:

- **D-035** through **D-038** are committed on Ops's side as written. Architectural
  shape is locked; payload fields and timings have wiggle room as noted in each
  entry's Consequences.
- BRANDING.md on the Ops side has the "Shared sign-in (roadmap)" + asymmetric
  white-label sections per D-031/D-032.
- BUILD_PLAN.md v1.1+ on the Ops side carries the white-label entry per D-032.
- `crossProductOrigin` columns are present on Ops's `audit_log`, `activity_event`,
  and `agent` tables per D-027 (already wired through `runs.launch`).

The PM session should NOT propose changes to any of the above.

## 3. PM-side doc actions needed

These are the doc-state items on PM's side that the Ops session believes are
still open. Each is small; none are blocking PM's wedge (Accounting M4).

> Correction added 2026-06-01 (per PM D-PM-001): this is an inbound PM record, preserved as
> received. For accuracy: PM's wedge is now its **operational financial layer (per-property/unit
> P&L)** — the deep-accounting milestones M1–M4 (GL / chart of accounts) moved to the new sibling
> product **Trustline**. See Ops DECISIONS.md D-047.

### 3.1 Mirror D-035..D-038 into PM's `docs/DECISIONS.md`

The cross-repo mirror convention (recorded in both repos' auto-memory) says any
new cross-repo decisions get mirrored on both sides. Ops has D-035..D-038 today;
PM doesn't yet. Mirror them under a new dated heading on the PM side, following
the same Context/Decision/Rationale/Consequences shape and the same numbering if
PM's existing scheme allows it (or PM's local equivalent).

Source text: see Ops's `docs/DECISIONS.md` under "2026-05-27 — Stakeholder Stack
paste-back response (cross-repo)".

### 3.2 Correct D-029 in PM's `docs/DECISIONS.md` to match the actual `runs.launch` shape

PM's local D-029 §H currently describes the `runs.launch` payload as:

```
{
  workflowSlug: string,
  mode: "manual" | "ai_assisted" | "fully_automated",
  participant: { kind: "vendor", vendorId, vendorContactId },
  kickoff: { propertyName, propertyAddress, ... photoR2Keys: string[] },
  callback: { pmServiceRequestId, webhookEvents: [...] }
}
```

The actual Ops `runs.launch` signature today (per
`packages/api/modules/runs/procedures/launch-run.ts`) accepts:

```
{
  workflowId: string,              // not slug; slug support to come in Phase 11
  workflowVersionId?: string,
  kickoffValues: Record<string, unknown>,   // flat map keyed by field.key
  roleAssignments: RoleAssignment[],         // vendor lives here, not a singular `participant`
  title?: string,
  mode: "human" | "ai_assisted" | "automated",
  agentId?: string | null,
}
```

The `callback` block is **not yet accepted** by the implementation; it's planned
for Phase 11 alongside the webhook emission layer. The structured `kickoff` fields
PM listed (propertyName, propertyAddress, unitLabel, tenantDisplayName, leaseId,
accessInstructions, requestDescription, severity, photoR2Keys) become the
**canonical kickoff field-key vocabulary** for the property-ops vertical — PM
serializes its structured data into `kickoffValues: { property_name: "...",
property_address: "...", ... }` using these keys. Phase 17 (property-ops pack)
seed locks the vocabulary.

Update D-029 in PM's DECISIONS.md to reflect the corrected shape. None of this
changes the underlying agreement — it's shape correction, not architectural shift.

### 3.3 Update PM's BACKLOG entry "Virn Ops integration: outbound credentials + webhook receiver + first AI agent"

Add a short note that the outbound-client work targets the corrected `runs.launch`
shape from §3.2 above, and that `callback` field support requires Phase 11 on the
Ops side to land first. Until then, PM correlates inbound webhooks via `runId`
alone (passable for v1 if the receiver records the mapping at launch time).

### 3.4 Confirm PM's `docs/BRANDING.md` matches D-031/D-032

D-031 and D-032 each had action items calling for matching BRANDING.md updates
on both repos. Ops's BRANDING.md has them today (sections "Shared sign-in
(roadmap)" + "White-label / custom domains (roadmap, premium tier — asymmetric
scope per product)"). Confirm PM's BRANDING.md carries the same sections; if not,
add them. The content should mirror what's recorded under D-031/D-032 in Ops's
DECISIONS.md (Ops-side scope: narrower; PM-side scope: full app + portals + email
+ PDFs).

### 3.5 Confirm PM's BACKLOG entry for `vendors.serviceCategories` controlled-vocabulary promotion carries the D-028 trigger

D-028 noted that PM's BACKLOG entry needed a new trigger ("cross-product sync
requires Ops-slug agreement") added. Confirm that landed; if not, add it. The
gating relationship is: Ops's `vendor_category` lookup table (in place per D-023)
sits ready to accept the shared slug set, but the vendor sync surface can't fully
fire until PM's vocabulary lands.

## 4. Mutual convention question — D-025 catalog version-stamp

D-025 stipulated: "version-stamp the catalog in both DECISIONS.md files." Neither
side has actually added a version stamp. Two options:

- **(a) Adopt the convention.** Each time the v1 webhook event catalog changes,
  bump a `catalog-version: <date>.<n>` line on the entry that defines the change
  and re-record it on both sides. With D-035 having extended the catalog to
  include `run.comment_added`, the first stamp would be `catalog-version:
  2026-05-27.1`.
- **(b) Drop the convention.** Each catalog change is already recorded as its
  own D-### entry on both sides; the version stamp is redundant ceremony.

PM's preference would lock it. Recommendation from the Ops side: **(b) drop** —
the D-### entries themselves already serve as the version history, and the
mirroring convention (§3.1) keeps them in sync.

## 5. What the PM session should return as a paste-back

A short response noting:

- Items §3.1–§3.5 completed (or pushed back on with rationale).
- PM's choice on §4 (catalog version-stamp).
- Anything PM-internal that surfaced while doing the doc updates that Ops should
  know about (rare for doc cleanup, but worth a check).

This is doc cleanup, not a PRD loop — the response can be short.

## 6. Reference

- Today's Ops decisions: `docs/DECISIONS.md` D-035..D-038 (heading
  "2026-05-27 — Stakeholder Stack paste-back response (cross-repo)").
- PM's response paste-back (mirrored on Ops side):
  `docs/PM_PASTE_BACK_RESPONSE_2026-05-27_stakeholder_stack.md`.
- Original outbound brief that started the loop:
  `docs/PM_PASTE_BACK_2026-05-27_stakeholder_stack.md`.
- Prior cross-repo decisions in Ops's DECISIONS.md: D-024 through D-034 under
  the two 2026-05-27 headings.
