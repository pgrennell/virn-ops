# Antigravity Briefing — Phase 19: property-ops pack auto-install on org creation

**Repo:** `c:\Projects\Virn\virn-ops`
**Branch:** `main` (HEAD at the latest commit; everything in scope is pushed)
**Date:** 2026-05-31

## What this is

Phase 19 (v1 launch readiness), slice A. We wired the **property-ops starter pack to
auto-install when a new organization is created**, so a brand-new org lands with content
instead of an empty library. Previously the pack only installed if an admin clicked it
manually in Settings → "Install starter content".

The change is a single best-effort call in
`apps/saas/modules/organizations/components/CreateOrganizationForm.tsx`: after the org is
created + made active, it calls the existing idempotent `packs.installStarterContent`
procedure, then forwards to the mode picker. The mode picker is unchanged — the user still
chooses Checklist / SOPs / Automation, and can change it later in Settings → Configuration.

Unit + contract tests are green (`saas` 363, `@virn/api` packs 6, type-check clean), but they
mock the orpc client and the DB. **What needs a browser:** the real end-to-end — that a freshly
created org actually comes up with the 10 vendor categories, 4 roles, and the runnable
"STR Turnover & Housekeeping" workflow materialized in its database.

**Load-bearing claim:** after creating a new org, its library contains the
"STR Turnover & Housekeeping" workflow (i.e. the pack genuinely installed). If that fails, the
slice didn't deliver.

## Goal

Validate that:

1. Creating a new org redirects to the mode picker (`/new-organization/mode`), unchanged.
2. After clearing the mode picker, the new org's **library shows the "STR Turnover &
   Housekeeping" workflow** (the pack auto-installed).
3. The new org's Settings shows the pack as **already installed** (the "Install starter
   content" card is in its installed/disabled state) and the **10 vendor categories** are present.
4. Creating a **second** org also lands populated, with no errors (idempotent + repeatable).
5. Org creation never hard-fails on the install: even in the worst case the user still reaches
   the org (best-effort). (Primarily covered by unit tests; just confirm no error toast/blocked
   redirect during the happy path.)

## Prerequisites

### Dev server

The dev server reads its env from the **monorepo-root `.env.local`** (NOT
`apps/saas/.env.local`):

```bash
cd c:/Projects/Virn/virn-ops/apps/saas
pnpm exec dotenv -c -e ../../.env.local -- next dev --port 3000
```

Wait for "Local: http://localhost:3000" before navigating. If port 3000 is already taken:

```bash
netstat -ano | grep ":3000" | grep LISTENING | awk '{print $5}' | xargs taskkill //F //PID
```

> Note: start a **fresh** dev server from this command so the app and the magic-link DB helper
> read the same `.env.local` database. A pre-existing server started against a different env will
> make the magic-link verification-row lookup time out (a known harness foot-gun, not a product bug).

### Auth

Seeded admin: `pgrennell@gmail.com`. Magic-link bypass pattern in
`apps/saas/tests/dogfood-walkthrough.spec.ts` — copy that approach exactly:

- Helper: `waitForVerificationForEmail` from `apps/saas/tests/__helpers/db.ts`
- Callback URL: `http://localhost:3000/api/auth/magic-link/verify?token={TOKEN}&callbackURL=http://localhost:3000/`

### Property-ops pack must be platform-seeded

The auto-install is best-effort: if the platform pack isn't seeded, it silently no-ops and the
new org's library stays **empty** — which would read as a failure of this slice even though the
wiring is correct. So **seed first**:

```bash
pnpm --filter @virn/scripts seed:property-ops-pack
```

If you create an org and the library is empty, check this seed ran before reporting a FAIL —
note explicitly whether the pack was seeded.

## Test plan

Save artifacts under `docs/reviews/phase-19-org-provisioning-2026-05-31/` and the spec at
`apps/saas/tests/phase-19-org-provisioning-2026-05-31.spec.ts` following the existing
`getArtifactsDir` pattern. Sequential screenshot naming `01-`, `02-`, … across all scenarios.

---

### P0 — A. Create org → mode picker → populated library

**This is the load-bearing scenario for this briefing.**

**Scenario:** A new org auto-installs the property-ops pack and lands with content.

1. Signed in as the seeded admin, go to `/new-organization` (the create-org form).
2. Enter a unique org name (e.g. `Antigravity Ops {timestamp}`) and submit.
3. Confirm the redirect to `/new-organization/mode` (the mode picker, "What will you use Virn
   Ops for?").
4. Pick any mode (e.g. "SOPs & policies") → Continue → land in the new org.
5. Navigate to the org's **Library**.

**Capture:** `01-create-form.png`, `02-mode-picker.png`, `03-library-populated.png`

**Verify:**
- The redirect chain create → `/new-organization/mode` → org dashboard works.
- The library lists the **"STR Turnover & Housekeeping"** workflow (published).

**Report:**
- PASS/FAIL on the workflow being present in the new org's library.
- Any console errors during create/redirect (paste verbatim).

---

### P0 — B. New org Settings shows the pack installed + vendor categories

**Scenario:** The pack's other content materialized and the install is recorded.

1. In the new org, go to **Settings → General** (the "Install starter content" card).
2. Confirm it shows the **already-installed** state (badge / disabled "Install" button), not an
   enabled "Install" button.
3. Go to the **Vendors** surface and confirm the **10 property-ops categories** are present
   (Pest Control, HVAC, Plumbing, Electrical, Landscaping & Grounds, Cleaning, Pool & Spa,
   Locksmith, + 2 more).

**Capture:** `04-settings-already-installed.png`, `05-vendor-categories.png`

**Verify:**
- The card reflects "already installed" (proves the auto-install ran, not a manual click).
- Vendor categories present.

**Report:**
- PASS/FAIL with screenshots.

---

### P1 — C. Second org is also populated (idempotent + repeatable)

**Scenario:** Auto-install isn't a one-off; a second new org also lands populated.

1. Create a **second** new org (different name).
2. Clear the mode picker, open its Library.

**Capture:** `06-second-org-library.png`

**Verify:**
- The second org's library also shows "STR Turnover & Housekeeping".
- No error toast appears at any point in either create flow.

**Report:**
- PASS/FAIL; note any errors.

---

## What to send back

A single markdown report at `docs/reviews/phase-19-org-provisioning-2026-05-31/REPORT.md` with:

- **Per-scenario verdict** (PASS / FAIL / PARTIAL) with the captured screenshots linked by filename.
- **The P0 — A verdict is load-bearing.** If the new org's library does NOT contain the
  "STR Turnover & Housekeeping" workflow, report immediately — and state whether the
  `seed:property-ops-pack` step was run (so we can tell a wiring bug from an unseeded platform).
- **Any console errors** observed (paste verbatim, including stack).
- **Specific reproductions** for anything that didn't behave as described.
- **"Recommend amend"** markers on anything cheaper to patch than to fully verify.

The relevant HEAD commits to cite findings against:

- `9d4ced4` feat(saas): auto-install property-ops pack on new org creation (Phase 19 #3 slice A)

---

## Kickoff prompt (paste this to Antigravity)

```
I need browser-driven verification of property-ops pack auto-install on new-org creation.
The full self-contained briefing is at:

  c:\Projects\Virn\virn-ops\docs\reviews\phase-19-org-provisioning-2026-05-31\ANTIGRAVITY_BRIEFING.md

Read it first — it has prerequisites (dev server from root .env.local, magic-link auth, and a
REQUIRED `pnpm --filter @virn/scripts seed:property-ops-pack` step), tagged scenarios
(P0/P1), capture targets, and per-scenario reporting expectations.

Priorities: all P0 first, then P1 if cycles remain.
P0 — A is the one that matters most: after creating a new org, its library MUST contain the
"STR Turnover & Housekeeping" workflow. If it's empty, confirm the pack-seed step ran before
reporting a FAIL, then report immediately.
```
