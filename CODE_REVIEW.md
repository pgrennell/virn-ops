# supastarter for Next.js — Code Review

> Date: 2026-04-24
> Reviewer: AI code-review pass
> Scope: entire monorepo (apps + packages + tooling + CI)
> Baseline: commit `main`, Next.js 16.2.4, React 19.2, Better Auth 1.6.5, Prisma 7.7, Tailwind 4.2, oRPC 1.13.14, Turbo 2.9.6

---

## 1. Executive summary

supastarter is already a strong, opinionated starter. The monorepo layout is clean, build tooling is fast and modern (Oxlint + Oxfmt + Turbopack + pnpm catalogs), types are complete, and the architecture — oRPC + Better Auth + shared packages — is built the way experienced SaaS teams actually ship.

The gap between "excellent" and "best-in-class SaaS starter" is mostly about hardening and batteries-included ergonomics:

- **Security posture is thin by default.** No security headers, no rate limiting, no audit log, no re-auth for sensitive ops, an `image-proxy` with a lightly-validated path, and a public OpenAPI surface. None of these are broken — they are just not configured, which is exactly the kind of thing a starter should preconfigure.
- **Runtime cost is higher than it needs to be.** Every authenticated page is force-dynamic, every render calls `getSession()` with cookie cache disabled, and the webpack config shipped in `next.config.ts` is silently ignored under Turbopack.
- **Provider switching is code-level, not config-level.** Mail, payments, storage, and AI providers are toggled by editing a re-export file. An env-driven resolver would make the starter kit genuinely plug-and-play.
- **Batteries that experienced SaaS teams always install are not here yet.** No background-job system, no Redis/cache layer, no env validation (Zod), no CSP, no feature flags, no API keys for users, no webhooks outbound, no Husky/lint-staged, no Changesets, no bundle analyzer, no audit log.
- **Type hygiene has a handful of small rot.** `"types": "./**/.tsx"` in several `package.json`, a typo folder (`modules/admin/component/`), a duplicate dead file (`modules/lib/sidebar-context.tsx`), ~20 `as string` env casts, a couple of `as any`.

Everything below is concrete, file-referenced, and prioritized. Section 11 is a copy-paste-ready todo list; section 12 is a feature wish-list for what would make this the starter kit people pick without hesitation.

### Top ten, at a glance

1. Add Zod-validated env loader (`packages/env`) and remove every `process.env.* as string`.
2. Add `middleware.ts` to enforce auth on the whole `/app` shell (defense in depth on top of layout guards).
3. Add security headers + `poweredByHeader: false` to both Next configs.
4. Replace `disableCookieCache: true` with Better Auth cookie cache; kill redundant `dynamic = "force-dynamic"` / `revalidate = 0` across ~9 pages.
5. Switch provider bindings (mail, payments, storage, AI) to env-driven resolution.
6. Add rate limiting + CAPTCHA on login / signup / forgot-password / magic-link / contact / newsletter.
7. Re-enable `freshAge` on Better Auth (or require re-auth for delete account / change password / add passkey).
8. Sanitize `/image-proxy/[...path]` against traversal; validate S3 `ContentType` against the uploading MIME.
9. Add Husky + lint-staged, Changesets, bundle analyzer, Web Vitals reporting.
10. Add an audit log (`AuditEvent` model) and wire the obvious events.

---

## 2. Verification results

All commands executed from the workspace root with a `.env.local` seeded from `.env.local.example` and a throwaway `DATABASE_URL`.

| Step       | Command                                 | Result                                                                                  |
| ---------- | --------------------------------------- | --------------------------------------------------------------------------------------- |
| Install    | `pnpm install --frozen-lockfile`        | OK (~12s)                                                                               |
| Generate   | `pnpm --filter @repo/database generate` | OK (Prisma 7.7 + prisma-zod-generator)                                                  |
| Lint       | `pnpm lint` (`oxlint .`)                | 0 errors / 0 warnings, 390 files, 145 rules                                             |
| Format     | `pnpm format:check` (`oxfmt --check .`) | All 477 files formatted                                                                 |
| Type-check | `pnpm type-check`                       | 18/18 packages pass                                                                     |
| Tests      | `pnpm test` (vitest)                    | 41 tests / 3 files pass (`@repo/api` 14, `marketing` 22, `saas` 5)                      |
| Build      | `pnpm build`                            | 4/4 apps build under Turbopack                                                          |
| Runtime    | `pnpm --filter saas start`              | Boots < 1s, `/login` 200, `/api/health` 500 (expected — DB unreachable in this sandbox) |

Response-header check on `/login`:

```text
HTTP/1.1 200 OK
X-Powered-By: Next.js            # ← leaks stack
Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate
```

Missing: `Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options` / `frame-ancestors`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`.

---

## 3. Architecture overview (as-built)

```
supastarter-nextjs
├── apps
│   ├── saas           Next.js 16 App Router, protected app
│   ├── marketing      Next.js 16 App Router, public site + MDX content-collections
│   ├── docs           fumadocs + MDX
│   └── mail-preview   react-email dev server
├── packages
│   ├── ai             @ai-sdk (OpenAI, Anthropic listed but unused)
│   ├── api            oRPC router + Hono app + OpenAPI (Scalar) handler
│   ├── auth           Better Auth (passkey, magicLink, twoFactor, organization, admin, openAPI) + invitationOnly plugin
│   ├── database       Prisma 7 (primary) + Drizzle (parallel) + generated Zod
│   ├── i18n           next-intl config + message bundles (en/de/es/fr)
│   ├── logs           consola-based logger
│   ├── mail           react-email templates + 6 providers (console, plunk, resend, nodemailer, postmark, mailgun)
│   ├── notifications  createNotification + welcome + catalog + resolve-link
│   ├── payments       Stripe (wired by default) + Lemonsqueezy/Creem/Polar/Dodo (scaffolded)
│   ├── storage        S3 (presigned URLs)
│   ├── ui             shadcn/radix components + Toaster + Logo
│   └── utils          getBaseUrl + passwordSchema
└── tooling
    ├── scripts        create-user CLI
    ├── tailwind       shared theme + animate CSS
    └── typescript     base / nextjs tsconfigs
```

Great things that deserve calling out:

- **oRPC + Hono + Scalar OpenAPI** is a genuinely excellent DX choice. Typed RPC for clients, OpenAPI for external consumers, auto-merged auth schema, docs at `/api/docs`.
- **Per-app config object with `satisfies` interface** (`apps/saas/types.ts`, `apps/marketing/types.ts`) — well-documented, discoverable. Worth preserving as you add new toggles.
- **Better Auth with invitation-only plugin** + org + passkey + 2FA + admin — covers most real-world SaaS auth needs.
- **Server-side prefetching into TanStack Query via `HydrationBoundary`** — textbook-correct SSR hydration pattern.
- **Oxlint + Oxfmt catalog versions** — lint+format in sub-second on 477 files. Keep this.
- **Email + payments + storage abstractions** are clean in shape. Only the binding is code-level.

---

## 4. Security

### 4.1 HTTP security headers — missing

Neither `apps/saas/next.config.ts` nor `apps/marketing/next.config.ts` sets a `headers()` block or `poweredByHeader: false`. Curl confirms `X-Powered-By: Next.js` is emitted and no CSP / HSTS / COOP / CORP / XCTO / Referrer-Policy / Permissions-Policy.

**Recommendation.** Add to both apps:

```ts
// next.config.ts
const nextConfig: NextConfig = {
	poweredByHeader: false,
	async headers() {
		return [
			{
				source: "/:path*",
				headers: [
					{
						key: "Strict-Transport-Security",
						value: "max-age=63072000; includeSubDomains; preload",
					},
					{ key: "X-Content-Type-Options", value: "nosniff" },
					{ key: "X-Frame-Options", value: "DENY" },
					{ key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
					{
						key: "Permissions-Policy",
						value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
					},
					{ key: "Cross-Origin-Opener-Policy", value: "same-origin" },
					{ key: "Cross-Origin-Resource-Policy", value: "same-origin" },
				],
			},
		];
	},
};
```

CSP should be added via `middleware.ts` with a per-request nonce because `next-themes` and Figtree inline styles need it.

### 4.2 No rate limiting

`grep -r 'rateLimit' .` returns nothing. None of these endpoints are rate-limited:

- `authClient.signIn.email`, `authClient.signIn.magicLink`, `authClient.signIn.passkey`
- `authClient.signUp.email`
- `authClient.forgetPassword`
- `authClient.sendVerificationEmail`
- oRPC router (`/api/rpc/**`)
- `packages/api` Hono app's `/api/auth/**` proxy
- Webhook endpoint `/api/webhooks/payments`
- Contact / newsletter forms

**Recommendation.** Ship a default rate limiter with an in-memory fallback for dev and a Redis-backed one (`@upstash/ratelimit` or `hono-rate-limiter`) for prod. Plug into the auth middleware and the oRPC `protectedProcedure` / `publicProcedure`. For the auth endpoints specifically, Better Auth exposes a `rateLimit` config — use it:

```ts
rateLimit: {
  enabled: true,
  window: 60,
  max: 10,
  customRules: {
    "/sign-in/email":   { window: 60, max: 5 },
    "/magic-link/send": { window: 60, max: 3 },
    "/forget-password": { window: 60, max: 3 },
  },
},
```

### 4.3 `freshAge: 0` disables session freshness

`packages/auth/auth.ts:41`:

```ts
session: { expiresIn: config.sessionCookieMaxAge, freshAge: 0 },
```

This tells Better Auth that _any_ session — including one that was opened 30 days ago on a public machine — can perform sensitive actions like `deleteUser`, `changeEmail`, `changePassword`, `passkey.add`, `twoFactor.enable`.

**Recommendation.** Set `freshAge` to a sane window (e.g. `60 * 15`) and add a re-auth prompt in the UI when Better Auth returns `SESSION_NOT_FRESH`.

### 4.4 `/image-proxy/[...path]` — weak input validation

`apps/saas/app/image-proxy/[...path]/route.ts`:

```ts
const [bucket, filePath] = path;
if (bucket === "avatars") {
	const signedUrl = await getSignedUrl(filePath, { bucket, expiresIn: 60 * 60 });
	return NextResponse.redirect(signedUrl, { headers: { "Cache-Control": "max-age=3600" } });
}
```

`filePath` is passed unmodified into the S3 key. A request like `/image-proxy/avatars/../../secret-key` becomes the S3 key `../../secret-key`. S3 will usually refuse because of the `Bucket:` argument, but the check should be defensive and explicit.

**Recommendation.**

```ts
if (!/^[a-zA-Z0-9._-]+\.(png|jpe?g|webp|gif|avif)$/.test(filePath)) {
	return new Response("Bad path", { status: 400 });
}
```

### 4.5 Fixed `ContentType: "image/jpeg"` on upload

`packages/storage/provider/s3/index.ts:42` hard-codes `ContentType: "image/jpeg"`. Clients can therefore upload PDFs / exe / HTML under a jpeg MIME label. If the bucket is public-read (MinIO setup is `anonymous set download`) this is an XSS vector (HTML served from your domain subpath).

**Recommendation.** Accept `contentType` in the signed-URL helper, validate it against an allowed list per bucket, and apply `ResponseContentType` and `ContentDisposition: attachment` on signed downloads where applicable.

### 4.6 OpenAPI Scalar docs are mounted at `/api/docs` unconditionally

`packages/api/orpc/handler.ts` installs the `OpenAPIReferencePlugin` with `docsPath: "/docs"`. The schema is built from `auth.api.generateOpenAPISchema()` + every oRPC procedure. In production that's your entire API surface on a public URL.

**Recommendation.** Gate behind `process.env.ENABLE_API_DOCS === "true"` or `NODE_ENV !== "production"`.

### 4.7 Password policy is client-only

`packages/utils/lib/password-validation.ts` (used by SignupForm) requires upper+lower+number+special. Better Auth server config (`packages/auth/auth.ts:173`) only enforces `minPasswordLength: 8`. A direct API call to `/api/auth/sign-up/email` with `password: "aaaaaaaa"` bypasses the strong schema.

**Recommendation.** Hook Better Auth's `password.validate` or add a `before` middleware on `/sign-up/email` and `/change-password` and `/reset-password` that runs the same `passwordSchema`.

### 4.8 No audit log

No `AuditEvent` model. Login attempts, role changes, impersonation start/stop, password reset, billing events, webhook deliveries are invisible after the fact.

**Recommendation.** Add a minimal `AuditEvent` model (actor, target, type, metadata, ip, userAgent, createdAt) and a helper in `packages/audit-log` wired from auth hooks, admin procedures, and payment webhooks.

### 4.9 Admin impersonation has no banner

Better Auth supports admin impersonation (`authClient.admin.impersonateUser`), and the code uses it (`UserList.tsx:80`). The resulting session has `impersonatedBy: string | null` on the DB (see `Session` model) but the SaaS UI renders no banner.

**Recommendation.** In `SessionProvider`, if `session.impersonatedBy` is set, render a persistent banner with "You are impersonating … · Stop impersonating" across every page.

### 4.10 Cookie-bot / CAPTCHA / bot signals

No hCaptcha / Turnstile on signup / contact / newsletter.

**Recommendation.** Cloudflare Turnstile (free, privacy-preserving) wired on signup + magic-link + forgot-password + contact. Better Auth has `captcha` plugins; a drop-in implementation is straightforward.

### 4.11 Webhook handler replay window

`packages/payments/provider/stripe/index.ts` relies on `constructEventAsync` (signed, with Stripe's built-in 5-minute tolerance). Good. No IP allowlist, no duplicate-event ledger. `Purchase.subscriptionId` is unique, so retries of `subscription.created` are idempotent by accident — but `invoice.paid` et al. are not.

**Recommendation.** Add a `WebhookDelivery` model keyed by provider event id, insert-with-conflict-ignore before processing.

### 4.12 CSRF

Better Auth uses sameSite cookies + trusted origins — fine. oRPC routes under `/api/rpc/**` are called from the browser with credentials; in the default Hono CORS block `origin` is the SaaS URL and `credentials: true`. Worth an audit when you add a separate API subdomain.

### 4.13 Secrets in env files

`.env.local.example` is a shippable template, no actual secrets in repo. Good. Consider adding a `.env.example` that is validated against a Zod schema (see 7.1).

---

## 5. Correctness & TypeScript hygiene

### 5.1 Invalid `"types"` glob in several package.json

`@repo/auth`, `@repo/ai`, `@repo/database`, `@repo/payments` declare:

```json
"types": "./**/.tsx"
```

That is a malformed glob (missing `*` between `/**/` and `.tsx`). Because these packages are consumed through `main` (`./index.ts`) in the workspace, this value is inert, but it's misleading and should be fixed to `"./index.ts"` or removed.

### 5.2 Typo folder `modules/admin/component/`

`apps/saas/modules/admin/component/` should be `components/`. It works only because the path alias is `@admin/*` not `@admin/components/*`. The entire repo uses `components/` elsewhere. Also exposes the plural inconsistency to new contributors.

### 5.3 Dead duplicate `modules/lib/sidebar-context.tsx`

`apps/saas/modules/lib/sidebar-context.tsx` is identical to `apps/saas/modules/shared/lib/sidebar-context.tsx` but is not imported anywhere (search confirmed). Delete.

### 5.4 `process.env.X as string` — ~20 occurrences

Ripgrep hits in `packages/payments/provider/*`, `packages/storage/provider/s3`, `packages/auth/auth.ts`, `packages/mail/provider/*`, `apps/marketing/modules/analytics/provider/*`, and every `config.ts`.

This is the most impactful single fix. Add `packages/env`:

```ts
// packages/env/index.ts
import { z } from "zod";
import { createEnv } from "@t3-oss/env-nextjs";

export const env = createEnv({
	server: {
		DATABASE_URL: z.string().url(),
		BETTER_AUTH_SECRET: z.string().min(32),
		STRIPE_SECRET_KEY: z.string().optional(),
		STRIPE_WEBHOOK_SECRET: z.string().optional(),
		// ...
	},
	client: {
		NEXT_PUBLIC_SAAS_URL: z.string().url().optional(),
		NEXT_PUBLIC_MARKETING_URL: z.string().url().optional(),
		// ...
	},
	runtimeEnv: {
		DATABASE_URL: process.env.DATABASE_URL,
		BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
		// ...
	},
	emptyStringAsUndefined: true,
});
```

Then every provider becomes `import { env } from "@repo/env"` and no more `as string`.

### 5.5 `as any` smells

- `LoginForm.tsx:80`: `(data as any).twoFactorRedirect` — better-auth should type this; investigate (probably an `InferRouteContext` helper). Otherwise narrow with a zod schema.
- `packages/api/orpc/handler.ts:24`: spread of `authSchema` into an OpenAPI document uses `as any`. Derivable from `better-auth` types.
- `packages/mail/lib/templates.ts:22`: `template({...(context as any), locale, translations})` — the generic is already tight, the cast is a TS limitation workaround but should be a `satisfies` on the individual template prop type.

### 5.6 Exhaustive-deps suppressions

16 `oxlint-disable-line eslint-plugin-react-hooks/exhaustive-deps` occurrences:

- Some hide intentional one-shot effects (`[]` after mount) — those are defensible but should be `useEffect(() => { ... }, [])` with a single-purpose comment.
- Others (SignupForm, LoginForm) hide real bugs: `redirectPath` and `router` are not in the deps array, so a mid-flight props/search-param change can render stale behavior.

**Recommendation.** Audit case-by-case. Prefer `useEffectEvent` (React Compiler / experimental) or `useLatest` hooks for callbacks that shouldn't re-subscribe.

### 5.7 `stream-message` accepts any shape

`packages/api/modules/ai/procedures/stream-message.ts` uses `z.any() as z.ZodType<UIMessage>`. Accepts anything. Should at minimum validate the `role`/`content` discriminated union and token budget (rate-limiting + cost safety).

### 5.8 Placeholder interfaces

`packages/api/types.ts` and `apps/docs/types.ts` have `// remove this once we have config` comments. They're empty interfaces used by `config.ts`. Either delete or commit to them.

### 5.9 TODO / FIXME

Three in-code TODOs:

- `apps/marketing/modules/home/components/NewsletterSection.tsx:25`
- `apps/marketing/modules/home/components/ContactForm.tsx:41`
- `apps/saas/modules/organizations/components/OrganizationInvitationModal.tsx:58`

Ship real implementations (see section 12) or clearly label as demo.

### 5.10 Drizzle ↔ Prisma parity

`packages/database/drizzle/schema/postgres.ts` vs `packages/database/prisma/schema.prisma`:

- `organization.slug` is nullable in Prisma, `.notNull()` in Drizzle. Inconsistency — pick one.
- `session.updatedAt` has `$onUpdate` but no `defaultNow()` in Drizzle; Prisma has no default on `updatedAt` but timestamps are write-time there.
- `purchase.updatedAt` is `@updatedAt` in Prisma, plain `timestamp` in Drizzle without `$onUpdate`.

These haven't bitten because Prisma is the wired default. If a team flips the switch to Drizzle they will hit subtle bugs.

### 5.11 `as string` for `UserSchema` partial updates

`packages/database/prisma/queries/users.ts:updateUser` accepts `Partial<UserSchema>` and passes straight to `db.user.update`. Because `UserSchema` is the generated Zod schema (permissive, includes required fields that shouldn't be editable), `password` / `banned` / `role` / `banExpires` are all reachable. Not currently exploited (only admin routes call it), but flag that this is a trust boundary.

---

## 6. Performance

### 6.1 `dynamic = "force-dynamic"; revalidate = 0;` — duplicated & redundant

9 pages declare both:

- `app/(authenticated)/layout.tsx`, `.../choose-plan/page.tsx`, `.../onboarding/page.tsx`, `.../checkout-return/page.tsx`, `.../new-organization/page.tsx`
- `app/(unauthenticated)/{login,signup,forgot-password,reset-password,verify}/page.tsx`

`revalidate = 0` is implied by `dynamic = "force-dynamic"`. Most of these are _already_ dynamic because they call `cookies()` / `headers()` / `auth.api.getSession`. Shipping them on every authenticated page trains contributors to copy-paste this pattern indefinitely.

**Recommendation.** Remove `revalidate = 0` everywhere. Remove `dynamic = "force-dynamic"` from pages that read cookies/headers already (they're dynamic by definition). Keep it only where Next otherwise would try to statically evaluate.

### 6.2 `disableCookieCache: true` on every session read

`apps/saas/modules/auth/lib/server.ts`:

```ts
export const getSession = cache(async () => {
	return auth.api.getSession({
		headers: await headers(),
		query: { disableCookieCache: true },
	});
});
```

Called from every authenticated layout + page. This means every request hits the `Session` table in Postgres even though Better Auth ships an integrity-signed cookie cache (5–10 min) specifically to avoid that.

**Recommendation.** Drop `disableCookieCache: true` on the default read. Keep an explicit `getFreshSession()` variant for admin and billing code paths that must see the live DB state. The expected effect is a 5–10× reduction in authenticated RPS database load.

### 6.3 Turbopack ignores `next.config.ts` `webpack()` hook

`apps/saas/next.config.ts` installs:

- `webpack.IgnorePlugin({ resourceRegExp: /^pg-native$|^cloudflare:sockets$/ })`
- `PrismaPlugin` on server

`pnpm dev` and `pnpm build` now use Turbopack (confirmed in build output: `▲ Next.js 16.2.4 (Turbopack)`). The webpack hook is silently dead. Prisma 7 monorepo workaround plugin is therefore not active.

**Recommendation.** Either test carefully that Prisma client still works under Turbopack without the plugin (it may — Prisma 7's `engineType: "client"` avoids the traditional WASM/engine copy problem) and delete the hook, or add an equivalent Turbopack rule (`experimental.turbo.resolveAlias`) with `pg-native: false`.

### 6.4 `transpilePackages` is legacy

`apps/saas/next.config.ts`:

```ts
transpilePackages: ["@repo/api", "@repo/auth", "@repo/database", "@repo/ui"],
```

Next.js 13.1+ transpiles local workspace packages implicitly when `main` points to `.ts`. Usually no longer needed and slows down cold build. Try removing and see if type-check + build still pass (they likely will).

### 6.5 Marketing layout reads cookies unconditionally

`apps/marketing/app/[locale]/layout.tsx` reads `cookies().get("consent")` in the root layout, forcing every blog/legal/home page into dynamic rendering. Blog/legal content is SSG-friendly.

**Recommendation.** Read the cookie in a small client boundary (`ConsentProvider` is client already). Let the page tree stay static.

### 6.6 `CheckoutReturnContent` polls

`apps/saas/modules/payments/components/CheckoutReturnContent.tsx` polls `listPurchases` every 2s up to 20s. It works; it's just noisy. For provider stacks with stable webhooks (all of Stripe/Polar/Lemon/Creem/Dodo) an SSE or server-rendered wait-and-redirect is cheaper and gives a more accurate UX.

### 6.7 Duplicate font loading

Both `apps/saas/app/layout.tsx` and `apps/marketing/app/[locale]/layout.tsx` call `Figtree({...})` with identical weights. Each build embeds its own woff2. Acceptable; move into a shared `tooling/fonts` package if you add more apps.

### 6.8 `.next` build size

```text
24M  apps/docs/.next
24M  apps/marketing/.next
74M  apps/saas/.next   ← 3.2M static, rest is server chunks
```

SaaS server bundle is large because every oRPC procedure + Better Auth + Prisma client ends up server-side. Acceptable for now — worth wiring bundle analyzer to catch regressions.

---

## 7. Architecture & code patterns

### 7.1 Env handling (see 5.4)

Adopt `@t3-oss/env-nextjs` or `znv`. Fail-fast at boot; give contributors clear error messages. Required for a serious starter.

### 7.2 No `middleware.ts` — auth only enforced in layouts

`apps/saas` has no `middleware.ts`. Auth check lives in `(authenticated)/layout.tsx`. If a contributor adds a sibling route group that forgets to put itself inside `(authenticated)`, auth is bypassed.

**Recommendation.** Add a root middleware that checks a Better Auth session cookie for everything except `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/verify`, `/api/*`, `/_next/*`, asset paths. Belt + suspenders on top of layout guards.

### 7.3 Provider selection is hard-coded

```ts
// packages/mail/provider/index.ts
export * from "./plunk";

// packages/payments/provider/index.ts
export * from "./stripe";

// packages/storage/provider/index.ts
export * from "./s3";

// packages/ai/index.ts
export const textModel = openai("gpt-4o-mini");
```

A starter kit should resolve providers from env. Something like:

```ts
// packages/mail/provider/index.ts
import { env } from "@repo/env";

const provider = await import(`./${env.MAIL_PROVIDER ?? "console"}`);
export const send = provider.send;
```

Or, cleanly typed, an object map. Same pattern for payments (`PAYMENTS_PROVIDER`), storage (`STORAGE_PROVIDER`), and AI (`AI_PROVIDER`).

### 7.4 No background-job / queue abstraction

Emails, webhook side-effects, seat updates, welcome notifications — all inline. A starter kit for production should ship a minimal job runner:

- **Inngest** (typed, free tier, dev server) or
- **Trigger.dev v3** or
- **QStash** + simple handler route or
- **BullMQ** on Redis

Pick one and wire `sendEmail`, `updateSeatsInOrganizationSubscription`, and `createWelcomeNotification` through it. Lots of UX wins (retry on transient failures, non-blocking auth flow).

### 7.5 No Redis / cache layer

`packages/logs` is consola. There's no KV cache at all. Session lookups, rate-limit counters, feature flags, workspace metadata: all these would benefit from Redis. `@upstash/redis` is a zero-ops good default.

### 7.6 Logger is stdout-only

`packages/logs/lib/logger.ts` is consola with pretty formatting. Not JSON, not leveled in production, not shipped to a collector. In prod you want structured JSON + a logger destination (Axiom / Logtail / Pino + transport).

**Recommendation.** Wrap consola for local, pino-http for prod, and add `logger.withCtx(requestId)` helper usable from oRPC middleware.

### 7.7 Error tracking

No Sentry / Bugsnag / Rollbar integration. For a commercial SaaS starter this is a must.

### 7.8 No outbound webhooks for customers

B2B SaaS users frequently need `Organization.webhooks[]`. Not present. Good starter kit candidate for a `@repo/webhooks` package.

### 7.9 oRPC pattern is consistent, reusable

`protectedProcedure` / `adminProcedure` pattern is tidy; test coverage exists (`packages/api/orpc/procedures.test.ts`). Keep this. Consider adding a `rateLimitedProcedure` on top as a standard primitive.

### 7.10 `server-only` usage

`@auth/lib/server.ts` and `@shared/lib/server.ts` both import `server-only`. Good. Consider auditing `@payments/lib/server.ts` and `@i18n/lib/update-locale.ts` to ensure all server-only helpers get the import.

### 7.11 `revalidatePath("/")` in updateLocale

`apps/saas/modules/i18n/lib/update-locale.ts` nukes the entire app cache on every language change. For a single user it's cheap; in a multi-tenant fleet under Next.js's shared in-memory cache it could surprise you.

**Recommendation.** Use `revalidateTag('user-' + userId)` or a narrower invalidation.

### 7.12 oRPC router is monolithic — acceptable but plan for growth

`packages/api/orpc/router.ts` aggregates every feature's router. Fine today. When the surface crosses ~50 procedures, consider per-feature routers with their own openapi tag + their own middleware chain.

---

## 8. DX / Tooling / CI

### 8.1 No pre-commit hooks

CI is the only safety net. A contributor opening a PR that breaks `oxfmt --check` only learns after the push. Add Husky (or Lefthook) + `lint-staged` for:

```json
"*.{ts,tsx,js,jsx,mjs,cjs}": ["oxlint --fix", "oxfmt"],
"*.{json,md,css}": ["oxfmt"]
```

### 8.2 No release automation

There's a `CHANGELOG.md` curated by hand. Adopt **Changesets** for semver-based changelog + version bumps per package, even though packages are private — the changelog is the payoff.

### 8.3 No bundle analyzer

Add `@next/bundle-analyzer` in both `apps/saas/next.config.ts` and `apps/marketing/next.config.ts`, behind `ANALYZE=true`.

### 8.4 No Web Vitals reporting

`app/layout.tsx` doesn't export `reportWebVitals`. Add a default that pipes to the analytics provider.

### 8.5 Test coverage is thin

Only `@repo/api` and the two app smoke tests. Nothing for:

- `@repo/payments` (price-id matching, plan helpers, webhook reducers)
- `@repo/mail` (template rendering per locale)
- `@repo/storage` (path validation once added)
- `@repo/notifications` (disabled preferences → in-app only)
- `@repo/auth/plugins/invitation-only`
- `@repo/api` admin/payments procedures

### 8.6 CI workflow gaps

`.github/workflows/validate-prs.yml`:

- No concurrency cancellation (`concurrency: group: pr-${{ github.ref }}, cancel-in-progress: true`) — duplicate runs stack up.
- E2E upload only covers saas report, not marketing.
- No push-to-main run (release artifacts / smoke).
- No preview-env comment (Vercel preview, Turbo summary).
- No Prisma `generate` step for the lint / type-check jobs (currently works because codegen is cached; may break on a fresh runner).
- No dependency-review action for supply-chain checks.

### 8.7 Dependabot capped at 2 PRs

Worth raising to 10+ with grouped patch/minor PRs.

### 8.8 Turbo `test` task lacks outputs

`turbo.json`'s `test` has no `outputs`. CI warns per package. Add `outputs: ["coverage/**"]`.

### 8.9 `pnpm dev` concurrency

`turbo dev --concurrency 15` is fine. When you add more apps you may hit the limit.

### 8.10 `packageManager` field

Root `package.json` pins `pnpm@10.28.2`. Good. Consider adding `.nvmrc` (or `engines.node` is already `>=20`) for a Node 22 pin.

### 8.11 No `.vscode/settings.json` formatter defaults

Contributors on VS Code won't automatically run Oxfmt. Consider shipping:

```json
// .vscode/settings.json
{
	"editor.formatOnSave": true,
	"editor.defaultFormatter": "oxfmt-vscode",
	"typescript.preferences.importModuleSpecifier": "non-relative"
}
```

### 8.12 `@scalar/hono-api-reference` may be unused dep

Listed in `packages/api/package.json`. Grep: no direct import. Confirm and remove.

---

## 9. Product / UX

### 9.1 Contact + Newsletter are TODO stubs

Ship real implementations with one of: Resend Audiences (newsletter), Loops, ConvertKit. Contact form → submit to mail provider with "Reply-To" set to the visitor's email.

### 9.2 ConsentBanner copy is hard-coded English

`apps/saas/modules/shared/components/ConsentBanner.tsx` literally says "This site doesn't use cookies yet, but we added this banner to demo it to you." Not i18n'd. Not wired to gate analytics.

### 9.3 No feature flags

For a SaaS starter, a minimal feature-flag primitive (`packages/feature-flags` with Vercel FF / PostHog FF / Unleash) is a strong add.

### 9.4 No onboarding tour / checklist

`OnboardingForm` collects a name and avatar and ends. A fuller starter would have a post-signup checklist (invite a teammate, choose plan, first action).

### 9.5 No user-facing API keys

If the starter is for a product that exposes an API, users need a way to generate personal access tokens. There is no `PersonalAccessToken` model.

### 9.6 No org-level webhooks for customers

(Repeating 7.8 for feature-ideas visibility.)

### 9.7 No data export / GDPR request workflow

Better Auth deletes a user but there's no "export my data" endpoint.

### 9.8 No changelog / what's-new viewer inside the app

Blog-based changelog is fine for marketing; an in-app "what's new" drawer drives engagement.

### 9.9 No referral / affiliate system

`Purchase.priceId` exists; no way to attribute a conversion to a referral.

### 9.10 No status page / maintenance banner

Dead simple but not scaffolded.

### 9.11 Admin analytics dashboard

`admin/users` lists users but there's no MRR / DAU / churn / signup-funnel dashboard.

### 9.12 `NotificationCenter` has a solid foundation

The in-app bell, per-type preferences, email-or-in-app routing is great work. Push (Web Push API) is the logical next step.

### 9.13 Empty state in `(main)/(account)/page.tsx`

```tsx
<div className="...">Place your content here...</div>
```

Replace with a real dashboard widget set so the starter boot experience looks like an actual product.

---

## 10. Accessibility, SEO, Docs

### 10.1 A11y

- Radix primitives: accessible.
- The show/hide password eye in `LoginForm.tsx:197` is a `<button>` without `aria-label`. Add one.
- Image uploads have no `alt` description flow. Consider an optional text field.

### 10.2 SEO

- No `metadataBase` at root. Build log warns: `metadataBase property in metadata export is not set for resolving social open graph or twitter images, using "http://localhost:3000"`. Set it from `NEXT_PUBLIC_SAAS_URL` / `NEXT_PUBLIC_MARKETING_URL`.
- `apps/saas/app/robots.ts` allows `/` to all crawlers. The SaaS app should usually disallow `/` (no public content) to avoid wasting crawl budget on 307s to `/login`.
- No default Open Graph image generator (`/opengraph-image.tsx` with `ImageResponse`). Add one in marketing.
- No JSON-LD for blog posts / org / product.

### 10.3 Docs

- `README.md` is 7 lines. A starter kit README should show: quick start, `.env` matrix, `docker compose up`, `pnpm dev`, `pnpm --filter saas e2e`, provider matrix, deployment link.
- No `CONTRIBUTING.md`, `SECURITY.md`, issue templates, PR template.
- `agents.md` doubles as `claude.md` via symlink — good trick for multi-agent teams.

---

## 11. Prioritized TODO list

Effort (E): 🟢 < 2h · 🟡 half-day · 🟠 day+ · 🔴 multi-day / cross-cutting
Impact (I): ⭐ low · ⭐⭐ medium · ⭐⭐⭐ high

### 11.1 Quick wins (do this week)

- [ ] **E🟢 I⭐⭐⭐** Add `poweredByHeader: false` + baseline security `headers()` block to `apps/saas/next.config.ts` and `apps/marketing/next.config.ts`.
- [ ] **E🟢 I⭐⭐⭐** Remove `revalidate = 0` everywhere (redundant with `force-dynamic` or implicit dynamic rendering).
- [ ] **E🟢 I⭐⭐⭐** Flip `disableCookieCache: true` → `false` in `apps/saas/modules/auth/lib/server.ts:getSession`. Add a separate `getFreshSession` for the 3-4 places that need it.
- [ ] **E🟢 I⭐⭐** Restore `session.freshAge` in `packages/auth/auth.ts` to e.g. `60 * 15`. Catch `SESSION_NOT_FRESH` in delete-account + change-password flows.
- [ ] **E🟢 I⭐⭐** Rename `apps/saas/modules/admin/component/` → `components/` and update the three import sites.
- [ ] **E🟢 I⭐** Delete dead `apps/saas/modules/lib/sidebar-context.tsx`.
- [ ] **E🟢 I⭐⭐** Fix `"types": "./**/.tsx"` in `@repo/auth`, `@repo/ai`, `@repo/database`, `@repo/payments` to `"./index.ts"`.
- [ ] **E🟢 I⭐⭐** Gate Scalar OpenAPI docs (`packages/api/orpc/handler.ts`) behind `NODE_ENV !== "production"` or `ENABLE_API_DOCS` env.
- [ ] **E🟢 I⭐⭐** Validate `filePath` in `apps/saas/app/image-proxy/[...path]/route.ts` against an image-extension allow-list.
- [ ] **E🟢 I⭐⭐** Replace hard-coded `ContentType: "image/jpeg"` in `packages/storage/provider/s3/index.ts` with a caller-supplied MIME that is validated against an allow-list per bucket.
- [ ] **E🟢 I⭐⭐** Set `metadataBase` in both root layouts from the public URL env. Kills the build warning.
- [ ] **E🟢 I⭐** Add `Disallow: /` to SaaS `robots.ts`.
- [ ] **E🟢 I⭐** Add `aria-label` to the password-toggle button in `LoginForm.tsx`.
- [ ] **E🟢 I⭐** Add `outputs: ["coverage/**"]` to `turbo.json` `test` task.
- [ ] **E🟢 I⭐** Add concurrency cancellation to `.github/workflows/validate-prs.yml`.
- [ ] **E🟢 I⭐** Remove (after verifying) unused `@scalar/hono-api-reference` dep.

### 11.2 High-impact (do this month)

- [ ] **E🟡 I⭐⭐⭐** Add `packages/env` with `@t3-oss/env-nextjs` + zod. Migrate every `process.env.X as string` and `config.ts` to typed env. Fail fast on boot.
- [ ] **E🟡 I⭐⭐⭐** Add `apps/saas/middleware.ts` as defense-in-depth auth guard (redirects unauthenticated traffic on anything outside `(unauthenticated)` + `/api/*`).
- [ ] **E🟡 I⭐⭐⭐** Wire Better Auth `rateLimit` config (`packages/auth/auth.ts`). Add an oRPC `rateLimitedProcedure` on top of `protectedProcedure`. Hono-rate-limiter or `@upstash/ratelimit`.
- [ ] **E🟡 I⭐⭐⭐** Add Cloudflare Turnstile on signup, magic-link, forgot-password, contact, newsletter.
- [ ] **E🟡 I⭐⭐⭐** Replace hard-coded provider bindings (mail, payments, storage, AI) with env-driven resolution (`MAIL_PROVIDER`, `PAYMENTS_PROVIDER`, `STORAGE_PROVIDER`, `AI_PROVIDER`). Document the matrix in README.
- [ ] **E🟡 I⭐⭐⭐** Enforce the full `passwordSchema` server-side via a Better Auth `before` hook on sign-up / reset-password / change-password.
- [ ] **E🟡 I⭐⭐** Add CSP via middleware with per-request nonce. Verify under `next-themes`, Figtree font, Scalar (in dev).
- [ ] **E🟡 I⭐⭐** Introduce an `AuditEvent` model + `packages/audit-log` + wire obvious events (login success/fail, role change, impersonation start/stop, billing, webhook deliveries).
- [ ] **E🟡 I⭐⭐** Add an impersonation banner in `SessionProvider` when `session.impersonatedBy != null`.
- [ ] **E🟡 I⭐⭐** Add Sentry (`@sentry/nextjs`) wired into all three apps + oRPC error interceptor.
- [ ] **E🟡 I⭐⭐** Swap `packages/logs` consola for a pino-based JSON logger in prod, consola in dev. Expose `logger.withCtx(requestId)`.
- [ ] **E🟡 I⭐⭐** Adopt Husky + lint-staged. Adopt Changesets.
- [ ] **E🟡 I⭐⭐** Add `@next/bundle-analyzer` behind `ANALYZE=true`.
- [ ] **E🟡 I⭐⭐** Add `reportWebVitals` default, route through analytics provider.
- [ ] **E🟡 I⭐⭐** Ship real backends for `ContactForm` and `NewsletterSection` (Resend + audiences).
- [ ] **E🟡 I⭐⭐** Audit and close every `oxlint-disable-line eslint-plugin-react-hooks/exhaustive-deps` in `LoginForm`, `SignupForm`, `ActiveOrganizationProvider`, `OnboardingForm`, `OnboardingAccountStep`.
- [ ] **E🟡 I⭐** Validate `stream-message` input with a discriminated-union zod schema + per-user rate/token budget.
- [ ] **E🟡 I⭐** Reconcile Drizzle ↔ Prisma schemas (slug nullability, `updatedAt` defaults on both sides).
- [ ] **E🟡 I⭐** Add opengraph-image generator (`apps/marketing/app/opengraph-image.tsx` + per-route) using `next/og`.
- [ ] **E🟡 I⭐** i18n the `ConsentBanner` copy; gate analytics on consent state.
- [ ] **E🟡 I⭐** Flesh out README: quick-start, `.env` matrix, provider selection, deployment. Add `CONTRIBUTING.md`, `SECURITY.md`, PR/issue templates.

### 11.3 Long-term / cross-cutting

- [ ] **E🟠 I⭐⭐⭐** Integrate a background-job system (Inngest recommended — best DX, free dev server). Move `sendEmail`, `updateSeatsInOrganizationSubscription`, `createWelcomeNotification` through it. Add retries + dead-letter inspection UI.
- [ ] **E🟠 I⭐⭐** Add `@upstash/redis` as the starter's default KV. Wire rate-limit counters, feature-flag cache, session-cache tier.
- [ ] **E🟠 I⭐⭐** Replace `CheckoutReturnContent` polling with server-sent events driven off webhook delivery.
- [ ] **E🟠 I⭐⭐** Add `PersonalAccessToken` model + CRUD UI + bearer-token auth path in oRPC.
- [ ] **E🟠 I⭐⭐** Add `OrganizationWebhook` model + outbound webhook dispatcher with signing + retries (via the background-job system).
- [ ] **E🟠 I⭐⭐** Replace the hard-coded plan catalog with a DB-backed + cached plan registry for runtime changes without redeploy.
- [ ] **E🟠 I⭐⭐** Build admin analytics dashboard (MRR, ARR, churn, DAU/WAU/MAU, signup funnel).
- [ ] **E🟠 I⭐⭐** Build a minimal feature-flags primitive (local config + optional Vercel FF or PostHog).
- [ ] **E🟠 I⭐** Add E2E coverage for signup → onboarding → choose-plan → checkout-return; admin impersonation; organization invitation acceptance; password reset.
- [ ] **E🟠 I⭐** Add a CLI package (`pnpm supastarter new-feature foo`) that scaffolds an oRPC router + page + module + tests.
- [ ] **E🔴 I⭐⭐** End-to-end multi-tenant data-isolation audit: every oRPC query that accepts `organizationId` verifies membership via `verifyOrganizationMembership`. Today only `create-logo-upload-url` does.

### 11.4 Never-skip maintenance

- [ ] Pin `@types/node` to the Node version you run.
- [ ] Keep Better Auth version in the catalog near Next.js version cadence.
- [ ] Snapshot the generated OpenAPI schema into the repo for drift detection.

---

## 12. Feature wish-list

Categorized by how much they would move the needle for a generic SaaS team.

### 12.1 Must-have (ship these to get to "best-in-class starter")

1. **Env schema with `@t3-oss/env-nextjs`** — single most reusable abstraction.
2. **Rate limiting + Turnstile** — every real product needs it.
3. **Audit log + impersonation banner** — compliance expects it.
4. **Sentry integration** — you can't ship without it.
5. **Background jobs (Inngest)** — unblocks resilient webhooks + email reliability.
6. **Redis (Upstash)** — foundation for rate-limit, cache, feature flags.
7. **Provider switching via env** — the defining property of a starter kit.
8. **Outbound webhooks for customers** — a hallmark B2B-SaaS capability.
9. **Personal API keys** — the other hallmark.
10. **Full security header set + CSP** — one-time, compounding value.
11. **Admin analytics dashboard (MRR/ARR/churn/DAU)** — drives "I can show my boss" wow factor.

### 12.2 High-value (ship these to stand out)

12. **Feature flags** — local config + env override + optional PostHog/Vercel FF.
13. **Release automation (Changesets) + in-app "What's new"** — turn your CHANGELOG into product.
14. **Web Push notifications** — natural extension of the existing NotificationCenter.
15. **Referral / affiliate system** — `ReferralCode` + Stripe coupon + attribution.
16. **SSO (SAML / OIDC) for enterprise orgs** — flag an org as SSO-required; route login accordingly.
17. **Plan gating middleware** — `requirePlan("pro")(procedure)` helper; UI badges.
18. **File-upload component with Cropper + progress + MIME validation** — bake into UI package.
19. **CRM-friendly contact form backend** — Resend, Loops, Customer.io adapter.
20. **Newsletter double opt-in** via the mail provider.
21. **Changelog RSS feed + Atom** — from existing `@changelog` module.
22. **JSON-LD structured data** in marketing layouts.
23. **Og:image generator per post / per org / per user profile page.**
24. **Onboarding tour with progress** — Shepherd / custom steps hook.
25. **Command palette (⌘K)** — `cmdk` + org/page/user search.
26. **API playground in /docs** — the Scalar plugin already gives you this; polish + gate in prod.

### 12.3 Nice-to-have (starter depth)

27. **Time-zone-aware analytics/reporting** for admins.
28. **Organization transfer-ownership flow.**
29. **Org-level SSO domain auto-join** ("any @acme.com auto-joins Acme org").
30. **Billing usage meters** (`setSubscriptionSeats` exists — add a generic metering primitive).
31. **Invoice / receipts download UI.**
32. **Tax-id / VAT capture** (Stripe Tax).
33. **Language-specific marketing landing** (already supported, add content packs).
34. **Status page** hosted at `/status` or link to Instatus/Atlassian Statuspage.
35. **In-app support chat** (Crisp / Intercom / Plain) behind a feature flag.
36. **Session-replay for bug reports** (LogRocket / PostHog session replay).
37. **Localized currency display for plans** (already partly supported — expand).
38. **CLI user-impersonation helper** for ops.
39. **Database seeding script** — sample org, sample plans, sample user.
40. **Storybook for `packages/ui`** so contributors can iterate on the design system without running the SaaS.
41. **Mobile app scaffold (Expo)** sharing `@repo/auth` + `@repo/api` — often requested.
42. **Chrome extension scaffold** sharing the auth & API — for products that have one.
43. **OpenAPI → typed client generator** for customers of your API.
44. **Self-hosted deployment recipe** (Docker Compose production-ready, Kamal / Dokploy).
45. **AWS / GCP / Hetzner Terraform examples.**
46. **ISR/PPR** for marketing pages where appropriate.

---

## 13. Appendix — commands & references

### 13.1 Commands used for this review

```bash
pnpm install --frozen-lockfile
pnpm --filter @repo/database generate
pnpm lint
pnpm format:check
pnpm type-check
pnpm test
pnpm build
pnpm --filter saas start  # smoke
curl -sI http://localhost:3000/login
```

### 13.2 Useful file references

- Monorepo root — `pnpm-workspace.yaml`, `turbo.json`, `package.json`
- SaaS app config — `apps/saas/next.config.ts`, `apps/saas/app/layout.tsx`, `apps/saas/app/(authenticated)/layout.tsx`
- Marketing app config — `apps/marketing/next.config.ts`, `apps/marketing/app/[locale]/layout.tsx`
- Auth — `packages/auth/auth.ts`, `packages/auth/config.ts`, `packages/auth/client.ts`
- API — `packages/api/index.ts`, `packages/api/orpc/{handler,router,procedures}.ts`
- Database — `packages/database/prisma/{schema.prisma,client.ts,queries/*}`
- Payments — `packages/payments/{config.ts,provider/stripe/index.ts}`
- Storage — `packages/storage/{config.ts,provider/s3/index.ts}`
- Mail — `packages/mail/{config.ts,lib/{send.ts,templates.ts},emails/*}`
- Notifications — `packages/notifications/src/*`
- Providers of concern — `packages/*/provider/index.ts` (single-line re-export pattern)
- Known TODOs — `apps/marketing/modules/home/components/{ContactForm,NewsletterSection}.tsx`, `apps/saas/modules/organizations/components/OrganizationInvitationModal.tsx`

### 13.3 External resources referenced

- Better Auth docs — rateLimit, freshAge, cookieCache, captcha plugin
- Next.js 16 — Turbopack, `headers()`, `middleware.ts`, `opengraph-image`, `poweredByHeader`
- `@t3-oss/env-nextjs` — env validation
- Inngest — background jobs for Next.js
- Upstash Redis + Ratelimit — edge-compatible Redis primitives
- oRPC — `$context`, middleware, OpenAPI plugin
- Prisma 7 — `engineType: "client"`, monorepo workaround plugin
- Cloudflare Turnstile — free CAPTCHA
- Sentry Next.js — `withSentryConfig`

---

_End of review._
