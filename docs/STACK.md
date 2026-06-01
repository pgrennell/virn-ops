# STACK.md

Canonical technology-stack reference for the Virn Ops codebase — the languages, frameworks,
runtime, monorepo layout, path aliases, and tooling. Consolidated from `agents.md` (Part 2)
and `ARCHITECTURE.md §8` so there is one place to answer "what is this built on?".

**Status:** Draft v1 · **Date:** 2026-06-01 · **Owner:** Paul

> **For AI agents (Claude Code, etc.):** This is the *reference* for stack facts (versions,
> aliases, monorepo shape, tooling commands). It is **descriptive, not normative** — the
> binding conventions live in `agents.md` (Part 2 framework conventions) and
> `ARCHITECTURE.md §6` (schema conventions). When those conflict with this file, they win.
> Load this when you need the stack inventory; load `agents.md` / `ARCHITECTURE.md` when you
> need the rules.

---

## 1. One-line summary

Next.js (App Router) · React 19 · Better Auth (organization plugin) · Drizzle ORM on Postgres
(Neon) · oRPC + Hono · Inngest · TanStack Query/Table · next-intl · Tailwind + shadcn/ui · Zod
· Sentry. Turborepo + pnpm monorepo, `@virn/*` workspace scope. Fresh Supastarter clone with
the Propvana KEEP-list grafts.

---

## 2. Technology stack

The codebase assumes expertise in:

- **TypeScript** — strict typing; interfaces over type aliases for object shapes; avoid `enum`
  (use `as const` maps / union literals).
- **Node.js** — server-side runtime, target **≥ 20**, ESM-compatible imports.
- **Next.js App Router** — React Server Components, layouts, route handlers. Default to RSC;
  add `"use client"` only for interactivity / browser APIs.
- **React 19** — functional components + hooks; named-function exports, no default exports/classes.
- **Better Auth** — authentication (organization plugin, admin plugin, magic link, OAuth,
  passkeys, 2FA, email verification). See `AUTH_CONTRACT.md` for the binding contract.
- **Drizzle ORM** — Postgres via **Neon**. Schema + queries in `packages/database`. Never
  instantiate Drizzle directly in app code.
- **oRPC + Hono** — type-safe RPC layer; HTTP handler mounted in `packages/api`.
- **Inngest** — event/automation runtime (the engine behind ADR-003 automation + scheduled work).
- **TanStack Query / Table** — client-side data fetching, caching, and tables.
- **React Hook Form + Zod** — forms and validation; Zod schemas double as oRPC input contracts.
- **next-intl** — internationalization (scopes: `marketing`, `saas`, `mail`, `shared`).
- **Tailwind CSS + shadcn/ui (Radix)** — utility-first styling + accessible composable primitives.
- **Sentry** — error monitoring.
- **Turborepo + pnpm** — monorepo build orchestration + package management.

---

## 3. Monorepo structure

```
/
├── apps/
│   ├── marketing/               # Marketing site (public pages, blog, changelog)
│   │   ├── app/[locale]/        # App Router routes
│   │   ├── modules/             # Feature modules (home, blog, changelog, shared, analytics)
│   │   ├── content/             # MDX content (legal, blog posts)
│   │   └── tests/               # Playwright E2E tests
│   ├── saas/                    # SaaS application (protected app)
│   │   ├── app/
│   │   │   ├── (unauthenticated)/  # Login, signup, forgot-password
│   │   │   ├── (authenticated)/    # Protected routes, account, organizations
│   │   │   └── api/             # App Router API route handlers
│   │   └── modules/             # Feature modules (auth, organizations, settings,
│   │       │                    #   payments, admin, shared, …)
│   ├── docs/                    # Documentation site
│   └── mail-preview/            # Email template preview
├── packages/                    # Shared backend packages
│   ├── api/                     # oRPC procedures and HTTP handlers
│   ├── auth/                    # Better Auth configuration
│   ├── database/                # Drizzle schema and queries
│   ├── ai/                      # AI integrations
│   ├── i18n/                    # Translations and locale utilities
│   ├── logs/                    # Logging configuration
│   ├── mail/                    # Email providers and templates
│   ├── payments/                # Payment processing (Stripe, etc.)
│   ├── storage/                 # File storage (S3, etc.)
│   ├── ui/                      # Shadcn UI components
│   └── utils/                   # Shared utility functions
└── tooling/                     # Build tooling and shared configs
```

---

## 4. Path aliases & imports

Use package exports, not deep relative imports.

```typescript
// ✅ Good
import { auth } from "@virn/auth";
import { db } from "@virn/database";
import { Button } from "@virn/ui/components/button";
import { config } from "@config";

// ❌ Bad
import { auth } from "../../../packages/auth/auth";
```

**Shared package aliases (monorepo-wide):**

| Alias        | Path            |
| ------------ | --------------- |
| `@virn/*`    | `packages/*`    |
| `@virn/ui/*` | `packages/ui/*` |

**apps/saas:**

| Alias              | Path                                |
| ------------------ | ----------------------------------- |
| `@config`          | `apps/saas/config`                  |
| `@auth/*`          | `apps/saas/modules/auth/*`          |
| `@organizations/*` | `apps/saas/modules/organizations/*` |
| `@settings/*`      | `apps/saas/modules/settings/*`      |
| `@payments/*`      | `apps/saas/modules/payments/*`      |
| `@admin/*`         | `apps/saas/modules/admin/*`         |
| `@ai/*`            | `apps/saas/modules/ai/*`            |
| `@onboarding/*`    | `apps/saas/modules/onboarding/*`    |
| `@shared/*`        | `apps/saas/modules/shared/*`        |
| `@i18n/*`          | `apps/saas/modules/i18n/*`          |

**apps/marketing:**

| Alias                 | Path                                            |
| --------------------- | ----------------------------------------------- |
| `@config`             | `apps/marketing/config`                         |
| `@analytics`          | `apps/marketing/modules/analytics`              |
| `@home/*`             | `apps/marketing/modules/home/*`                 |
| `@blog/*`             | `apps/marketing/modules/blog/*`                 |
| `@changelog/*`        | `apps/marketing/modules/changelog/*`            |
| `@legal/*`            | `apps/marketing/modules/legal/*`                |
| `@shared/*`           | `apps/marketing/modules/shared/*`               |
| `@i18n/*`             | `apps/marketing/modules/i18n/*`                 |
| `content-collections` | `apps/marketing/.content-collections/generated` |

---

## 5. Database & environment

- **Postgres via Neon**, two connection URLs (do not conflate):
  - `DATABASE_URL` — **pooled** (PgBouncer, transaction mode) — app runtime.
  - `DIRECT_URL` — **unpooled/direct** — Drizzle Kit migrations (DDL can't pass through
    PgBouncer transaction mode). See `DECISIONS.md` D-005 and `.env.local.example`.
- **Never run `migrate`/`push` against Neon without explicit confirmation in chat.**
- After any schema change: `pnpm --filter database generate` and show the generated SQL.
- Env var prefixing: server-only = no prefix; client-accessible = `NEXT_PUBLIC_`. Prefer
  app-specific public URLs such as `NEXT_PUBLIC_SAAS_URL`. Never commit secrets.

---

## 6. Tooling & quality

```bash
pnpm dev                          # Start development server
pnpm build                        # Build all packages
pnpm lint                         # Run linting (Oxlint)
pnpm format                       # Format code (Oxfmt)
pnpm --filter database generate   # Generate Drizzle migrations from schema
```

- **Package manager:** pnpm. Workspace-wide commands via **Turbo**. Prefer the workspace
  `catalog:` versions in `pnpm-workspace.yaml` when a dependency is already managed there.
- **Lint / format:** **Oxlint** + **Oxfmt**. Lint and format before committing.
- **Testing:** **Vitest** (unit) across the workspace; **Playwright** E2E in
  `apps/marketing/tests` and `apps/saas/tests`.
- **Two-tier safety check:**
  - `pnpm safety-check` — type-check + vitest across the workspace (~15–20s). Run on any PR.
  - `pnpm safety-check:auth` — `safety-check` + the Playwright E2E auth suite (~5–10min). Run
    **only** when the PR touches auth-adjacent paths (see `AUTH_CONTRACT.md §8`).
- **Target:** Node.js ≥ 20 with ESM-compatible imports.

---

## 7. Related references

- `agents.md` **Part 2** — the binding framework conventions (RSC patterns, oRPC procedure
  shapes, forms, i18n, naming, perf) that this file inventories.
- `ARCHITECTURE.md §6` — schema conventions (PKs, timestamps, money, polymorphism, enums vs
  lookups). `§8` — the one-line stack reference this file expands.
- `AUTH_CONTRACT.md` — the Better Auth surface + oRPC procedure ladder + tenancy contract.
- `CONFIGURATION.md` — the capability/setting registry + resolver.
- `DECISIONS.md` D-004 (Drizzle is the sole ORM), D-005 (Neon dual-URL).
