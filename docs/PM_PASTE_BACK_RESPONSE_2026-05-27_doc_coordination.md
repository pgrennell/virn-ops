# PM paste-back response — Stakeholder Stack doc cleanup loop

**Direction:** virn-pm → virn-ops
**Date received:** 2026-05-27
**Author:** virn-pm session, Paul Grennell
**Outbound brief this responds to:** [PM_PASTE_BACK_2026-05-27_doc_coordination.md](PM_PASTE_BACK_2026-05-27_doc_coordination.md)
**Status when filed:** Loop closed — no new architectural calls, no Ops-side
DECISIONS.md entry required.

> **Snapshot artifact.** This file is a point-in-time copy of PM's response,
> preserved for deliberation-chain forensics. It is **not live spec.** Two minor
> items surfaced (see §3.2 open question and §5 process suggestion below); both
> are absorbed without Ops-side action:
>
> - **§3.2 open question — kickoff field-key slugs.** PM lists the candidate set
>   `property_name`, `unit_label`, `photo_r2_keys`, etc. These already match
>   the vocabulary locked in Ops's DECISIONS.md "2026-05-27 — Cross-repo
>   decisions from virn-pm session" entry under the Phase 17 (property-ops pack)
>   seed Consequences block: `property_name`, `property_address`, `unit_label`,
>   `tenant_display_name`, `lease_id`, `access_instructions`,
>   `request_description`, `severity`, `photo_r2_keys`. No reconciliation
>   needed.
> - **§5 process suggestion — mapping table at the bottom of any cross-repo
>   entry with multiple new decisions.** Adopted as mutual practice going
>   forward. No retrospective edit applied to existing entries.
>
> Refer to `DECISIONS.md` D-035..D-038 for live cross-repo state from the
> Stakeholder Stack loop, and the "2026-05-27 — Cross-repo decisions from
> virn-pm session" entry for the corrected `runs.launch` shape PM is mirroring
> on its side.

---

## Paste-back to virn-ops — Stakeholder Stack doc cleanup loop response

**Direction:** virn-pm → virn-ops
**Date drafted:** 2026-05-27
**Author:** virn-pm session, Paul Grennell
**Inbound briefing:** virn-ops paste-back "Stakeholder Stack doc coordination follow-up" dated
2026-05-27
**Purpose:** Confirm doc cleanup items landed on PM's side + PM's call on the catalog
version-stamp question. Short — no new product asks, no architectural divergence.

---

## §3 — PM-side doc actions: status

### 3.1 Mirror D-035..D-038 into PM's DECISIONS.md — **done**

Added a new dated entry "2026-05-27 — Stakeholder Stack doc cleanup loop: mirror of Ops
D-035..D-038 + correction to §H" in [DECISIONS.md](../DECISIONS.md). Subsections §A–§D
mirror Ops D-035–D-038 respectively; §E records PM's call on the catalog version-stamp
question; §F holds the corrected `runs.launch` shape. A "Cross-repo mapping" table at the
end of the entry maps PM § → Ops D-### for unambiguous reference.

### 3.2 Correct D-029 in PM's DECISIONS.md — **done**

Approach: append-only-respecting correction. Two changes:

- **In-place note at the top of §H** of the prior "2026-05-27 — Virn Ops integration pivot"
  entry: a single `> Correction added 2026-05-27 (per Ops D-038)` blockquote stating the
  code block + `callback.pmServiceRequestId` paragraph below are superseded and pointing
  readers to §F of the new entry for the corrected shape. The original §H reasoning trail
  (the snapshot principle + ARCHITECTURE Invariant #4 rationale) is preserved verbatim.
- **§F of the new doc-cleanup entry** carries the full corrected payload code block, the
  property-ops kickoff field-key vocabulary table (with PM's structured fields mapped to
  Ops's slug names: `propertyName → property_name`, `unitLabel → unit_label`,
  `photoR2Keys → photo_r2_keys`, etc.), the interim webhook-correlation pattern (PM
  resolves via `runId` + `external_identifiers` until Ops Phase 11 ships `callback`), and
  a `roleAssignments[]` note flagging exact key naming as Ops-defined.

**Open question for Ops:** §F lists the proposed kickoff field-key slugs. If Ops Phase 17
seed locks them to different names, ping back and PM appends a reconciliation entry. Until
Phase 17 lands the vocabulary, PM treats this list as the candidate set.

### 3.3 Update BACKLOG "Virn Ops integration: outbound credentials..." — **done**

Added a "Cross-repo notes (added 2026-05-27 doc cleanup loop)" block to the entry in
[BACKLOG.md](../BACKLOG.md). Captures four build-time requirements:

- Outbound `runs.launch` client targets the corrected shape from §F, not the §H block.
- `callback` block deferred to Ops Phase 11; PM correlates via `runId` + `external_identifiers`.
- Inbound webhook receiver de-duplicates idempotently on `(eventId, organizationId)`.
- Tokenized-page render UX = link-out with `?returnUrl=`; PM-domain hostnames go into Ops's
  allowlist during outbound-credential bootstrap.

### 3.4 BRANDING.md mirrors D-031/D-032 — **verified, no edit needed**

PM's [BRANDING.md](BRANDING.md) already carries:

- **"Shared sign-in (roadmap)"** section with the (a) shared-auth-store / (b) OAuth-
  federation alternatives, trigger framing, and the explicit "Roadmap commitment, not a
  'maybe someday' item" language. Matches D-031.
- **"White-label / custom domains (roadmap)"** section with the full PM-stronger-than-Ops
  scope (Virn PM staff app + owner portal + tenant portal + outbound email + generated
  PDFs), the explicit comparison ("PM is white-label-stronger than Ops"), the build
  shape (`organization_domain` table + hostname-resolution middleware + `branding_settings`
  group + cert provisioning + Resend verified-domains + PDF template theming), and the
  trigger. Matches D-032 with the asymmetric-scope framing.

No BRANDING.md edits applied this loop.

### 3.5 BACKLOG vendors.serviceCategories carries D-028 trigger — **verified, no edit needed**

The existing [BACKLOG.md](../BACKLOG.md) entry "Service-category display normalization +
controlled vocabulary" already lists "vendor cross-product sync with Virn Ops" as a
trigger, with the explicit gating language: *"Ops's `vendor_category` is a slug-driven
controlled vocabulary, so PM's free-text shape doesn't sync correctly until promoted to
(b)."* The Scope section also calls out *"the controlled-vocab slugs need to match Ops's
`vendor_category` slugs for sync to compose."* D-028's trigger is recorded.

---

## §4 — Catalog version-stamp convention: **drop**

PM concurs with Ops's recommendation of option (b) drop. Recorded in §E of the new
doc-cleanup entry. The D-### entries on Ops's side and the §-numbered cross-repo
subsections on PM's side, kept in sync by the mutual paste-back loops, already serve as
the catalog version history; a separate `catalog-version: <date>.<n>` stamp adds
maintenance work without changing what's recorded.

---

## §5 — PM-internal items that surfaced during the cleanup

One small note worth flagging to Ops, since it touches the cross-repo doc shape going
forward:

**Numbering scheme divergence is fine, but the mapping table helps.** Ops uses D-###
serially; PM uses §-letters scoped within dated entries. The new doc-cleanup entry adds a
"Cross-repo mapping" table at the end mapping PM §A..§F → Ops D-035..D-038. Recommend
both sides include a mapping table at the bottom of any future cross-repo entry that
introduces multiple new decisions — costs nothing, eliminates the "which §B?" ambiguity
when two dated entries on the same day each have their own §B.

Beyond that, nothing PM-internal surfaced.

---

## Files produced this loop

- [DECISIONS.md](../DECISIONS.md) — new entry "2026-05-27 — Stakeholder Stack doc cleanup
  loop: mirror of Ops D-035..D-038 + correction to §H" + an inline correction note on §H of
  the prior pivot entry.
- [BACKLOG.md](../BACKLOG.md) — cross-repo notes block added to "Virn Ops integration:
  outbound credentials + webhook receiver + first AI agent" entry.
- [docs/PASTE_BACK_DOC_CLEANUP_TO_OPS.md](PASTE_BACK_DOC_CLEANUP_TO_OPS.md) — this file.

No code or schema changes shipped from this loop. Build remains gated on Accounting M4 per
§K of the original pivot entry.
