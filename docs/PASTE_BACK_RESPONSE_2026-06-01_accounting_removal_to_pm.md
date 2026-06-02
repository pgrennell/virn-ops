# Paste-back response to virn-pm — accounting-removal pivot (D-PM-001)

**Direction:** virn-ops → virn-pm
**Date drafted:** 2026-06-01
**Author:** virn-ops session, Paul Grennell
**Inbound briefing this responds to:** `docs/PM_PASTE_BACK_2026-06-01_accounting_removal_to_ops.md` (PM D-PM-001)
**Purpose:** Confirm Ops corrected its stale "Accounting M4" gate references; answer §3.1
(Trustline agent-principal identity); acknowledge §3.2 / §3.3 for the record. No Ops-side
architectural divergence — all three cross-repo shapes PM flagged as unchanged stay unchanged.

> **How PM should use this file.** This is Ops's point-in-time response. The live Ops-side state
> is `DECISIONS.md` **D-047..D-050** (new dated heading `2026-06-01 — PM accounting-removal pivot
> (D-PM-001): Trustline split + cross-repo answers`). If PM wants a symmetric record, mirror
> D-047..D-050 under a dated heading on the PM side per the cross-repo mirror convention.

---

## §1 — Confirmation: stale "Accounting M4" references corrected (PM §2 / §5.1)

**Done.** Ops processed D-PM-001 in a single documents-only commit. Per the append-only
convention, every stale reference was corrected **in place** with a
`> Correction added 2026-06-01 (per PM D-PM-001)` blockquote that preserves the original line:

| Ops file | Reference corrected |
|---|---|
| `PM_PASTE_BACK_RESPONSE_2026-05-27_doc_coordination.md` | "Build remains gated on Accounting M4 per §K" — the exact line PM quoted |
| `PM_PASTE_BACK_RESPONSE_2026-05-27_stakeholder_stack.md` | sequencing table row 15 ("all after Accounting M4"); §6 wedge note ("v1 wedge is per-property P&L (Accounting M4)"); §8 build gate ("until Accounting M4 lands") |
| `PM_PASTE_BACK_2026-05-27_doc_coordination.md` (inbound PM record) | "PM's wedge (Accounting M4)" — noted as preserved-as-received |

Each correction re-points the dependency to **"PM's operational financial layer (per-property/unit
P&L) shipping"** and notes that PM's GL / chart of accounts now lives in **Trustline**. The
substance of the dependency is unchanged — the wedge still exists; it is simply no longer an
"accounting milestone." Recorded in Ops **DECISIONS.md D-047**.

No BUILD_PLAN.md gate referenced Accounting M4, so nothing there required correction.

## §2 — Answer to §3.1: Trustline agent-principal identity

**Confirmed — PM-side only. Ops mints no `agent` row for Trustline in v1.**

PM's assumption is correct. Per Ops's D-022 / ARCHITECTURE.md ADR-006, the org-scoped `agent`
table is the home for *trusted sibling-product callers* — and a sibling earns an Ops-side identity
precisely (and only) when it **authenticates to Ops's action surface** (launches runs, reads Ops
data over oRPC or the MCP wrapper). In the model you describe — *Trustline reads PM; Ops
untouched* — Trustline never calls Ops, so an Ops-side credential would be unused attack surface
and a credential to rotate for no behavioral gain.

**Trigger to revisit (recorded in D-048):** if Trustline ever needs to call Ops *directly* —
e.g. a trust-accounting exception that dispatches an operational remediation run, or Trustline
reading Ops run-cost data rather than receiving it via PM — Ops mints an Ops-side `agent` row for
Trustline exactly as D-022 prescribes (org-scoped, `credentialHash`, `actorKind='agent'`,
capability grants). That is a **config action, not a schema change** — the Phase 8 agent schema
already supports N sibling callers. Until that trigger fires, Trustline is invisible to Ops.

The hub model (PM↔Ops *and* PM↔Trustline; ADR-006 + the paste-back protocol generalizing to N
partners) is accepted as-is.

## §3 — Acknowledgements for the record (no commitment requested)

### §3.2 — Work-order-cost / financial-attribution field keys (Ops D-049)

Acknowledged; **no change to the kickoff field-key vocabulary now.** Two notes for the record:

- The D-029 launch payload carries inbound PM context *into* a run; **cost data flows the other
  direction** — back to PM via the `run.completed` webhook (D-025). So the natural home for
  cost-attribution fields is the run-completion callback, not the kickoff snapshot.
- The widening is **additive and cheap** when PM's attribution contract firms up (expected: a cost
  amount + cost category alongside the property / unit / owner keys PM's P&L already uses). It
  extends the field-key vocabulary, not the `run` schema — the `run.entity_type` / `entity_id`
  pattern (D-043) absorbs new context without a migration on `run`.

**Ask back to PM:** when you've settled the concrete work-order-cost attribution field set, send it
and Ops will widen the callback (and, if needed, kickoff) vocabulary to round-trip it and mirror
the addition in D-029's documented payload shape. Not v1-blocking either side.

### §3.3 — Shared-sign-in / white-label trigger re-evaluation (Ops D-050)

Acknowledged; **no pull-forward today.** D-031 (shared sign-in) and D-032 (white-label) remain
roadmap commitments. A third sibling raises the ceiling on both the two-account-UX cost and the
white-label surface, but doesn't trip either trigger on its own — Trustline has no
customer-facing UX surface that sits alongside Ops/PM yet (in the §2 model it reads PM and is
invisible to Ops). Re-evaluate when Trustline reaches a customer-touched surface; any change gets
**mirrored across all BRANDING.md copies** (PM + Ops, and Trustline when it has one) per the
D-031 / D-032 convention. No BRANDING.md edit in this loop.

## §4 — Cross-repo mapping

| PM | Ops |
|---|---|
| D-PM-001 — remove deep accounting → Trustline | D-047 — record split + in-place `> Correction` notes on "Accounting M4" gates |
| §3.1 — Trustline agent-principal slot | D-048 — **PM-side only**; no Ops `agent` row in v1; trigger recorded |
| §3.2 — work-order-cost field-key vocabulary | D-049 — deferred pending PM's concrete field set; callback is the home, additive when it lands |
| §3.3 — D-031/D-032 trigger re-evaluation | D-050 — acknowledged; no pull-forward today |

## §5 — What Ops needs back from PM

1. **Nothing blocking.** This loop closes Ops's obligations from D-PM-001.
2. **When ready (§3.2):** the concrete work-order-cost attribution field set, so Ops widens the
   run-completion callback vocabulary to round-trip cost data into PM's P&L.
3. **Optional:** mirror Ops D-047..D-050 under a dated PM-side DECISIONS heading, per the
   cross-repo mirror convention.

## §6 — Files produced / changed this loop (Ops side)

- `docs/DECISIONS.md` — new dated entry, D-047..D-050.
- `docs/PM_PASTE_BACK_RESPONSE_2026-05-27_doc_coordination.md`,
  `docs/PM_PASTE_BACK_RESPONSE_2026-05-27_stakeholder_stack.md`,
  `docs/PM_PASTE_BACK_2026-05-27_doc_coordination.md` — in-place `> Correction` notes.
- `docs/PASTE_BACK_RESPONSE_2026-06-01_accounting_removal_to_pm.md` — this file.

No code or schema changes. The sibling architecture, D-024 mutual-standalone, and the
`runs.launch` + HMAC-webhook integration are untouched.
