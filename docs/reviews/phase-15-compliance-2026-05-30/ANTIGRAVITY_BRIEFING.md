# Antigravity Briefing — Phase 15 Thin Compliance / Evidence Surface

**Repo:** `c:\Projects\Virn\virn-ops`
**Branch:** `main` (HEAD at the latest commit; everything in scope is pushed)
**Date:** 2026-05-30

## What this is

Phase 15 (S-10, the thin compliance / evidence surface) shipped in one
session as four slices. Slice A adds the `compliance.pack` capability flag
(off by default in all three enablement profiles) + the `/compliance` org-
scoped landing page. Slice B is the audit-log reader query + procedure
(`audit.listForEntity`, polymorphic over the existing entity_type enum).
Slice C adds the per-workflow Audit pill (sibling to the Phase 14 Runs pill,
both adjacent to the existing Author|Read view-switcher — keeping the
"three views of one object" boundary clean per PRD §1.2 / D-039). Slice D
adds `/compliance/acknowledgments` (index) + the single-receipt view with a
printable evidence proof.

Everything compiles, 658 tests green (461 api + 194 saas + 3 auth). No
schema changes — Phase 15 spec is "surface what the data already supports."
The write side (acknowledge action, approve/reject UI, scheduled
re-attestation) lands in Phase 16.

**The load-bearing scenario is A (capability gate honesty).** Phase 15 is
designed to stay completely invisible until an org flips
`compliance.pack` on, then light up coherently across (sidebar + /compliance
landing + audit tab + acknowledgments index). If the gating drifts — surfaces
leaking to orgs that didn't opt in, or stay dark after the toggle flips —
the entire feature is broken.

## Goal

Validate that:

1. With `compliance.pack` OFF, the Compliance sidebar item is hidden, all
   `/compliance/*` routes return 404, and the Audit pill is NOT visible
   on any workflow detail header (Builder / Read / Runs).
2. Flipping `compliance.pack` ON via `/settings/general` immediately lights
   up all four surfaces above on next nav.
3. The per-workflow Audit timeline at `/library/workflows/[id]/audit`
   renders the workflow's audit_log rows newest-first, with actor identity,
   action verb, and changes diff (e.g. "title: 'X' → 'Y'").
4. The Acknowledgments index at `/compliance/acknowledgments` lists every
   acknowledgment in the org, and clicking a row opens the single receipt
   with the canonical proof (org / workflow / version / user / timestamp).
5. The receipt page prints cleanly (no sidebar / no nav chrome) via
   `window.print()`.
6. A plain member (non-admin, non-reviewer) cannot reach `/compliance` even
   when the capability is on — gating composes capability AND role.

## Prerequisites

### Dev server

The dev server reads its env from the **monorepo-root `.env.local`** (NOT
`apps/saas/.env.local`):

```bash
cd c:/Projects/Virn/virn-ops/apps/saas
pnpm exec dotenv -c -e ../../.env.local -- next dev --port 3000
```

Wait for "Local: http://localhost:3000" before navigating. If port 3000 is
already taken:

```bash
netstat -ano | grep ":3000" | grep LISTENING | awk '{print $5}' | xargs taskkill //F //PID
```

### Auth

Seeded admin: `pgrennell@gmail.com` in the org with slug `virn`. Magic-link
bypass pattern in `apps/saas/tests/dogfood-walkthrough.spec.ts` — copy that
approach exactly:

- Helper: `waitForVerificationForEmail` from `apps/saas/tests/__helpers/db.ts`
- Callback URL: `http://localhost:3000/api/auth/magic-link/verify?token={TOKEN}&callbackURL=http://localhost:3000/virn/compliance`

### Capability seed

The `compliance.pack` capability is new in this phase. Re-seed before testing:

```bash
pnpm --filter @virn/scripts seed:capabilities
```

The script is idempotent. After seeding, the capability exists in the DB
with `defaultEnabled: false` — meaning the org's org_capability row is
absent and the gate evaluates to OFF for every org until an admin flips it.

### Seed data for scenarios C + D

The Acknowledgments scenarios need at least one `acknowledgment` row. The
WRITE path (the Acknowledge button) lands in Phase 16, so for now seed
directly:

```bash
pnpm --filter @virn/database exec drizzle-kit studio
```

In the `acknowledgment` table, insert at least 2 rows pointing at any
published workflow_version + the seeded user. Capture the inserted ids for
the receipt URL.

If that path is awkward, a one-shot SQL also works (paste into Studio's SQL
console):

```sql
INSERT INTO acknowledgment (id, organization_id, workflow_version_id, user_id, acknowledged_at)
SELECT
  'ack_test_' || generate_series,
  o.id,
  wv.id,
  u.id,
  now() - (generate_series || ' hours')::interval
FROM organization o
CROSS JOIN LATERAL (
  SELECT wv.id FROM workflow_version wv
  INNER JOIN workflow w ON w.id = wv.workflow_id
  WHERE w.organization_id = o.id AND wv.status = 'published'
  LIMIT 1
) wv
CROSS JOIN LATERAL (SELECT id FROM "user" LIMIT 1) u
CROSS JOIN generate_series(1, 3)
WHERE o.slug = 'virn'
ON CONFLICT DO NOTHING;
```

### Migrations

No new migrations in Phase 15. Sanity-check:

```bash
pnpm --filter @virn/database migrate
```

If anything migrates unexpectedly, note it in the report and re-confirm.

## Test plan

Save artifacts under `docs/reviews/phase-15-compliance-2026-05-30/` and
the spec at `apps/saas/tests/phase-15-compliance-2026-05-30.spec.ts`
following the existing `getArtifactsDir` pattern.

Tag scenarios **P0 / P1 / P2** to prioritize when running out of time. All
P0 first; P1 if cycles remain; P2 is stretch. Sequential screenshot naming
`01-`, `02-`, ... across all scenarios.

---

### P0 — A. Capability gate honesty (load-bearing)

**This is the load-bearing scenario for this briefing.** If the gating
drifts, the feature either leaks to orgs that didn't opt in or stays dark
for orgs that did.

**Scenario:** Confirm Phase 15 surfaces are completely hidden when
`compliance.pack` is OFF and light up coherently when flipped ON.

1. Navigate to `http://localhost:3000/virn` (logged in as the admin).
   Capture `01-sidebar-compliance-off.png` of the left sidebar. The
   Compliance item under "Understand" should NOT appear.
2. Direct-visit `/virn/compliance`. Should 404 (or redirect to a not-found
   shell). Capture `02-compliance-404.png`.
3. Direct-visit `/virn/compliance/acknowledgments`. Should 404. Capture
   `03-acknowledgments-404.png`.
4. Pick any workflow from `/virn/library` and open its Builder view.
   Confirm the header shows `[Author | Read]` + `Runs` (Phase 14) but
   NO `Audit` pill. Capture `04-workflow-header-audit-off.png`.
5. Navigate to `/virn/settings/general`. Find the "Compliance pack"
   capability toggle. Flip it to ON. Capture `05-capability-toggled-on.png`.
6. Navigate back to `/virn` (or refresh the sidebar). The Compliance item
   should now appear under "Understand". Capture `06-sidebar-compliance-on.png`.
7. Direct-visit `/virn/compliance`. Should render with two link cards
   (Acknowledgments + Workflow audit timelines). Capture
   `07-compliance-landing.png`.
8. Re-visit the workflow from step 4. The Audit pill should now appear in
   the header. Capture `08-workflow-header-audit-on.png`.

**Capture:** `01-` through `08-` per the steps above.

**Verify:**
- All four surfaces (sidebar item, /compliance, /compliance/acknowledgments,
  workflow Audit pill) match the capability state exactly. No surface
  leaks when OFF; no surface stays dark when ON.
- Toggling the capability OFF again (stretch — optional) cleanly hides
  everything back.

**Report:**
- Pass/fail per surface (sidebar / landing / acknowledgments / workflow pill).
- Any console errors on the navigation flow.
- Any visual glitch on the capability toggle itself (the existing toggle UI
  is Phase 8; just confirm nothing regressed).

---

### P0 — B. Per-workflow audit timeline

**Scenario:** Confirm the per-workflow Audit page renders the audit_log
rows with actor / verb / diff and pagination works.

1. With `compliance.pack` ON, pick a workflow that has real activity
   (publish history, edits). STR Turnover from prior seeding is a good
   target since it's been edited multiple times.
2. Open Builder, then click the **Audit** pill. URL should be
   `/virn/library/workflows/<id>/audit`. Capture `09-audit-page-default.png`.
3. Verify each row shows:
   - Actor icon (User / Guest / Agent / Vendor)
   - Actor display name
   - Action verb (e.g. "workflow · published", "workflow · updated")
   - Changes diff when present ("title: 'old' → 'new'")
   - Relative timestamp
4. If the row count exceeds 25, the pagination bar appears. Click "next" —
   URL gains `?page=2`. Capture `10-audit-page-2.png`.
5. Click the **Runs** pill, then back to **Audit**. The Audit pill should
   show the active treatment ONLY when on the audit route.

**Capture:** `09-`, `10-`.

**Verify:**
- Newest-first ordering.
- Diff format reads cleanly. Long values are truncated (40 chars max).
- The actor name resolves correctly for the admin's own actions ("Paul
  Grennell" or whatever the seed admin is named).
- Pagination preserves the `?page=` param on refresh.

**Report:**
- Total row count visible eyeballed.
- Any malformed diff renders (e.g. raw `<json>` everywhere — would mean
  the changes JSON shape doesn't match the parser).
- Any console errors.

---

### P0 — C. Acknowledgments index + single receipt

**Scenario:** Confirm the acknowledgments index lists the seeded rows and
the receipt page renders the canonical evidence proof.

1. From `/virn/compliance`, click "Acknowledgments". URL should be
   `/virn/compliance/acknowledgments`. Capture `11-acknowledgments-index.png`.
2. Verify each row shows: Workflow title (clickable), Version (v1/v2/…),
   User (name + email), Acknowledged-at timestamp.
3. Click any row's workflow title. URL should be
   `/virn/compliance/acknowledgments/<id>`. Capture `12-receipt-default.png`.
4. Verify the receipt header shows:
   - "Acknowledgment receipt" eyebrow text
   - Workflow title (large)
   - Organization name (subtitle)
   - "Acknowledged" green badge with checkmark
5. Verify the metadata grid shows: Workflow version, Workflow type, User,
   Email, Acknowledged at, Receipt id (monospace).
6. Verify the bottom row of monospace text shows the three uuids
   (Workflow id, Version id, User id).
7. Verify the bottom card "Audit history" renders the audit timeline for
   the acknowledgment entity. For a freshly-seeded ack with no audit rows,
   the empty-state copy reads "No additional audit history yet — the
   insert itself was the only event." Capture `13-receipt-audit-empty.png`.

**Capture:** `11-`, `12-`, `13-`.

**Verify:**
- Cross-org isolation: if you can craft a foreign acknowledgment id and
  hit `/virn/compliance/acknowledgments/<foreign-id>`, the page should
  surface "Receipt not found" via the `NOT_FOUND` error path.
- The org name in the receipt matches the active org's name, not a fk id.

**Report:**
- Pass/fail per surface.
- The receipt id you printed (so the spec can re-target the same id).
- Any cross-org test you ran + result.

---

### P1 — D. URL state on audit + acknowledgments pages

**Scenario:** Confirm `?page=` survives refresh on the audit timeline AND
the acknowledgments index.

1. On `/virn/library/workflows/<id>/audit?page=2`, hard-refresh. Should
   still be on page 2. Capture `14-audit-page-refresh.png`.
2. On `/virn/compliance/acknowledgments?page=2`, hard-refresh. Should
   still be on page 2. Capture `15-ack-page-refresh.png`.
3. Copy each URL, open in a new tab. Same state hydrates.

**Verify:**
- Page number survives refresh.
- Page number survives new-tab navigation through the magic-link flow
  (matches the Phase 14 D scenario pattern).

**Report:**
- Pass/fail per page-type.
- Any URL param silently dropped.

---

### P1 — E. Receipt print view

**Scenario:** Confirm the receipt prints cleanly without sidebar chrome.

1. On a receipt page, open the browser's print preview (Ctrl+P / Cmd+P).
2. Verify the print output:
   - Hides the back link + Print button (top row)
   - Renders the receipt article without the rounded border + padding
     (`print:border-none print:p-0`)
   - Includes the metadata grid + the audit history below
3. Capture the print preview as `16-receipt-print-preview.png`.

**Verify:**
- The printed page is something you'd hand to an auditor without
  embarrassment.
- The eyebrow text + badge + metadata grid all render.

**Report:**
- Pass/fail.
- Any layout issue (e.g. metadata grid wrapping awkwardly, audit history
  cut off).

---

### P2 — F. Role gating on /compliance

**Scenario:** Confirm a plain member can't reach `/compliance` even when
the capability is on.

1. If a non-admin test account is reachable, log in as that user (with
   `compliance.pack` ON for the org).
2. Navigate to `/virn/compliance`. Should 404 (member role isn't in the
   `[reviewer, admin, owner]` allow-list).
3. Navigate to a workflow's Builder view. Confirm the Audit pill is
   NOT visible in the header for this user.
4. Direct-visit `/virn/library/workflows/<id>/audit`. Should 404.

**Capture:** `17-non-admin-compliance-404.png` if reachable.

**Verify:**
- 404 (not 403, not blank page) — matches the assertCanSee posture.
- No leaked admin-only UI.

**Report:**
- Pass/fail if reachable, "skipped — no non-admin account" if not.

---

## What to send back

A single markdown report at `docs/reviews/phase-15-compliance-2026-05-30/REPORT.md`
with:

- **Per-scenario verdict** (PASS / FAIL / PARTIAL) with the captured
  screenshots linked by filename.
- **The P0 — A verdict is load-bearing.** If any surface leaks when the
  capability is OFF, or any surface stays dark when ON — report
  immediately. That's the entire feature.
- **Any console errors** observed (paste verbatim, including stack).
- **Specific reproductions** for anything that didn't behave as described.
- **"Recommend amend"** markers on anything cheaper to patch than to
  fully verify.

The relevant HEAD commit to cite findings against:

- `6e92e62` feat(audit,acknowledgments,saas): Phase 15 — Thin compliance /
  evidence surface (S-10). Single commit covers all four slices (capability
  flag + audit reader + per-workflow Audit tab + acknowledgments index +
  receipt).

---

## Kickoff prompt (paste this to Antigravity)

```
I need browser-driven verification of Phase 15 (the thin compliance /
evidence surface — capability flag + per-workflow audit timeline +
acknowledgments index + single receipt). The full self-contained briefing
is at:

  c:\Projects\Virn\virn-ops\docs\reviews\phase-15-compliance-2026-05-30\ANTIGRAVITY_BRIEFING.md

Read it first — it has prerequisites (dev server, magic-link auth,
capability re-seed, seeded acknowledgments), tagged scenarios (P0/P1/P2),
capture targets, and per-scenario reporting expectations.

Priorities: all P0 first, then P1 if cycles remain, P2 stretch.
P0 — A (capability gate honesty) is the load-bearing one: if any surface
leaks when compliance.pack is OFF, or stays dark when ON, the entire
feature is broken. Report immediately if so.

Save artifacts under `docs/reviews/phase-15-compliance-2026-05-30/` and
write the report at `docs/reviews/phase-15-compliance-2026-05-30/REPORT.md`
— per-scenario verdict (PASS / FAIL / PARTIAL), screenshots linked by
filename, console errors verbatim, "recommend amend" markers on anything
cheaper to patch than to fully verify.

The relevant HEAD commit is listed at the bottom of the briefing. Repo is
on the `main` branch and up to date.

If any prerequisite fails (port 3000 taken, magic-link not landing,
capability seed not applied, no acknowledgments to seed against) — STOP
and report rather than guessing. The briefing flags the known landmines in
its Prerequisites section.
```
