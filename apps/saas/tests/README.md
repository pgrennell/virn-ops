# Playwright E2E auth + org tests

Regression net for the Supastarter / Better Auth surface documented in
[`docs/AUTH_CONTRACT.md`](../../../docs/AUTH_CONTRACT.md). These tests run
against a real Next.js production build (Playwright's `webServer`) and a real
Postgres database — they exercise the same code path the user does, with no
mocking of auth, sessions, or storage.

> **For AI agents:** Before changing or adding tests here, read
> `docs/AUTH_CONTRACT.md`. The §5 behaviors are what this suite protects.

---

## What's covered today

Every spec maps to a §5 behavior in the contract.

| Spec                                  | Contract anchor              | What it asserts                                                                                    |
| ------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------- |
| `login.spec.ts`                       | §5.1 UI                      | Login form renders all elements; tab switching works.                                              |
| `auth/signup-and-verify.spec.ts`      | §5.1, §6 #3, #4              | Email+password signup creates a user, requires verification (no auto-signin), verify flow logs in. |
| `auth/login-password.spec.ts`         | §5.1                         | Verified user signs in; wrong password rejected; no session created on failure.                    |
| `auth/magic-link.spec.ts`             | §5.1                         | Magic-link request + click completes login for a verified user.                                    |
| `auth/password-reset.spec.ts`         | §5.1                         | Reset flow swaps the password; old fails, new works.                                               |
| `auth/logout.spec.ts`                 | §5.4                         | Logout clears the session; subsequent protected route hits redirect to /login.                     |
| `org/create-and-switch.spec.ts`       | §5.3                         | Owner can create multiple orgs; both are reachable by slug.                                        |
| `org/cross-org-idor.spec.ts`          | §3.1, §4 (Invariant #1)      | Non-member cannot reach an org by slug. Annotates a listPurchases probe (tightens after Batch A).  |

## What's deferred (explicitly out of scope this pass)

Each of these needs setup that doesn't fit in a single test pass. They're
listed here so the gap is visible.

- **OAuth (Google/GitHub)** — needs either dedicated test accounts in each
  provider's developer console, or a `socialProviders` mock layer. Best left
  to a focused setup.
- **2FA (TOTP) enroll + login** — needs the secret extraction + `otplib`-
  style code generation in test helpers.
- **Passkey enroll + login** — needs Playwright's `virtualAuthenticator`
  setup via CDP; not free.
- **Invitation flow** — needs the invitation token extraction (it lives in
  `invitation` table, distinct from `verification`) and a second browser
  context per test for the invitee.
- **Subscription checkout + customer portal** — needs Stripe test mode keys
  and Stripe's hosted checkout to be reachable from CI; both modes (`user`
  and `organization`) need separate tests. The cross-org IDOR spec contains
  a placeholder annotation that will tighten into a hard assertion once
  Batch A's `listPurchases` membership check is in.
- **Change role / remove member / leave org / delete org** — straightforward
  follow-ups; depend on the invitation flow for setup.
- **Email change verification** — straightforward; uses the same
  `verification` table pattern.

## Helpers

- `__helpers/test-users.ts` — unique email / password / name / org-name /
  org-slug generators for collision-free parallel runs.
- `__helpers/db.ts` — direct Drizzle queries against the `verification` and
  `user` tables to extract magic-link / reset / verification tokens, check
  email-verified state, and best-effort cleanup.
- `__helpers/auth.ts` — composite signup / login / magic-link / reset /
  logout flows driven via the UI, plus a `/api/auth/get-session` API call
  used to assert session state without UI.
- `__helpers/org.ts` — org creation, switching, and member-invite UI flows.

## How to run

```bash
# Local, interactive (Playwright UI mode):
pnpm --filter saas e2e

# CI-style headless run (installs browsers first):
pnpm --filter saas e2e:ci
```

Playwright's `webServer` config (`apps/saas/playwright.config.ts`) builds and
starts the prod server before tests run, so the tests exercise the same
bundle that ships to production.

## Prerequisites

The tests need:

1. **A working Postgres database** reachable via `DATABASE_URL` (loaded from
   `.env.local`). All Better Auth + Drizzle tables must be migrated.
2. **The app builds cleanly** — Playwright's `webServer` runs
   `pnpm --filter saas run build && pnpm --filter saas run start`.
3. **`enableSignup: true`** in `packages/auth/config.ts` — when invitation-
   only mode is on, the signup-driven flow needs adjustment (use the
   invitation token instead of the public signup).
4. **`paymentsConfig.requireActiveSubscription: false`** OR a hand-rolled
   subscription bypass for the test user — otherwise verified users get
   redirected to `/choose-plan` before they reach the test surface.

If any of the above are not met, expect noisy failures.

## Test data isolation

Every test generates a unique email (`makeTestEmail(label)` → `e2e-<label>-
<ts>-<random>@virn.test`) and best-effort deletes the user in a `finally`
block. Tests are written to be safely parallelizable — the playwright config
has `fullyParallel: true`.

If a test crashes mid-cleanup, leftover rows are inert: subsequent runs use
new emails, and Better Auth doesn't surface inactive accounts in any UI. The
`.test` TLD (RFC 6761) guarantees no real email ever clashes.

## When to update this suite

- **Adding a new auth flow** (any §5 behavior) → add a spec here.
- **Editing Better Auth config** (any §6 invariant) → the snapshot test in
  `packages/auth/config.snapshot.test.ts` will scream first; then verify the
  affected spec here still passes.
- **Adding a new oRPC procedure on org-owned data** → add a probe to
  `org/cross-org-idor.spec.ts` exercising the new endpoint with a non-member.

## How the no-SMTP token extraction works

Better Auth writes magic-link / email-verification / password-reset tokens to
the `verification` table before calling the configured email sender. We
bypass the email step entirely: `__helpers/db.ts` reads the latest row for a
given email and `__helpers/auth.ts` constructs Better Auth's stable verify
URL from the token. This is the same pattern used in the
`@virn/auth/config.snapshot.test.ts` infrastructure.

Trade-off: if Better Auth changes its verify-URL shape between major
versions, the test helpers need updating. The snapshot test in
`packages/auth/config.snapshot.test.ts` pins the plugin set and will surface
a Better Auth bump before any spec here silently breaks.
