# Post-Foundation Code Review — Retrospective

**Date:** 2026-05-26
**Scope:** Whole repo, immediately after the UI foundation pass (app shell, gating helpers, route scaffolding)
**Reviewers:** Three parallel `general-purpose` agents covering `apps/saas`, `packages/api` + `packages/auth`, and `packages/database` + `tooling/scripts`
**Companion docs:** [AUTH_CONTRACT.md](../AUTH_CONTRACT.md) (normative), [ARCHITECTURE.md](../ARCHITECTURE.md), [CODE_REVIEW.md](../../CODE_REVIEW.md) (upstream Supastarter baseline, 2026-04-24)

---

## 1. Summary

Eight batches shipped. One safety stack built. One database migration applied to Neon. Type-check + vitest + Playwright auth suite all green at session close.

The starting point: the UI foundation had just landed (AppShell, Sidebar, gating helpers, route scaffolding under `[organizationSlug]`). The review surfaced ~50 distinct findings; this doc records what was fixed, where to find each change, and what was deliberately deferred.

The biggest single shifts:
- **Payments IDOR closed** (three procedures that accepted `organizationId` from input without membership checks)
- **Gating helper hardened** (no silent operator fallthrough for non-members; clean redirect contract)
- **Run engine made atomic** (transactionalized; cascade race resolved by `WHERE status='active'` + boolean return)
- **One shell stack** across the entire authenticated app (org + account routes share the same chrome + nav primitives)
- **Schema integrity tightened** (polymorphic CHECK constraints, audit_log NOT NULL, missing timestamps backfilled, 7 new indexes, partial schedule index)
- **Safety stack** that makes future regressions surface in CI before they ship

---

## 2. The eight batches

### Batch A — Payments IDOR cluster · HIGH security · no migration

Three procedures took `organizationId` from input with no membership check.

| Fix | File | What |
|---|---|---|
| A1 | [list-purchases.ts:21](../../packages/api/modules/payments/procedures/list-purchases.ts#L21) | Stays on `protectedProcedure` (dual-mode billing preserved). When `organizationId` is provided, explicit `getOrganizationMembership` check → 403 on miss. |
| A2 | [create-checkout-link.ts:31](../../packages/api/modules/payments/procedures/create-checkout-link.ts#L31) | Same dual-mode preservation + when org-scoped, requires `membership.role === "owner" \|\| "admin"`. |
| A3 | [create-logo-upload-url.ts](../../packages/api/modules/organizations/procedures/create-logo-upload-url.ts) | Switched to `adminOrgProcedure`. Org id from session context, never input. Dead `verifyOrganizationMembership` helper + its test deleted. |
| A4 | [validate-redirect-url.ts](../../packages/api/modules/payments/lib/validate-redirect-url.ts) (new) + checkout/portal procedures | `assertSameOriginRedirect` — allows relative paths or absolute URLs matching `NEXT_PUBLIC_SAAS_URL` origin; rejects everything else. |
| A5 | [stream-message.ts](../../packages/api/modules/ai/procedures/stream-message.ts) | `z.array(z.any() as z.ZodType<UIMessage>)` → `z.custom<UIMessage>(value => role enum check).min(1).max(200)`. Real runtime validation; SDK typing preserved. |

The cross-org IDOR Playwright test in [tests/org/cross-org-idor.spec.ts](../../apps/saas/tests/org/cross-org-idor.spec.ts) was tightened from a soft annotation to a hard `expect(status).toBeGreaterThanOrEqual(400)` against the owner's real org id (looked up via new `getOrganizationIdBySlug` helper).

**Trap to remember:** Supastarter's `paymentsConfig.billingAttachedTo` supports both `"user"` and `"organization"` modes. The naive fix ("drop `organizationId` from input, use `protectedOrgProcedure`") would have broken user-attached billing entirely. Preserve the dual mode — verify membership *when* org id is provided, fall back to user scope when not.

### Batch B — Gating helper hardening · HIGH correctness · no migration

| Fix | File | What |
|---|---|---|
| B1 | [gating-server.ts:16-26](../../apps/saas/modules/shared/lib/gating-server.ts#L16-L26) | `resolveGatingSnapshotFor` returns `null` for non-members instead of silently mapping to `operator`. AUTH_CONTRACT.md §6 #15 now pinned. |
| B2 | [gating-server.ts:64-79](../../apps/saas/modules/shared/lib/gating-server.ts#L64-L79) | `assertCanSee` does its own `getSession()` check first. Missing session → `redirect("/login")`. Missing org/membership → `notFound()`. No more redirect-loop into the same protected route. |
| B3 | [[organizationSlug]/page.tsx](../../apps/saas/app/(authenticated)/(main)/(organizations)/%5BorganizationSlug%5D/page.tsx) | Org root now prefers the first **NOW-phase** area. Admins no longer land on `/home` (a `defer-design` placeholder) — they land on Library or Configuration. |
| B4 | [[organizationSlug]/layout.tsx](../../apps/saas/app/(authenticated)/(main)/(organizations)/%5BorganizationSlug%5D/layout.tsx) | Dropped duplicated `members.find().role` + `mapBetterAuthRole` derivation. Layout passes `snapshot.role` directly. Single source of truth. |

### Batch F — Auth surface hardening · MEDIUM/HIGH security · no migration

| Fix | File | What |
|---|---|---|
| F1 | [config.ts:10](../../packages/auth/config.ts) + [auth.ts:46](../../packages/auth/auth.ts#L46) | Session lifetime **30d → 7d**; `freshAge` **0 → 1d**. Fresh-session-required endpoints (change-password, change-email, delete-user, etc.) refuse stale sessions. |
| F2 | [auth.ts:225](../../packages/auth/auth.ts#L225) | `magicLink.disableSignUp` bound to `!config.enableSignup`. When invitation-only mode is on, magic-link signup is auto-disabled. Closes the §7.4 bypass. |
| F3 | [auth.ts before-hook](../../packages/auth/auth.ts) | Subscription cancellation stays in `before` (because `purchase` cascade-deletes with user/org — `after` can't see them), but now explicitly authorizes the caller first: session required; for `/organization/delete`, caller must be owner. Malformed/unauthorized requests throw `APIError("FORBIDDEN")` before any Stripe side-effect. |
| F4 | [generate-organization-slug.ts:9](../../packages/api/modules/organizations/procedures/generate-organization-slug.ts#L9) + [its test](../../packages/api/modules/organizations/procedures/generate-organization-slug.test.ts) | `publicProcedure` → `protectedProcedure`. No unauthenticated slug enumeration. Test updated with a new "throws UNAUTHORIZED" assertion. |

The snapshot test ([config.snapshot.test.ts](../../packages/auth/config.snapshot.test.ts)) caught the F1 changes immediately and required deliberate re-snapshotting — exactly the regression net working as designed.

### Batch G — Run engine transactions · MEDIUM correctness · no migration

New infrastructure: [`DbExecutor` type + `withTransaction` helper](../../packages/database/drizzle/client.ts) on the client so libs don't import `db` directly.

Query helpers ([queries/runs.ts](../../packages/database/drizzle/queries/runs.ts)) now accept an optional `executor: DbExecutor = db` parameter — standalone calls work unchanged, transaction-scoped callers pass `tx`.

**Key change:** `markRunCompleted` signature changed from `Promise<void>` to `Promise<boolean>`, only updates rows where `status = 'active'`. This is the G3 race-resolver: when two concurrent calls both observe "all required steps complete," only the first UPDATE matches a row; the loser sees `false` and skips the cascade audit. No row-locking required — Postgres's UPDATE row lock handles it.

Lib code:
- [complete-step.ts](../../packages/api/modules/runs/lib/complete-step.ts): writes wrapped in `withTransaction`, parallelizes `getRequiredFieldsForStep` and `findIncompleteStopDependencies` (independent reads), uses `markRunCompleted` boolean to gate cascade audit.
- [set-field-value.ts](../../packages/api/modules/runs/lib/set-field-value.ts): upsert + audit/activity wrapped in `withTransaction`.

Test added: ["does not emit cascade audit when markRunCompleted loses the race (G3)"](../../packages/api/modules/runs/lib/complete-step.test.ts) — explicitly exercises the race-loser path.

### Batch C — Shell consolidation · MEDIUM maintainability · no migration

Result: **one shell rendering stack** across the authenticated app, parameterized by context.

| Fix | File | What |
|---|---|---|
| Generic Sidebar | [Sidebar.tsx](../../apps/saas/modules/shared/components/Sidebar.tsx) | Refactored to take `groups: SidebarNavGroup[]`, `homeHref: string`, `showOrgSwitcher?: boolean`. `ICON_MAP` extended. |
| Optional org context | [TopBar.tsx](../../apps/saas/modules/shared/components/TopBar.tsx) | `org` prop is optional. Without it, the Create menu + admin-all-access badge don't render. |
| AppShell (org routes) | [AppShell.tsx](../../apps/saas/modules/shared/components/AppShell.tsx) | Resolves org-specific groups via `canSee` filtering; accepts `initialCollapsed`. |
| AccountShell (account/admin/chatbot/not-found) | [AccountShell.tsx](../../apps/saas/modules/shared/components/AccountShell.tsx) (new) | Passes `ACCOUNT_NAV_GROUPS` + conditional `PLATFORM_ADMIN_NAV_GROUP`. |
| Account nav defs | [nav.ts](../../apps/saas/modules/shared/lib/nav.ts) | Added `ACCOUNT_NAV_GROUPS`, `PLATFORM_ADMIN_NAV_GROUP`, related types. |
| Server cookie hydration | [sidebar-context.tsx](../../apps/saas/modules/shared/lib/sidebar-context.tsx) | `SidebarProvider` accepts `initialCollapsed` from layouts that read the cookie via `next/headers.cookies()` — no more 280px → 80px flash on first paint. Context value memoized (closed J4 as a side benefit). |
| CreateMenu Link fix | [CreateMenu.tsx](../../apps/saas/modules/shared/components/CreateMenu.tsx) | `<a href>` → Next `<Link href prefetch>`. No more full-page reload on Create actions. |
| Deletions | — | `NavBar.tsx` (498 lines) and `AppWrapper.tsx` removed. |
| Migrated layouts | [(account)/layout.tsx](../../apps/saas/app/(authenticated)/(main)/(account)/layout.tsx), [not-found.tsx](../../apps/saas/app/(authenticated)/not-found.tsx) | Both use `AccountShell` with server-hydrated `initialCollapsed` + `isPlatformAdmin`. |

### Batch I — Maintainability sweep · LOW · no migration

Eight items plus one bonus orphan-dir cleanup:

| ID | What |
|---|---|
| bonus | Deleted stray `apps/saas/modules/lib/sidebar-context.tsx` — duplicate from a previous refactor that nothing imported. |
| I1 | Deleted `packages/database/drizzle/schema/mysql.ts` + `sqlite.ts` — Postgres-only project. |
| I2 | `OrganzationSelect` → `OrganizationSelect` (missing `i`). 4 sites updated. |
| I3 | `SettingDataType` derived from `settingDataType` pgEnum; `FieldType` derived from `fieldType` pgEnum. Duplicate `FieldTypeEnum` export removed. |
| I4 | Notification enum derived from `NotificationType`/`NotificationTarget` const-objects in `@virn/database`. Hand-maintained `z.enum(["WELCOME","APP_UPDATE"])` gone — adding a new notification type now auto-propagates through the API surface. |
| I5 | Dropped duplicate `getOrganizationById` export in `list-organizations.ts` (`findOrganization` is the wired one). Bonus: parallelized `getOrganizations` + `countAllOrganizations`, and same for `listUsers`. |
| I6 | `configRouter` + `runsRouter` use plain-object composition matching the other 5 module routers. `publicProcedure.router({...})` wrapper removed (it misleadingly read as "this whole router is public"). |
| I7 | Dropped unused `setIsCollapsed` from sidebar context surface. |
| I8 | `CAPABILITIES` in `nav.ts` now `satisfies Record<string, ProfileCapabilityKey>`. The new `ProfileCapabilityKey` type (exported from `@virn/database`) is derived from `PROFILES` — renaming a key there causes a compile error wherever it's referenced. |

### Batch J — Performance polish · LOW · no migration

| ID | What | Where |
|---|---|---|
| J1 | `staleTime: 30_000` on unread-count query | [NotificationCenter.tsx:41](../../apps/saas/modules/shared/components/NotificationCenter.tsx#L41) |
| J2 | Mark-read effect tracks dispatched IDs via `useRef<Set>` to short-circuit the post-invalidation re-render | [NotificationCenter.tsx:86-109](../../apps/saas/modules/shared/components/NotificationCenter.tsx#L86-L109) |
| J3 | (Closed in C as side benefit — Sidebar groups memoized via `useMemo` in AppShell/AccountShell) | |
| J4 | (Closed in C — `SidebarProvider` value memoized) | |
| J5 | `(main)/layout.tsx` uses `@payments/lib/server`'s `cache()`-wrapped `listPurchases` instead of raw `.callable()`. Request-scoped dedup with the `(org)` layout — single DB roundtrip per request. | [(main)/layout.tsx:38-43](../../apps/saas/app/(authenticated)/(main)/layout.tsx#L38-L43) |
| J6 | `getEffectiveSettingValue` rewritten as a targeted single-row query. Was previously running the full multi-join resolver + `.find()`. | [config.ts:227-275](../../packages/database/drizzle/queries/config.ts#L227-L275) |
| J7 | `useMediaQuery` initial state resolved synchronously from `window.matchMedia` in a lazy `useState` initializer. No more "assume desktop" flash. | [use-media-query.ts](../../apps/saas/modules/shared/hooks/use-media-query.ts) |
| J8 | `planId` in `createCheckoutLink` validated via `z.enum(Object.keys(paymentsConfig.plans))` at the boundary. Typos surface as input-validation errors instead of slipping through. | [create-checkout-link.ts](../../packages/api/modules/payments/procedures/create-checkout-link.ts) |

### Batch D + E + H — Schema migrations · MIGRATION applied to Neon

One migration: `packages/database/drizzle/migrations/0001_overrated_green_goblin.sql`. Applied 2026-05-26 via Drizzle Kit through `DIRECT_URL`. Schema and DB now in sync ("No schema changes, nothing to migrate" on rerun).

**D — Integrity:**
- D1: `audit_log.entity_type` and `entity_id` are NOT NULL.
- D2: CHECK `length(entity_id) > 0` on the five polymorphic tables (`audit_log`, `activity_event`, `attachment`, `comment`, `taggable`). _shared.ts's "polymorphic FK + CHECK" mandate is now enforced at the DB.
- D3: Doc-only — [ARCHITECTURE.md §3 Invariant #2](../ARCHITECTURE.md) now lists `template_category` alongside the existing cross-tenant whitelist (it was always platform-global by design but wasn't listed).
- D4: `template_listing.publisher_organization_id` FK is now `ON DELETE restrict`. Deleting a publisher org requires explicit cleanup of their listings first — no silent first-party conversion.

**E — Missing `...timestamps`:**
Added `created_at` + `updated_at` (both `DEFAULT now() NOT NULL`) to 9 tables that had drifted from the shared convention: `field`, `section`, `step`, `step_dependency`, `run_step`, `run_step_assignee`, `run_role_assignment`, `automation_action`, `automation_condition`.

**H — Query performance:**
| Index | Where | Why |
|---|---|---|
| `idx_run_org_status_due (organization_id, status, due_at)` | `run` | "Active runs in org by due date" — most-common UI list. |
| `idx_run_step_status_due (status, due_at)` | `run_step` | "My tasks by due date." |
| `idx_suggestion_org_status (organization_id, status)` | `suggestion` | "Open suggestions in my org." |
| `idx_field_value_run_step (run_step_id)` | `field_value` | Per-step value lookups. |
| `idx_run_step_assignee_participant (participant_id)` | `run_step_assignee` | Reverse-direction queries (the unique covers the forward direction). |
| `idx_run_role_assignment_participant (participant_id)` | `run_role_assignment` | Same. |
| `idx_schedule_next_run` (partial: `WHERE is_active = true AND next_run_at IS NOT NULL`) | `schedule` | Cron sweeper only scans this subset; partial index is dramatically smaller. |

**H6 (code-only, not in migration):** [`getHomeCountsForUser`](../../packages/database/drizzle/queries/runs.ts) rewritten as `COUNT(*) FILTER` SQL aggregation in parallel with the active-run count. Was previously fetching every pending task row for the user to count three buckets in JS.

---

## 3. The safety stack

Built progressively across the session to prevent regressions on the surfaces we just fixed.

| Layer | Lives at | What it catches |
|---|---|---|
| **Normative contract** | [docs/AUTH_CONTRACT.md](../AUTH_CONTRACT.md) | Documents every Supastarter/Better-Auth feature in use, Virn extensions, the §6 critical invariants, the procedure ladder (§3), the tenancy chain (§4), known sharp edges (§7), pre-merge checklist (§8). Pointed-to from [agents.md](../../agents.md) so future Claude sessions read it before touching auth code. |
| **Config snapshot test** | [packages/auth/config.snapshot.test.ts](../../packages/auth/config.snapshot.test.ts) | Pins 15 config-shaped invariants from §6 via inline `toMatchInlineSnapshot`. Mocks workspace imports so it runs without DB or env. Caught F1's session-length changes on first run — required deliberate re-snapshotting. |
| **Bidirectional slug invariants** | [packages/auth/config.invariants.test.ts](../../packages/auth/config.invariants.test.ts) | Walks `apps/saas/app/` for concrete top-level URL segments and asserts each is in `forbiddenOrganizationSlugs`. Also reverse-checks: every forbidden slug either matches a route or is in `INTENTIONALLY_RESERVED_SLUGS` (which currently holds only `ai-demo`). Caught 10 missing forbidden slugs on first run. |
| **E2E auth suite** | [apps/saas/tests/](../../apps/saas/tests/) + [README](../../apps/saas/tests/README.md) | 10 Playwright tests: signup-and-verify, password login (+ wrong-password), magic link, password reset, logout, org create-and-switch, cross-org IDOR. Token extraction happens via direct DB queries on the `verification` table (no SMTP intercept needed). Cross-org IDOR test hard-asserts after Batch A landed. |
| **Two-tier safety-check scripts** | Root [package.json](../../package.json) | `pnpm safety-check` (turbo type-check + test, ~15-20s) for every PR. `pnpm safety-check:auth` (chains safety-check then the E2E Playwright suite, ~5-10min) for auth-adjacent PRs only. AUTH_CONTRACT.md §8 names these scripts in the pre-merge checklist. |

**The mental model:** the contract names what shouldn't change; the snapshot freezes the values it can; the invariants test enforces what the snapshot can't; the E2E suite verifies the Supastarter feature set still works end-to-end. The scripts wrap it up so it's not on you to remember.

---

## 4. The migration in one place

[packages/database/drizzle/migrations/0001_overrated_green_goblin.sql](../../packages/database/drizzle/migrations/0001_overrated_green_goblin.sql) — 35 statements:

- 1 FK drop + readd (D4: `template_listing.publisher_organization_id` set-null → restrict)
- 1 index drop + readd as partial (H5: `schedule.next_run_at`)
- 2 NOT NULL conversions (D1: audit_log `entity_type`, `entity_id`)
- 18 column adds (E: `created_at` + `updated_at` × 9 tables)
- 6 plain indexes (H1, H2, H3, H4 × 2)
- 5 CHECK constraints (D2: polymorphic entity_id non-empty × 5 tables)
- 1 partial index (H5)

Applied successfully via `pnpm --filter @virn/database migrate` (uses `DIRECT_URL` per [drizzle.config.ts](../../packages/database/drizzle/drizzle.config.ts) — Neon PgBouncer in transaction mode can't run DDL).

If you ever need to roll this back manually: the inverse SQL is straightforward (drop the constraints/indexes, restore the FK to `set null`, drop the columns, restore audit_log columns to nullable). Drizzle doesn't auto-generate a down migration — write it by hand if needed.

---

## 5. Deliberately deferred

These were considered, sized, and *not* done. Recording so they don't get lost.

| Item | Why deferred | Where to pick it up |
|---|---|---|
| **J9 — RSC AppShell with client islands** | High blast radius (full restructure of the shell into server + client boundary). Worth its own session. | Currently AppShell + AccountShell are `"use client"` end-to-end. The fix is to push only the truly-interactive bits (toggle, mobile sheet, menus) into client islands. |
| **OAuth E2E** | Needs test accounts in Google/GitHub developer consoles, or a `socialProviders` mock layer. | Add to `apps/saas/tests/auth/` once test-account infra exists. |
| **2FA E2E** | Needs secret extraction + TOTP code generation in helpers. | Use `otplib` in `tests/__helpers/auth.ts`. |
| **Passkey E2E** | Needs Playwright's `virtualAuthenticator` setup via CDP. | Set up the virtual authenticator fixture, enroll + sign in. |
| **Invitation flow E2E** | Needs invitation-token extraction (separate from the `verification` table — it's `invitation`) and a second browser context per test. | The pattern is the same as magic-link extraction; just a different table. |
| **Subscription checkout E2E** | Needs Stripe test mode keys reachable from CI; both billing modes need separate tests. | Tighten the cross-org IDOR test's `listPurchases` probe once this lands — it's currently the only Stripe-touching assertion. |
| **Change role / remove member / leave / delete org** | Depends on invitation flow E2E for setup. | Mechanical follow-ups. |
| **Email change verification E2E** | Same `verification` table pattern as the existing flows. | Straightforward. |
| **ADR-004 — custom org roles** | The Builder/Operator/Reviewer roles spec'd in UX_SPEC.md §4.4 aren't in the schema yet. [nav.ts:`mapBetterAuthRole`](../../apps/saas/modules/shared/lib/nav.ts) is the bridge — `member → operator` until the data layer ships. | When custom roles land, change the mapper in one place; no other UI code needs to change. |
| **Granular per-action permission matrix UI** | Area-level access ships first per UX_SPEC §4.4 MVP cut. | Members & Roles screen, future iteration. |
| **`down` migration for 0001** | Drizzle doesn't auto-generate; not needed unless we hit a rollback scenario. | Write by hand if needed; structure is symmetric. |

---

## 6. Non-obvious decisions worth remembering

A few choices in this session that aren't obvious from reading the resulting code.

### Subscription cancellation stays in `before` (not `after`) hook
Per AUTH_CONTRACT.md §7.5. The `purchase` table has `onDelete: "cascade"` on both `user.id` and `organization.id` FKs (schema/auth.ts:254-259), so by the time the `after` hook fires, the rows are gone — we can't read what to cancel. The fix was *not* to move the hook, but to add an explicit owner-check (for `/organization/delete`) and session-required check (for `/delete-user`) *before* the cancellation runs. If the cascade behavior on `purchase` ever changes to `set null` or `restrict` (would require a migration), this can move to `after` and the explicit auth check becomes redundant.

### `disableSignUp` bound to `!enableSignup`, not hardcoded
Per AUTH_CONTRACT.md §6 #2. When invitation-only mode is on (`enableSignup === false`), magic-link signups to unknown emails *also* need to be refused — otherwise the invitation gate is bypassable. Better Auth's built-in `disableSignUp` flag handles this; binding it to `!config.enableSignup` means flipping signup off auto-disables magic-link signup too. No extra invitation-only plugin extension required for the magic-link path.

### `markRunCompleted` returns boolean (the race resolver)
The `WHERE status = 'active'` clause on the UPDATE makes the cascade self-synchronizing — two concurrent "complete the last step" calls both observe `areAllRequiredRunStepsComplete === true`, but only one's UPDATE matches a row. The loser sees `false` and skips the cascade audit. Postgres's UPDATE row lock does the work; no explicit lock acquisition needed.

### Generic Sidebar accepts groups via prop (not via `canSee` import)
Sidebar.tsx no longer knows about `NAV_GROUPS` or `canSee`. AppShell/AccountShell resolve their respective group structures and pass them in. This means the Sidebar component can render any nav (org-scoped, account-scoped, future role-preview shell, etc.) without changes.

### `INTENTIONALLY_RESERVED_SLUGS` allowlist on the invariants test
The bidirectional slug check would have failed on `ai-demo` (no route, but in forbidden list). Rather than removing the entry (the user explicitly wanted to keep it for the future AI-demo route), the test has an `INTENTIONALLY_RESERVED_SLUGS` Set as an escape hatch. Each entry needs a comment explaining why it's there. When the route lands, the allowlist entry comes with it.

### `template_category` is platform-global by design
Per ARCHITECTURE.md §3 Invariant #2 (updated this session). The comment in [library.ts:38-40](../../packages/database/drizzle/schema/library.ts#L38-L40) explicitly states this; the cross-tenant whitelist now lists it alongside `template_listing(_version)` and `solution_pack(_version)`. The invariants test will catch any future tenant-owned table that omits `organizationId` and isn't in this whitelist.

### `DbExecutor` + `withTransaction` over `db.transaction` directly
Lib code (`packages/api/modules/runs/lib/*`) doesn't import `db` from `@virn/database` — it imports `withTransaction`. Keeps the data-access layer encapsulated; the lib doesn't know about the Drizzle client at all. Mutation helpers in `queries/runs.ts` accept `executor: DbExecutor = db` as the optional last parameter — standalone calls work unchanged, transactional callers pass `tx`.

---

## 7. Where to look first if something breaks

If a test fails or a behavior regresses, this is the priority order for investigation:

1. **AUTH_CONTRACT.md §6** — has any pinned invariant changed?
2. **`pnpm safety-check`** — does the fast tier (type-check + vitest) still pass?
3. **`packages/auth/config.snapshot.test.ts`** — has the snapshot diffed unintentionally?
4. **`packages/auth/config.invariants.test.ts`** — has a route been added without forbidding its slug, or a forbidden slug orphaned?
5. **`pnpm --filter @virn/auth test`** — both auth tests pass?
6. **`pnpm safety-check:auth`** — does the full E2E auth suite still pass? (only run for auth-adjacent changes; slower)
7. **`apps/saas/tests/org/cross-org-idor.spec.ts`** — does the IDOR defense still hold?

---

## 8. Pointers to the work

- [agents.md](../../agents.md) — entry point for any AI agent working in this repo
- [docs/ARCHITECTURE.md](../ARCHITECTURE.md) §3 Invariants — non-negotiable rules (updated this session: §3 #2 whitelist)
- [docs/AUTH_CONTRACT.md](../AUTH_CONTRACT.md) — normative auth contract (new this session)
- [docs/UX_SPEC.md](../UX_SPEC.md) §2 — gating model
- [docs/Configuration.md](../Configuration.md) — capability/setting resolver
- [packages/auth/config.snapshot.test.ts](../../packages/auth/config.snapshot.test.ts) — config invariants snapshot
- [packages/auth/config.invariants.test.ts](../../packages/auth/config.invariants.test.ts) — bidirectional slug check
- [apps/saas/tests/README.md](../../apps/saas/tests/README.md) — E2E auth suite catalog
- [packages/database/drizzle/migrations/0001_overrated_green_goblin.sql](../../packages/database/drizzle/migrations/0001_overrated_green_goblin.sql) — the schema migration applied this session

---

## 9. Change log

- **2026-05-26 — Session retrospective written.** Captures the post-foundation review and the eight batches shipped (A, B, C, F, G, I, J, D+E+H). Companion to AUTH_CONTRACT.md (normative) and CODE_REVIEW.md (upstream Supastarter baseline from 2026-04-24).
