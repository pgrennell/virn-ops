# Coding Agent Guidelines — Virn

Project context and coding conventions for AI agents working on the Virn Ops codebase. Read this
first, every session. The "Virn orientation" half (top) is project-specific and authoritative;
the "Framework conventions" half (bottom) covers cross-cutting Next.js / oRPC / Better Auth /
UI / forms / i18n patterns inherited from the supastarter base.

---

# Part 1 — Virn orientation

## What this is

**Virn Ops** is the **operating system for property operations** — turnover, inspections,
maintenance routing, vendor & tenant onboarding — built on a substrate where **one
authored procedure runs three ways**: as a human checklist, an AI-assisted checklist, or a
fully automated agent run. Same content, same audit trail, the operator chooses the mode
per run. This — one procedure, three execution modes (STRATEGY S-07) — is the headline
product story.

The **v1 vertical is locked to property operations**, with STR turnover & housekeeping as
the concrete first shape. Concentric expansion within property ops (inspections,
maintenance, onboarding) comes before any second-vertical jump. See DECISIONS.md D-021
for the pivot rationale; do not treat "marketing ops" or "compliance SOPs" as v1 packs —
they are post-v1 (STRATEGY S-11).

The **engine underneath** is enterprise-grade, multi-tenant infrastructure for recurring
checklists, SOP/policy knowledge bases, workflow automation, and an **agent-native action
surface (MCP)**. It is architected to support multiple process-shaped products (marketing
ops, agency ops, compliance, HR) as solution packs the ServiceNow way — but that
platform-of-products moat is **long-term destination**, not v1 public framing. Win
property ops first; the pack model repeats the win post-v1.

ERP-class apps like **Virn PM** (property management, formerly Propvana) are *separate
apps on the shared foundation*, not packs on Ops. See `docs/ARCHITECTURE.md` §1 and
`docs/BRANDING.md` for the product family layout.

## Read before working (in order)

1. `docs/ARCHITECTURE.md` — the foundation. **§3 (Invariants) are non-negotiable.** §5/§6 define
   the domain model and conventions; §7 is the MVP scope matrix.
2. `docs/BUILD_PLAN.md` — the phased roadmap and what to build next.
3. `packages/database/drizzle/schema/*.ts` — the existing schema. Match its style **exactly**
   when adding tables.

## Read before touching auth-adjacent code

If your change touches any of: `packages/auth/**`, `packages/api/orpc/**`, oRPC procedures under
`packages/api/modules/**`, `apps/saas/modules/auth/**`, `apps/saas/modules/organizations/**`, the
`(authenticated)` route-group layouts, the gating helpers in `apps/saas/modules/shared/lib/`, the
auth/org schema files, or `packages/payments/**` — **read `docs/AUTH_CONTRACT.md` first**. It
documents what Supastarter/Better Auth ships, what Virn extends, and the pinned invariants that
must not silently change. Use its §8 pre-merge checklist before requesting review.

## Read before scope or prioritization decisions

For any **product, scope, or prioritization** call — "should we build X now, defer it, or cut
it?", "what does this screen need to be competitive?", "are we feature-matching or
differentiating?", "is this feature in or out of MVP?" — **read `docs/STRATEGY.md` first**. It
holds the competitive positioning (the AI-native cohort + property-vertical comps that
matter today — *not* the legacy four-product reference set that's now demoted to historical
data-shape lessons in Appendix A) and the live S-0x strategic bets that should inform build
sequencing. It is *subordinate to* `ARCHITECTURE.md` — a bet may argue for promoting a
reserved seam, but it can never override an Invariant (§3) or an ADR. When a bet is acted on,
record the implementation in `docs/DECISIONS.md` referencing the bet (e.g., `per STRATEGY
S-02`), and update `docs/BUILD_PLAN.md` if the phase ordering changes. The 2026-05-26 pivot
that re-anchored both is recorded as **D-021**.

## Two safety-check tiers

- `pnpm safety-check` — fast tier (type-check + vitest across the workspace, ~15–20s). Run this
  on any PR.
- `pnpm safety-check:auth` — full tier (`safety-check` + the Playwright E2E auth suite, ~5–10min).
  Run this **only when the PR touches the auth-adjacent paths above**.

Don't run `safety-check:auth` for unrelated changes — it's slow and unnecessary. Don't skip it
when auth is touched — that's the whole point.

## Stack

Next.js (App Router) · Better Auth (organization plugin) · Drizzle ORM on Postgres (Neon) ·
oRPC + Hono · Inngest · TanStack Query/Table · next-intl · Tailwind + shadcn/ui · Zod.
Turborepo + pnpm monorepo. Workspace scope: `@virn/*`.

## Conventions (full detail in ARCHITECTURE.md §6)

- cuid text PKs via the `id()` helper in `_shared.ts`; `timestamps`, `softDelete`, `orgId()`
  helpers live there too — use them, don't reinvent.
- One file per domain group; each file exports its `pgTable`(s) **and** `relations()`, all
  re-exported from `schema/postgres.ts`.
- `pgEnum` for closed sets; a lookup table (+ a `_translations` side table) for growable sets.
- Polymorphic tables: the shared `entityType` enum + a plain `entity_id` text column + a CHECK —
  never a bare FK.
- Three-bucket deletes: `deletedAt` (user-deletable), `lifecycleStatus` (lifecycle entities),
  append-only (audit/governance).

## Invariants (do not violate — see ARCHITECTURE.md §3)

1. Every tenant-owned row carries `organizationId NOT NULL`. The only cross-tenant exceptions are
   `template_listing(_version)` and platform-owned `solution_pack(_version)`.
2. Definition (workflow / version / step / field) and execution (run / run_step / field_value)
   stay separate; a run is created by **snapshotting** a published version.
3. Fields are referenced by stable `key`, never by label.
4. Audit and governance tables are append-only.

## House rules

- Match the existing schema files' style; do not invent new conventions.
- **Never write real secrets into files** — reference env var names only.
- **Never run `migrate`/`push` against Neon without explicit confirmation in chat.** Migrations
  use the DIRECT (unpooled) Neon URL (`DIRECT_URL`); the app runtime uses the pooled URL
  (`DATABASE_URL`). DDL cannot pass through Neon's PgBouncer in transaction mode — running
  `drizzle-kit` against the pooled URL in production will fail. See `.env.local.example`.
- After any schema change, run `pnpm --filter database generate` and show the generated SQL.
- Work in small, reviewable increments. Append notable decisions to `docs/DECISIONS.md`.
- Ask before assuming on anything ambiguous.

---

# Part 2 — Framework conventions

> Cross-cutting Next.js / oRPC / Better Auth / UI / forms / i18n conventions. Where these
> conflict with Part 1 or `docs/ARCHITECTURE.md`, Virn-specific guidance wins.

## Technology stack

You are an expert in:

- **TypeScript** – Strict typing, interfaces over type aliases
- **Node.js** – Server-side runtime (≥20)
- **Next.js App Router** – React Server Components, layouts, route handlers
- **React** – Functional components, hooks
- **Shadcn UI & Radix** – Accessible, composable primitives
- **Tailwind CSS** – Utility-first styling
- **oRPC** – Type-safe RPC layer
- **Better Auth** – Authentication with passkeys, magic links, organizations
- **Drizzle** – Database ORM (Postgres via Neon)
- **React Hook Form + Zod** – Forms and validation
- **TanStack Query** – Client-side data fetching and caching

## Architecture overview

### Monorepo structure

```
/
├── apps/
│   ├── marketing/               # Marketing site (public pages, blog, changelog)
│   │   ├── app/[locale]/        # App Router routes
│   │   ├── modules/             # Feature modules
│   │   │   ├── home/            # Home page components
│   │   │   ├── blog/            # Blog components
│   │   │   ├── changelog/       # Changelog components
│   │   │   ├── shared/          # Cross-cutting components
│   │   │   └── analytics/       # Analytics providers
│   │   ├── content/             # MDX content (legal, blog posts)
│   │   └── tests/               # Playwright E2E tests
│   ├── saas/                    # SaaS application (protected app)
│   │   ├── app/                 # App Router routes
│   │   │   ├── (unauthenticated)/  # Login, signup, forgot-password
│   │   │   ├── (authenticated)/    # Protected routes, account, organizations
│   │   │   └── api/             # API route handlers
│   │   └── modules/             # Feature modules
│   │       ├── auth/            # Authentication components
│   │       ├── organizations/   # Organization management
│   │       ├── settings/        # User & account settings
│   │       ├── payments/        # Billing & subscriptions
│   │       ├── admin/           # Admin panel
│   │       ├── shared/          # Cross-cutting components
│   │       └── ...
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

### Import conventions

Use package exports instead of deep relative imports:

```typescript
// ✅ Good
import { auth } from "@virn/auth";
import { db } from "@virn/database";
import { Button } from "@virn/ui/components/button";
import { cn } from "@virn/ui";
import { orpcClient } from "@shared/lib/orpc-client";
import { config } from "@config";

// ❌ Bad
import { auth } from "../../../packages/auth/auth";
```

### Path aliases

Path aliases are configured per app. Shared package aliases apply across the monorepo:

| Alias        | Path            |
| ------------ | --------------- |
| `@virn/*`    | `packages/*`    |
| `@virn/ui/*` | `packages/ui/*` |

**apps/saas** – SaaS application:

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

**apps/marketing** – Marketing site:

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

## Core coding principles

### TypeScript

- Write TypeScript everywhere; prefer interfaces over type aliases for object shapes
- Avoid enums; use maps/records or union literals instead
- Use functional components with TypeScript interfaces
- Export types alongside implementations when needed

```typescript
// ✅ Good
interface UserProps {
	name: string;
	email: string;
	isActive: boolean;
}

const USER_ROLES = {
	admin: "admin",
	user: "user",
} as const;

type UserRole = (typeof USER_ROLES)[keyof typeof USER_ROLES];

// ❌ Bad
type UserProps = { name: string; email: string };
enum UserRole {
	Admin,
	User,
}
```

### Functions & components

- Export React components as named functions; avoid default exports and classes
- Prefer pure functions declared with the `function` keyword
- Use descriptive camelCase identifiers (`isLoading`, `canSubmit`, `hasError`)
- Structure files: exported component, subcomponents, helpers, static content, types

```typescript
// ✅ Good
export function UserCard({ user }: UserCardProps) {
  const isActive = user.status === "active";
  return <div>{/* ... */}</div>;
}

function formatUserName(user: User): string {
  return `${user.firstName} ${user.lastName}`;
}

// ❌ Bad
export default class UserCard extends Component {}
```

### Naming conventions

| Type                | Convention            | Example                     |
| ------------------- | --------------------- | --------------------------- |
| Directories         | lowercase with dashes | `components/auth-wizard`    |
| Components          | PascalCase            | `LoginForm.tsx`             |
| Variables/Functions | camelCase             | `isLoading`, `handleSubmit` |
| Constants           | SCREAMING_SNAKE_CASE  | `MAX_RETRIES`               |
| Types/Interfaces    | PascalCase            | `UserProps`, `AuthConfig`   |

## React & Next.js patterns

### Server vs client components

- **Default to React Server Components** – Only add `"use client"` when interactivity or browser APIs are required
- Keep client components small and focused
- Wrap client components in `Suspense` with tailored fallbacks

```typescript
// Server Component (default)
export async function UserProfile({ userId }: { userId: string }) {
  const user = await getUser(userId);
  return <UserCard user={user} />;
}

// Client Component (only when needed)
"use client";

export function InteractiveCounter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(c => c + 1)}>{count}</button>;
}
```

### Minimize client-side state

- Minimize `useEffect` and `useState`; favor React Server Components
- Use `nuqs` for URL search parameter state management
- Avoid client components for data fetching or state management

### Data fetching

- Use Next.js data-fetching primitives (Route Handlers, Server Actions, `fetch` with caching tags)
- Colocate route-specific helpers under the route directory
- Share cross-route logic via `apps/[app]/modules` (e.g. `apps/saas/modules`, `apps/marketing/modules`)
- Honor caching and revalidation patterns already in the repo

```typescript
// Server-side data fetching in layout/page
export default async function Layout({ children }: PropsWithChildren) {
	const session = await getSession();

	if (!session) {
		redirect("/login");
	}

	return children;
}
```

### Error handling

- Use `notFound()`, `redirect()`, or custom error boundaries
- Don't throw raw errors; handle them gracefully

```typescript
import { notFound, redirect } from "next/navigation";

export default async function Page({ params }: PageProps) {
  const data = await getData(params.id);

  if (!data) {
    notFound();
  }

  if (!data.isAccessible) {
    redirect("/unauthorized");
  }

  return <Content data={data} />;
}
```

## API & data layer

### oRPC procedures

API logic lives in `packages/api/modules`. Structure procedures with:

1. Route metadata (method, path, tags)
2. Input validation with Zod
3. Middleware (auth, locale)
4. Handler implementation

```typescript
// packages/api/modules/[feature]/procedures/[action].ts
import { publicProcedure, protectedProcedure } from "../../../orpc/procedures";
import { z } from "zod";

export const createItem = protectedProcedure
	.route({
		method: "POST",
		path: "/items",
		tags: ["Items"],
		summary: "Create a new item",
	})
	.input(
		z.object({
			name: z.string().min(1),
			description: z.string().optional(),
		}),
	)
	.handler(async ({ input, context }) => {
		// Implementation
	});
```

### Procedure types

- `publicProcedure` – No authentication required
- `protectedProcedure` – Requires authenticated session
- `protectedOrgProcedure` / `adminOrgProcedure` – Require an active organization (enforces
  Invariant #1; resolves the active org from the URL slug and reconciles to the session)
- `adminProcedure` – Requires admin role

### Database queries

- Use the generated database client from `@virn/database`
- Never instantiate Drizzle directly in app code
- Keep queries in `packages/database/drizzle/queries/`
- All tenant-scoped reads/writes go through the `withOrg(orgId)` query helper

```typescript
// packages/database/drizzle/queries/users.ts
export async function getUserById(id: string) {
	return await db.query.user.findFirst({
		where: (user, { eq }) => eq(user.id, id),
	});
}
```

### Client-side data fetching

Use TanStack Query with oRPC utilities:

```typescript
"use client";

import { orpc } from "@shared/lib/orpc-query-utils";
import { useMutation, useQuery } from "@tanstack/react-query";

export function ItemsList() {
	const { data, isLoading } = useQuery(orpc.items.list.queryOptions());

	const createMutation = useMutation(orpc.items.create.mutationOptions());

	// ...
}
```

### Notifications

- **Server:** Create notifications with `createNotification` from `@virn/notifications`
  (`userId`, `type`, optional JSON `data`, optional `link`). User preferences control whether a
  row is stored (in-app) and whether email is sent (`notification` mail template; `data.headline`
  / `data.title` / `data.message` drive copy when present).
- **Types:** New notification kinds require updating the `NotificationType` enum in the
  database schema (`drizzle/schema/auth.ts`) and keeping `packages/notifications/src/types.ts`
  and `packages/notifications/src/catalog.ts` (`NOTIFICATION_GROUPS`, labels via
  `settings.notificationsPage` i18n) aligned. The Virn-specific types (`run_assigned`,
  `step_completed`, etc.) live in that enum — do not introduce a parallel notifications table.
- **API & UI:** oRPC lives in `packages/api/modules/notifications` (list, unread count, mark
  read, preferences). The SaaS app consumes these via TanStack Query (`orpc.notifications.*`);
  the notification center UI is under `apps/saas/modules/shared`.

## Authentication & authorization

### Session handling

- Use helpers from `@virn/auth` for session handling
- Server-side: `getSession()` from `@auth/lib/server`
- Client-side: `useSession()` hook from `@auth/hooks/use-session`

```typescript
// Server Component
import { getSession } from "@auth/lib/server";

export default async function ProtectedPage() {
	const session = await getSession();
	// ...
}

// Client Component
("use client");
import { useSession } from "@auth/hooks/use-session";

export function UserInfo() {
	const { user, loaded } = useSession();
	// ...
}
```

### Organization scoping

- Respect organization scoping for multi-tenant features (Invariant #1)
- Access control helpers live in `apps/saas/modules/*/lib`
- Use `useActiveOrganization()` hook for organization context

```typescript
"use client";
import { useActiveOrganization } from "@organizations/hooks/use-active-organization";

export function OrgSettings() {
  const { activeOrganization, isOrganizationAdmin } = useActiveOrganization();

  if (!isOrganizationAdmin) {
    return <p>Access denied</p>;
  }

  // ...
}
```

### Auth flow consistency

When updating auth flows, ensure:

- Email templates in `packages/mail/emails` are updated
- Audit hooks remain consistent
- Locale detection works correctly

## UI & styling

### Component library

- Use Shadcn UI components from `@virn/ui/components`
- Compose with Radix primitives when customization is needed
- Import the `cn` helper for conditional class names

```typescript
import { Button } from "@virn/ui/components/button";
import { cn } from "@virn/ui";

export function CustomButton({ variant, className }: Props) {
  return (
    <Button className={cn("custom-styles", className)} variant={variant}>
      Click me
    </Button>
  );
}
```

### Tailwind CSS

- Follow mobile-first responsive utility ordering
- Respect design tokens from `tooling/tailwind/theme.css`
- Use consistent spacing and color variables

```typescript
<div className="flex flex-col gap-4 md:flex-row md:gap-6 lg:gap-8">
  {/* Content */}
</div>
```

### Image optimization

- Use `next/image` with explicit `width`/`height`
- Prefer WebP format when possible
- Implement lazy loading for non-critical visuals

```typescript
import Image from "next/image";

<Image
  src="/images/hero.webp"
  alt="Hero image"
  width={1200}
  height={630}
  priority={false}
  loading="lazy"
/>
```

## Forms & validation

### Form implementation

- Use `react-hook-form` for form state management
- Use `zod` for schema validation
- Reuse existing form abstractions before creating new ones

```typescript
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@virn/ui/components/form";

const formSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Invalid email"),
});

type FormValues = z.infer<typeof formSchema>;

export function ContactForm() {
  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "", email: "" },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    // Handle submission
  });

  return (
    <Form {...form}>
      <form onSubmit={onSubmit}>
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {/* More fields... */}
      </form>
    </Form>
  );
}
```

### Shared validation schemas

- Define validation schemas in API module types for reuse
- Import schemas from `@virn/api/modules/[feature]/types`

```typescript
// packages/api/modules/contact/types.ts
import { z } from "zod";

export const contactFormSchema = z.object({
	name: z.string().min(1),
	email: z.email(),
	message: z.string().min(10),
});

export type ContactFormValues = z.infer<typeof contactFormSchema>;
```

## Internationalization

### Translation strings

- Source strings via i18n utilities in `packages/i18n`
- Keep translations scoped by surface: `marketing`, `saas`, `mail`, and `shared`
- Use `useTranslations()` hook in components
- Content collections live in `apps/marketing/content`

```typescript
import { useTranslations } from "next-intl";

export function WelcomeMessage() {
  const t = useTranslations();

  return (
    <h1>{t("home.welcome.title")}</h1>
  );
}
```

### Locale handling

- Honor locale detection from `packages/i18n/config.ts`
- Use correct cookie naming conventions (`NEXT_LOCALE`)
- Load server-side message bundles through `getMessagesForLocale(locale, scope)`
- Server components: use `setRequestLocale(locale)`

```typescript
// Server Component with locale
export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <Content />;
}
```

## Configuration

### Config files

Each package and application has its own config file to keep the config scoped.

If you need to access the config from a package, you can import it directly from the packages config file.

```typescript
import { config } from "@config";
import { config as i18nConfig } from "@virn/i18n";

// Access configuration
config.appName; // Application name
i18nConfig.defaultLocale; // Default locale
```

### Environment variables

- Server-only variables: No prefix
- Client-accessible variables: `NEXT_PUBLIC_` prefix
- With the split apps, prefer SaaS-specific public URLs such as `NEXT_PUBLIC_SAAS_URL` for auth and app redirects
- Payment provider identifiers should stay server-only where possible; avoid exposing provider `priceId` values to the client unless the existing implementation already does
- Never commit secrets; use `.env.local`
- **Neon Postgres:** the runtime uses the **pooled** URL; Drizzle Kit migrations use the **direct** (unpooled) URL — keep both env vars distinct

## Tooling & quality

### Package manager

- Use **pnpm** for package management
- Run workspace-wide commands via **Turbo**

```bash
pnpm dev                          # Start development server
pnpm build                        # Build all packages
pnpm lint                         # Run linting
pnpm format                       # Format code
pnpm --filter database generate   # Generate Drizzle migrations from schema
```

### Code quality

- Linting and formatting use **Oxlint** and **Oxfmt**
- Lint all files before committing and fix all errors and warnings
- Format all files before committing
- Target Node.js ≥ 20 with ESM-compatible imports

### Testing

- E2E tests use **Playwright** in `apps/marketing/tests` and `apps/saas/tests`
- Run tests with `pnpm test` from the app directory or workspace root

### Adding dependencies

- Add dependencies at the correct workspace package
- Prefer the workspace `catalog:` versions in `pnpm-workspace.yaml` when the dependency is already managed there
- Wire up exports through the relevant `index.ts`
- Use the latest stable versions

## Performance optimization

### Core Web Vitals

Optimize for LCP, CLS, and FID:

- Minimize `"use client"` directives
- Use dynamic imports for non-critical components
- Implement proper image optimization
- Avoid layout shifts with proper sizing

```typescript
import dynamic from "next/dynamic";

// Lazy load non-critical components
const HeavyChart = dynamic(() => import("./HeavyChart"), {
  loading: () => <ChartSkeleton />,
  ssr: false,
});
```

### Client component guidelines

Limit `"use client"` to:

- Components requiring browser APIs
- Interactive elements (forms, modals)
- Small, focused client boundaries

Avoid `"use client"` for:

- Data fetching
- Complex state management
- Layout components

## Documentation & change management

### Documentation updates

- Update relevant MDX docs under `apps/marketing/content` when altering user-facing behavior
- Update `agents.md` when architectural conventions, app boundaries, aliases, or shared workflows change
- Append notable architecture/scope decisions to `docs/DECISIONS.md`
- Keep README files current with setup instructions

### Changelog

- Log noteworthy changes in `CHANGELOG.md` for consumer-impacting changes
- Follow conventional commit format: `feat:`, `fix:`, `docs:`, `refactor:`

## Best practices summary

### When adding features

1. Inspect neighboring files for patterns before writing new code
2. Prefer incremental, well-scoped changes over sweeping rewrites
3. Ensure new features have corresponding server and client stories (UI, API, data layer, emails if needed)
4. Test the feature locally before considering it complete

### Code review checklist

- [ ] TypeScript types are accurate and complete
- [ ] No `any` types without justification
- [ ] Server Components used where possible
- [ ] Forms use react-hook-form + zod
- [ ] API procedures follow existing patterns
- [ ] Translations added for user-facing strings
- [ ] Mobile-first responsive design
- [ ] Accessibility considered (Radix primitives)
- [ ] No console.log statements in production code
- [ ] Oxlint linting passes
- [ ] Virn invariants honored (org-scoping, definition/execution split, stable field keys,
      append-only audit/governance)

### When in doubt

- Inspect neighboring files for patterns before writing new code
- Ask for clarification on product requirements rather than guessing
- Prefer incremental, well-scoped changes over sweeping rewrites
- Reference `docs/ARCHITECTURE.md` and `docs/BUILD_PLAN.md` for project context
