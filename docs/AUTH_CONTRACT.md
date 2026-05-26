# AUTH_CONTRACT.md

Normative contract for authentication, session, organization, and tenancy behavior
in Virn Ops. This document is the source of truth for what Better Auth (via the
Supastarter foundation) does in this codebase, what Virn extends on top, and what
must not regress.

**Status:** Draft v1 · **Date:** 2026-05-26 · **Owner:** Paul

> **For AI agents and human contributors:** Before touching anything under
> `packages/auth/`, `packages/api/orpc/procedures.ts`, the `*Procedure` middleware
> used by oRPC modules, the SaaS auth modules under `apps/saas/modules/auth/` and
> `apps/saas/modules/organizations/`, or any session helper, **read this file**.
> The §6 Critical invariants list is non-negotiable — those behaviors are pinned
> by tests and CI; deliberately changing one is a recorded decision, not a quiet
> edit. Anything that would change a §6 invariant must update this doc and the
> snapshot test in the same PR.

---

## 1. Scope and purpose

Virn Ops sits on a fresh Supastarter clone. Supastarter ships a tried-and-true
auth surface built on **Better Auth** (organization plugin, admin plugin, magic
link, OAuth, passkeys, 2FA, email verification, password reset). The Virn-
specific layer adds an invitation-only gate, an oRPC middleware ladder that
enforces multi-tenancy on top of Better Auth's session, and a per-org capability
resolver bound to the session via the URL slug.

This contract enumerates:

- **What's enabled** today (Better Auth config + plugins + Virn extensions).
- **How authorization composes** for every API call (the procedure ladder).
- **How tenancy is enforced** end-to-end (Invariant #1 from
  `docs/ARCHITECTURE.md` §3).
- **Which config values are pinned** by the snapshot test in CI.
- **Where the sharp edges are** and how to avoid regressing them.
- **The pre-merge checklist** for any PR that touches auth-adjacent code.

It is *not* a Better Auth manual — that lives in Better Auth's own docs. It *is*
the inventory of what Virn currently depends on Better Auth doing.

---

## 2. Auth surface inventory

### 2.1 Better Auth core configuration

Implemented in [packages/auth/auth.ts](../packages/auth/auth.ts). Knobs come from
[packages/auth/config.ts](../packages/auth/config.ts).

| Feature                       | Knob (`packages/auth/config.ts`) | Current value | Better Auth surface           |
| ----------------------------- | -------------------------------- | ------------- | ----------------------------- |
| Self-serve signup             | `enableSignup`                   | `true`        | `emailAndPassword`, hooks     |
| Email + password login        | `enablePasswordLogin`            | `true`        | `emailAndPassword`            |
| Magic-link login              | `enableMagicLink`                | `true`        | `magicLink` plugin            |
| OAuth (Google, GitHub)        | `enableSocialLogin`              | `true`        | `socialProviders`             |
| Passkeys (WebAuthn)           | `enablePasskeys`                 | `true`        | `passkey` plugin              |
| Two-factor (TOTP)             | `enableTwoFactor`                | `true`        | `twoFactor` plugin            |
| Session cookie lifetime       | `sessionCookieMaxAge` (seconds)  | `2592000` (30d) | `session.expiresIn`         |
| Account linking (trusted)     | (hard-coded)                     | google, github | `account.accountLinking`     |
| Onboarding gate post-signup   | `users.enableOnboarding`         | `true`        | `user.additionalFields.onboardingComplete` |
| Auto sign-in after verification | (hard-coded)                   | `true`        | `emailVerification.autoSignInAfterVerification` |
| Auto sign-in after email signup | derived from `!enableSignup`   | `false` today | `emailAndPassword.autoSignIn` |
| Require email verification on signup | derived from `enableSignup` | `true` today | `emailAndPassword.requireEmailVerification` |
| Disable magic-link signup    | (hard-coded)                     | `false`       | `magicLink.disableSignUp`     |
| Minimum password length       | (hard-coded)                     | `8`           | `emailAndPassword.minPasswordLength` |

### 2.2 Better Auth plugins enabled

In order, from [packages/auth/auth.ts](../packages/auth/auth.ts):

1. `username()`
2. `admin()` — platform-level admin (Better Auth's user-role admin, distinct from org admin).
3. `passkey()`
4. `magicLink({ disableSignUp: false, sendMagicLink: <Virn email template> })`
5. `organization({ sendInvitationEmail: <Virn email template> })`
6. `openAPI()`
7. `invitationOnlyPlugin()` — **Virn-specific**, see §2.6.
8. `twoFactor()`

Client mirror in [packages/auth/client.ts](../packages/auth/client.ts) includes
`inferAdditionalFields<typeof auth>()`, `magicLinkClient`, `organizationClient`,
`adminClient`, `passkeyClient`, `twoFactorClient`.

### 2.3 Session model

- Sessions are issued by Better Auth and stored via the Drizzle adapter.
- Cookie name is Better Auth's default; the lifetime is `sessionCookieMaxAge`
  (30 days currently).
- `freshAge: 0` — every session is considered "fresh" for sensitive-action gating.
- On session create, a `databaseHooks.session.create.before` hook copies the
  user's `lastActiveOrganizationId` into `session.activeOrganizationId` so the
  session arrives with an org pre-selected.
- The session is reconciled to the URL slug client-side by
  [`ActiveOrganizationProvider`](../apps/saas/modules/organizations/components/ActiveOrganizationProvider.tsx)
  — visiting `/{slug}/...` triggers `authClient.organization.setActive({ organizationSlug })`
  if the active org doesn't match the slug.
- Server reads use [`getSession()`](../apps/saas/modules/auth/lib/server.ts) with
  `disableCookieCache: true` — every request re-validates against the database.

### 2.4 User additional fields

Declared in [`auth.ts`](../packages/auth/auth.ts) under `user.additionalFields`:

- `onboardingComplete: boolean` — gates `(authenticated)` routes; false redirects
  to `/onboarding`.
- `locale: string` — drives email locale + i18n.
- `lastActiveOrganizationId: string` — sticky org selection across sessions.

### 2.5 Organization model

- Better Auth's `organization` plugin provides the schema (`organization`,
  `member`, `invitation`) and the API (`/api/auth/organization/*`).
- Built-in member roles: **`owner`**, **`admin`**, **`member`** — see
  [packages/auth/lib/organization-member-role-order.ts](../packages/auth/lib/organization-member-role-order.ts).
- `ActiveOrganization` type is the result of `auth.api.getFullOrganization(...)`;
  it includes `members: { userId, role }[]` — the membership check surface.
- **Custom roles (Builder / Operator / Reviewer)** are reserved by ADR-004 and
  **not implemented**. The Virn UI gating helper maps `member → operator` until
  custom roles ship.
- Forbidden organization slugs are listed in [config.ts](../packages/auth/config.ts):
  `new-organization`, `admin`, `settings`, `ai-demo`, `organization-invitation`,
  `chatbot`. Any new top-level app route segment must be added here.
- Slug generation: [`generateOrganizationSlug`](../packages/api/modules/organizations/procedures/generate-organization-slug.ts)
  is currently `publicProcedure` (see §7.3).

### 2.6 Invitation-only plugin (Virn extension)

Implemented in [packages/auth/plugins/invitation-only/index.ts](../packages/auth/plugins/invitation-only/index.ts).

- Gates the `/sign-up/email` endpoint **only**.
- When `config.enableSignup === false`, signups are refused unless a pending
  invitation exists for the email (`getPendingInvitationByEmail`).
- When `config.enableSignup === true`, the plugin is a no-op.
- **Gap (intentional today, security risk if `enableSignup` is flipped to false):**
  the gate does **not** cover `/sign-in/magic-link` or `/magic-link/send`. A
  magic-link signup would bypass invitation-only enforcement. Either keep
  `enableSignup === true` (today's posture) or extend the matcher when flipping
  signup off. Tracked in Batch F of the code-review plan.

### 2.7 Subscription / billing integration

[packages/auth/auth.ts](../packages/auth/auth.ts) wires Better Auth lifecycle
events to the payments layer:

- `hooks.after` on `/organization/accept-invitation` and `/organization/remove-member`
  → calls `updateSeatsInOrganizationSubscription(organizationId)` to true up seat
  counts.
- `hooks.before` on `/delete-user` and `/organization/delete` → cancels active
  subscriptions before the delete. **Sharp edge:** if the delete subsequently
  fails, the subscription is already cancelled. Tracked in Batch F.
- Billing attachment mode is set in
  [packages/payments/config.ts](../packages/payments/config.ts) via
  `billingAttachedTo: "user" | "organization"`. **Both modes must keep working**
  — see §5.2.

### 2.8 Account deletion

- Powered by Better Auth's `user.deleteUser.enabled: true`.
- Email change requires verification — `user.changeEmail.enabled: true` with a
  Virn-templated confirmation email.

### 2.9 Routing surfaces

- `/api/auth/**` → Better Auth handler, mounted in
  [packages/api/index.ts](../packages/api/index.ts).
- `/api/**` (excluding the Better Auth subtree, the payments webhook, and
  `/api/health`) → oRPC handler with the `{ headers }` context.
- `(unauthenticated)` route group → public auth pages: login, signup,
  forgot-password, reset-password, verify, magic-link verify.
- `(authenticated)` route group → wrapped by
  [layout.tsx](../apps/saas/app/(authenticated)/layout.tsx) which redirects to
  `/login` if no session and prefetches session + org list + (for user-attached
  billing) purchases into the React Query cache.
- `(authenticated)/(main)` → wraps `(authenticated)` with onboarding redirect,
  org-required redirect, and active-subscription redirect to `/choose-plan`.
- `(authenticated)/(main)/(organizations)/[organizationSlug]/` → wrapped by
  [layout.tsx](../apps/saas/app/(authenticated)/(main)/(organizations)/%5BorganizationSlug%5D/layout.tsx)
  which resolves the gating snapshot via `resolveOrgGating(slug)` and renders
  the `AppShell` with snapshot + role props.

---

## 3. The oRPC authorization ladder

All procedures in `packages/api/modules/*` must use one of the four base
procedures defined in
[packages/api/orpc/procedures.ts](../packages/api/orpc/procedures.ts). The
ladder is the **only** sanctioned way to gate API access.

| Procedure                  | Adds to context              | Use case                                                                 |
| -------------------------- | ---------------------------- | ------------------------------------------------------------------------ |
| `publicProcedure`          | `{ headers }`                | Truly public endpoints. **Rare.** Never reads or writes tenant data.     |
| `protectedProcedure`       | `+ session, user`            | User-scoped endpoints (account settings, user-attached billing).         |
| `protectedOrgProcedure`    | `+ organization, membership` | **Default for tenant data.** Resolves org from `session.activeOrganizationId` and verifies membership. |
| `adminOrgProcedure`        | (same, role-checked)         | Admin/owner-only mutations on tenant data (config writes, member mgmt).  |
| `adminProcedure`           | `+ session, user`            | Platform-admin endpoints (Better Auth `user.role === "admin"`).          |

### 3.1 The org-scoping contract (Invariant #1, applied)

- **`protectedOrgProcedure` reads the org from session context, never from input.**
  This is non-negotiable. A procedure that needs the org id must read
  `context.organization.id`.
- If a procedure must accept an `organizationId` field in its input — for
  Supastarter's dual-mode billing (see §5.2) — it must explicitly call
  `getOrganizationMembership(input.organizationId, context.user.id)` and refuse
  on miss. Such procedures are documented exceptions; the default is to take org
  from context.
- Admin-only mutations must use `adminOrgProcedure`. Verifying `membership.role`
  inside a `protectedOrgProcedure` handler is a code smell — use the right base
  procedure instead.
- Every procedure must have an `.input(z.object(...))` schema. **`z.any()`
  casts are forbidden** at the procedure boundary.

### 3.2 Server components and tenancy

- Server components in org-scoped routes resolve the gating snapshot via
  [`resolveOrgGating(slug)`](../apps/saas/modules/shared/lib/gating-server.ts).
- That helper must verify the user is actually a member of the org — not just
  that `getFullOrganization` returned a row. Silent fallthrough to a default
  role for non-members is a security bug.
- Direct database access from server components must go through the
  `queries/` layer with explicit org-id filtering. No raw cross-tenant joins.

### 3.3 Better Auth–handled endpoints

`/api/auth/**` is owned by Better Auth. Authorization for those endpoints is
Better Auth's responsibility (session validation, magic-link token validity,
invitation acceptance, etc.). Virn extensions on top:

- `invitationOnlyPlugin` rejects unauthorized signups (see §2.6).
- `hooks.before` and `hooks.after` extend specific endpoints (see §2.7).
- The Drizzle adapter writes to the project schema; `advanced.database.generateId: false`
  defers id generation to the schema's `cuid()` defaults.

---

## 4. Tenancy contract end-to-end

For any feature that reads or writes tenant data, the chain is:

```
Better Auth session
  └─> session.activeOrganizationId (set on create from user.lastActiveOrganizationId)
        └─> reconciled to URL slug client-side (ActiveOrganizationProvider)
              └─> resolved server-side by protectedOrgProcedure / resolveOrgGating
                    └─> queries take orgId and filter every read/write
                          └─> tables have organizationId NOT NULL FK (Invariant #1)
```

Breaking any link in the chain is a tenancy bug:

- A query that doesn't take orgId → potential cross-tenant data leak.
- A procedure that takes orgId from input without a membership check → IDOR.
- A server component that calls a query directly without filtering → IDOR.
- A table without `organizationId NOT NULL` (outside the Invariant #2 whitelist)
  → invariant violation; will require a migration to fix.

---

## 5. Behaviors that must be preserved (Supastarter contract)

The following behaviors ship with Supastarter and have been validated for that
codebase. **Virn changes must not regress any of them.**

### 5.1 Public auth flows

- Email + password signup with email verification.
- Email + password login.
- Magic-link login (request, click, sign in).
- Password reset (request, click, set new password).
- Email verification email is sent when `enableSignup === true`.
- Email change requires confirmation by the new email.
- OAuth with Google and GitHub (`email`, `profile` for Google; `user:email` for
  GitHub). Account linking is enabled for these two trusted providers.
- Passkey registration and login.
- 2FA setup (TOTP) and verification on login when enrolled.
- Logout clears the session and redirects to `config.redirectAfterLogout`.

### 5.2 Dual-mode billing

`paymentsConfig.billingAttachedTo` is either `"user"` or `"organization"`.

- When `"user"`: `listPurchases` is called with no `organizationId`; checkout
  and customer portal links are tied to the user's customer record.
- When `"organization"`: `listPurchases` is called with the active org id;
  checkout, customer portal, and seat counts are tied to the org's customer
  record. Invitations and member removals trigger
  `updateSeatsInOrganizationSubscription`.
- `requireActiveSubscription` (default `false`) gates `(main)` behind
  `/choose-plan` when no active plan exists for the relevant scope.

**Any tightening of the payments procedures must keep both modes working.**
The IDOR fix in Batch A is *not* "switch to `protectedOrgProcedure` and drop
`organizationId` from input" — that would break user-attached billing. The fix
is "if `organizationId` is provided in input, verify caller is a member (or
admin/owner for checkout) of that org; if not provided, fall back to user
scope."

### 5.3 Organization flows

- Create organization (from `/new-organization` or onboarding).
- Switch active organization (org switcher in the shell).
- Invite member by email (existing user → in-product accept; new user → signup
  with invitation token).
- Change member role (owner / admin / member).
- Remove member (cannot remove the last owner).
- Leave organization.
- Delete organization (cancels subscriptions, see §2.7's sharp edge).

### 5.4 Session and account lifecycle

- 30-day session lifetime (current value; see §6 if tightening).
- Session refresh / cookie rotation per Better Auth defaults.
- Account deletion cancels active subscriptions and removes the user.

### 5.5 Routing redirects

- Unauthenticated user hitting `(authenticated)` → `/login`.
- Authenticated user with `!onboardingComplete` and `enableOnboarding === true`
  → `/onboarding`.
- Authenticated user with no org and `requireOrganization === true` →
  `/new-organization`.
- Authenticated user with no active subscription and `requireActiveSubscription
  === true` → `/choose-plan`.
- Org root `/{slug}` redirects to the first nav area the user can see (Batch
  B3 will tweak ordering, not the behavior).
- Unknown org slug → `notFound()`.
- Forbidden org slug (`new-organization`, `admin`, …) → never reachable as an
  org URL because creation refuses it and the route group resolves the slug
  against the org list.

---

## 6. Critical invariants (pinned by tests / CI)

A snapshot test in `packages/auth/__tests__/config.snapshot.test.ts` (Batch:
Auth-safety setup) freezes the values below. Changing any of them requires
updating the snapshot and this document in the same PR.

1. **Plugins enabled, in order** (Better Auth's runtime IDs): `username`,
   `admin`, `passkey`, `magic-link`, `organization`, `open-api`,
   `invitationOnlyPlugin`, `two-factor`. Adding, removing, or reordering is a
   deliberate change.
2. **Magic-link signup disabled flag:** `magicLink.disableSignUp` is bound to
   `!config.enableSignup`. When `enableSignup === true` (today), magic-link
   signup is allowed; when `enableSignup === false`, magic-link auto-signup is
   refused — closing the invitation-only bypass.
3. **Email verification on signup:** required when `enableSignup === true`.
4. **Auto sign-in:** off for email/password signup when `enableSignup === true`
   (the user must verify); on after email verification.
5. **OAuth scopes:** Google `["email","profile"]`, GitHub `["user:email"]`.
   Changing scopes alters consent screens and is user-visible.
6. **Account linking trusted providers:** `["google", "github"]`. Adding a
   provider here links accounts automatically — a security-relevant default.
7. **Minimum password length:** 8.
8. **Org plugin enabled with `sendInvitationEmail` wired.** Invitations without
   email delivery silently drop.
9. **`forbiddenOrganizationSlugs` is the exact set of concrete top-level URL
   segments** plus any deliberately-reserved future routes. Enforced
   bidirectionally by `packages/auth/config.invariants.test.ts`:
   - Forward: every concrete segment under `apps/saas/app/` must be forbidden,
     otherwise an org with that slug collides with a literal route.
   - Reverse: every forbidden slug must either match a concrete segment or be
     listed in the test's `INTENTIONALLY_RESERVED_SLUGS` allowlist (with a
     comment). Catches stale entries that linger after a route is removed.
10. **`advanced.database.generateId: false`** — id generation stays in the
    schema (`cuid()` defaults), not Better Auth.
11. **Session `disableCookieCache: true`** on server reads — no stale-cache auth
    decisions on protected routes.
12. **Subscription cancellation runs on user/org delete** — billing leakage must
    not silently occur on account churn. (Move from `before` to `after` hook
    per Batch F3, but the behavior must remain.)
13. **`protectedOrgProcedure` resolves org from `session.activeOrganizationId`**,
    not from input. The middleware throws `FORBIDDEN` with no active org and
    `FORBIDDEN` when membership is missing.
14. **`adminOrgProcedure` checks `membership.role in ("admin","owner")`.**
15. **`resolveOrgGating` returns `null` when the user is not a member of the
    org.** No silent fallthrough to a default role.

---

## 7. Sharp edges and known gaps

### 7.1 Custom org roles are not implemented

ADR-004's Builder / Operator / Reviewer roles are reserved but the schema only
holds Better Auth's `owner | admin | member`. The Virn UI gating helper maps
`member → operator` as a temporary bridge in
[`nav.ts`](../apps/saas/modules/shared/lib/nav.ts) `mapBetterAuthRole`. When
custom roles ship, the mapper changes in one place; the gating helper API does
not change.

### 7.2 Session lifetime + `freshAge` posture

Sessions live for **7 days** (`config.sessionCookieMaxAge = 60*60*24*7`). The
**`freshAge` is 1 day** (`60*60*24`). Better Auth endpoints that opt into the
"fresh session required" check (typically change-password, change-email,
delete-user) refuse sessions older than 1 day without re-auth. Setting
`freshAge` higher than the session lifetime would neuter the protection; keep
`freshAge < sessionCookieMaxAge`.

### 7.3 `generateOrganizationSlug` is gated

The procedure is now `protectedProcedure` (was `publicProcedure`). All call
sites are under `(authenticated)/...` — namely `useCreateOrganizationMutation`
and `useUpdateOrganizationMutation` in
[`apps/saas/modules/organizations/lib/api.ts`](../apps/saas/modules/organizations/lib/api.ts).
If a future flow needs to probe slug availability before sign-in, that flow
must either authenticate first or use a different endpoint with explicit
rate-limit + enumeration protections.

### 7.4 Magic-link signup honors invitation-only (closed)

`magicLink.disableSignUp` is bound to `!config.enableSignup` (see §6 #2).
Flipping `enableSignup` to `false` automatically disables magic-link
auto-signup — the invitation-only gate now covers both `/sign-up/email`
(via the plugin) and `/sign-in/magic-link` (via Better Auth's built-in
flag). No remaining bypass.

### 7.5 Subscription cancellation in the `before` hook (mitigated)

Cancellation stays in `before` because the `purchase` table cascade-deletes
with `user`/`organization` — the rows are gone by the time `after` fires.
To close the "malformed request nukes subs" gap, the hook now explicitly
authorizes the caller before any cancellation side-effect:

- For `/organization/delete`: verifies the caller is the org's owner via
  `getOrganizationMembership` and throws `APIError("FORBIDDEN")` otherwise.
- For `/delete-user`: requires `ctx.context.session.userId`; throws
  `UNAUTHORIZED` if absent. Better Auth's `/delete-user` endpoint only
  deletes the current session user, so no extra owner check is needed.

If the cascade behavior on `purchase` ever changes to `set null` or
`restrict` (schema migration), this can move to `after` and the explicit
authorization here becomes redundant. Until then, the in-hook check is the
defense.

### 7.6 Cross-org reads from server components

`getActiveOrganization(slug)` relies on Better Auth's `getFullOrganization` to
refuse non-members. Defense-in-depth: `resolveOrgGating` explicitly checks
membership (Batch B1) to avoid silent operator-role fallthrough if Better
Auth's behavior ever changes.

---

## 8. Pre-merge checklist for auth-adjacent PRs

A PR touches "auth-adjacent code" if it modifies any of:

- `packages/auth/**`
- `packages/api/orpc/**`
- Any procedure under `packages/api/modules/**` (input shape, middleware, handler)
- `apps/saas/modules/auth/**` or `apps/saas/modules/organizations/**`
- The `(authenticated)` route group's `layout.tsx` files
- `apps/saas/modules/shared/lib/gating.ts` or `gating-server.ts`
- `packages/database/drizzle/schema/auth.ts` or any schema with `organizationId`
- `packages/payments/**` (because billing chains off auth)

### Two-tier safety check

The repo ships two scripts that bundle the right level of verification:

| Script                       | Runs                                                                          | Time     | When to run                                              |
| ---------------------------- | ----------------------------------------------------------------------------- | -------- | -------------------------------------------------------- |
| `pnpm safety-check`          | `turbo type-check` + `turbo test` across the entire workspace                 | ~15–20s  | Every PR. Always.                                        |
| `pnpm safety-check:auth`     | `safety-check` first, then `pnpm --filter saas e2e:ci` (Playwright E2E suite) | ~5–10min | Only when this PR touches the auth-adjacent paths above. |

`safety-check:auth` chains off `safety-check`, so if the fast tier fails you
don't waste minutes on Playwright.

### Checklist (run before requesting review)

- [ ] I read this document and verified my change does not regress any §5
      behavior or §6 invariant.
- [ ] If I added or modified an oRPC procedure, it uses the right base
      procedure from the §3 ladder. No `z.any()` at the input boundary.
- [ ] If my procedure takes `organizationId` (or any org-scoped entity id) as
      input, I added an explicit membership check.
- [ ] **`pnpm safety-check` passes** (always required).
- [ ] **If auth-adjacent: `pnpm safety-check:auth` passes** (the §6 #9 +
      snapshot + invariants + E2E auth suite, in one command).
- [ ] If `auth/config.snapshot.test.ts` snapshot changed, the change is
      intentional and the snapshot was re-reviewed.
- [ ] If I changed a §6 invariant, this document and the snapshot are updated
      in the same PR.
- [ ] If I changed Supastarter-shipped behavior, I documented the rationale in
      `docs/DECISIONS.md`.
- [ ] If my change touches a browser-driven flow (signup, login, OAuth, magic
      link, passkey, 2FA, org invitation, checkout), I ran it through a real
      browser (Antigravity or Playwright MCP) — type-checks alone are not
      sufficient.

### For AI agents working in this codebase

When you make any change under the auth-adjacent paths listed above, your
"done" condition includes running `pnpm safety-check:auth` and reporting the
result. Don't declare a task complete on type-check alone. If the user has
specifically deferred testing to a later session, say so explicitly in your
report.

---

## 9. Reference files

- [packages/auth/auth.ts](../packages/auth/auth.ts) — Better Auth instance.
- [packages/auth/config.ts](../packages/auth/config.ts) — Virn auth knobs.
- [packages/auth/types.ts](../packages/auth/types.ts) — config shape.
- [packages/auth/client.ts](../packages/auth/client.ts) — Better Auth client + plugin mirror.
- [packages/auth/lib/helper.ts](../packages/auth/lib/helper.ts) — `isOrganizationAdmin`.
- [packages/auth/lib/organization.ts](../packages/auth/lib/organization.ts) — `updateSeatsInOrganizationSubscription`.
- [packages/auth/lib/organization-member-role-order.ts](../packages/auth/lib/organization-member-role-order.ts) — role order.
- [packages/auth/plugins/invitation-only/index.ts](../packages/auth/plugins/invitation-only/index.ts) — invitation-only gate.
- [packages/api/orpc/procedures.ts](../packages/api/orpc/procedures.ts) — the procedure ladder.
- [packages/api/index.ts](../packages/api/index.ts) — Hono app, auth handler mount.
- [apps/saas/modules/auth/lib/server.ts](../apps/saas/modules/auth/lib/server.ts) — `getSession`, `getActiveOrganization`, `getOrganizationList`.
- [apps/saas/modules/auth/lib/api.ts](../apps/saas/modules/auth/lib/api.ts) — client session/passkey queries.
- [apps/saas/modules/auth/components/SessionProvider.tsx](../apps/saas/modules/auth/components/SessionProvider.tsx) — session context.
- [apps/saas/modules/organizations/components/ActiveOrganizationProvider.tsx](../apps/saas/modules/organizations/components/ActiveOrganizationProvider.tsx) — slug ↔ session reconciliation.
- [apps/saas/modules/shared/lib/gating.ts](../apps/saas/modules/shared/lib/gating.ts) — `canSee` / `isEnabled`.
- [apps/saas/modules/shared/lib/gating-server.ts](../apps/saas/modules/shared/lib/gating-server.ts) — `resolveOrgGating`, `assertCanSee`.
- [apps/saas/modules/shared/lib/nav.ts](../apps/saas/modules/shared/lib/nav.ts) — `mapBetterAuthRole`.
- [docs/ARCHITECTURE.md](./ARCHITECTURE.md) §3 — Invariants (tenancy).
- [docs/UX_SPEC.md](./UX_SPEC.md) §2 — gating model.

---

## 10. Change log

- **2026-05-26 — v1 draft.** Initial inventory. Created from the post-foundation
  code review; reflects state of the codebase as of commit `287a300`.
