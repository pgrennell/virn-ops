# DECISIONS.md

Running log of notable decisions that affect future work — the rationale behind calls that
are not obvious from the code alone. Format is ADR-lite: each entry has **Context**,
**Decision**, **Rationale**, and **Consequences**. Heavyweight architectural ADRs (the ones
that define the platform shape) live in `docs/ARCHITECTURE.md` §4; this file is for the
smaller calls that still matter.

Append new entries at the bottom, dated. Don't delete past entries — supersede them with
new ones that reference the old.

---

## 2026-05-25 — Phase 0 fix-up + Phase 1 initial schema

Inaugural batch. Seeded after the schema sweep that took the supastarter base to a
Drizzle-only, 65-table Virn baseline.

### D-001 — `auth.ts` is the canonical home for Better Auth tables

**Context:** The supastarter base put every Better Auth-managed table (`user`, `session`,
`account`, `organization`, `member`, `invitation`, `purchase`, `notification`, etc.) inline
in `drizzle/schema/postgres.ts`. Our four early Virn schema files (`_shared`, `config`,
`workflows`, `runs`) imported `organization` and `user` from `"./auth"` — a file that
didn't exist.

**Decision:** Move all Better Auth tables to a new `drizzle/schema/auth.ts`. Rewrite
`postgres.ts` as a pure barrel that `export *`s every schema file.

**Rationale:** Matches the codebase convention (`agents.md` / ARCHITECTURE.md §6: "one file
per domain group, re-exported from `schema/postgres.ts`"). Better Auth's tables use
camelCase column names (`organizationId`, `userId`) because Better Auth requires that;
Virn tables use snake_case. Keeping them in separate files makes the convention boundary
obvious and isolates Better Auth-managed schema from Virn-defined schema. Future Better
Auth regenerations (if ever run) land in one file instead of overwriting a mixed barrel.

**Consequences:** Future schema files (Phase 2+) follow the same pattern: one file per
domain group, exporting `pgTable`s + `relations()`, added to the `postgres.ts` barrel.
Better Auth-managed and Virn-defined tables stay in separate files.

### D-002 — `workflowType` enum lives in `_shared.ts`, not `workflows.ts`

**Context:** Two domain files need the `workflow_type` enum (`procedure | document | policy
| form`): `workflows.ts` types the `workflow.type` column, and `library.ts` types the
`template_listing.content_type` column. Each file also holds a FK that points at the
other (`workflow.installedFromListingVersionId` → `template_listing_version`;
`template_listing_version.sourceWorkflowVersionId` → `workflow_version`). With
`workflowType` declared in `workflows.ts`, the resulting CJS-evaluation cycle crashed
`drizzle-kit generate` with `ReferenceError: Cannot access 'workflowType' before
initialization`.

**Decision:** Hoist `workflowType` to `_shared.ts`. Both `workflows.ts` and `library.ts`
import it from there. Cross-file FKs remain via Drizzle's lazy `() => other.id` thunks.

**Rationale:** A pgEnum is a leaf value with no dependencies. Putting it in `_shared.ts`
breaks the circular-import-at-evaluation-time problem without weakening either domain
module. The lazy thunk pattern works for FK *references*; it can't help when an enum
*value* is needed synchronously at column-declaration time.

**Consequences:** Any future enum needed by ≥2 domain files goes into `_shared.ts`,
documented with a comment explaining why it isn't in its "natural" domain file.

### D-003 — `notificationTypeEnum` extended with Virn types up front

**Context:** BUILD_PLAN.md Batch 6 says "do **not** add a notification table — reuse Better
Auth's existing one. Ask first if app-specific notification types are needed." The shipped
enum had only `WELCOME` and `APP_UPDATE`.

**Decision:** Add the Virn domain values immediately — `RUN_ASSIGNED`, `RUN_COMPLETED`,
`STEP_ASSIGNED`, `STEP_COMPLETED`, `STEP_OVERDUE`, `APPROVAL_REQUESTED`,
`APPROVAL_DECIDED`, `ACKNOWLEDGMENT_DUE`, `SUGGESTION_RESOLVED`, `COMMENT_MENTION` — even
though the features emitting them don't exist yet.

**Rationale:** Extending a `pgEnum` requires a migration in Postgres
(`ALTER TYPE ... ADD VALUE`). Enum values are cheap to add now while no data exists, and
expensive in coordination later (every notification-emitting feature would otherwise need
to ship a migration alongside its code change). The 12-value enum is also the seed for
`packages/notifications/src/types.ts` and `packages/notifications/src/catalog.ts`, which
the UI's notification-preferences screen reads.

**Consequences:** Adding a *new* notification kind in the future still requires updating
this enum, but the obvious ones for Phase 3–7 are already present. Mirror any new value
into `drizzle/schema/index.ts`'s `NotificationType` constant.

### D-004 — Prisma is fully removed; `drizzleAdapter` is the Better Auth backend

**Context:** Supastarter ships with Prisma as the active ORM and Drizzle scaffolded but
inactive (`packages/database/index.ts` re-exported `./prisma`, scripts ran
`prisma generate`, `packages/auth/auth.ts` used `prismaAdapter`,
`apps/saas/next.config.ts` registered `PrismaPlugin`). BUILD_PLAN.md Phase 0 declares
Drizzle as the chosen ORM.

**Decision:** Full cutover. Rewrote `packages/database/index.ts` to re-export `./drizzle`;
replaced all four `dotenv ... prisma <cmd>` scripts in `packages/database/package.json`
with `drizzle-kit` equivalents; deleted `packages/database/prisma/` and
`prisma.config.ts`; removed Prisma deps from the workspace catalog and from
`apps/saas/package.json`; removed `PrismaPlugin` from `apps/saas/next.config.ts`;
switched Better Auth from `prismaAdapter(db, { provider: "postgresql" })` to
`drizzleAdapter(db, { provider: "pg" })` in `packages/auth/auth.ts`; deleted the
`migrate` script in `packages/auth/package.json` (which had generated
`prisma/schema.prisma` from `auth.ts`).

**Rationale:** Two ORMs in the same codebase is a permanent source of drift and
ambiguity. The Drizzle schema is now the single source of truth for what tables exist;
Better Auth's expected shape is hand-maintained in `drizzle/schema/auth.ts` and verified
by Better Auth at runtime via the adapter. Removed code can't go stale.

**Consequences:** When Better Auth ships a new field or table in a future minor release,
the maintainer must hand-update `auth.ts`. The trade-off vs. an auto-generated approach:
the Drizzle schema's column-naming convention (camelCase, mirroring Better Auth's wire
format) must be preserved exactly; deviation breaks the runtime adapter.

### D-005 — `DIRECT_URL` (unpooled) for migrations; `DATABASE_URL` (pooled) for runtime

**Context:** Neon's recommended setup splits the connection string in two: a pooled URL
(PgBouncer in transaction mode) for the app's normal queries, and a direct/unpooled URL
for DDL. Running `drizzle-kit migrate` against the pooled URL will fail in production
because PgBouncer transaction mode doesn't allow the multi-statement DDL drizzle-kit
emits.

**Decision:** `drizzle/drizzle.config.ts` reads `DIRECT_URL` first, falls back to
`DATABASE_URL` if absent, and throws with a clear message if neither is set. It also
throws unconditionally if `NODE_ENV=production` and `DIRECT_URL` is missing.

**Rationale:** Fail-fast for the production hazard; allow the local-dev convenience of
running a single Postgres (no need to set two env vars). The error message names both env
vars and points at `.env.local.example` so a confused developer doesn't need to read
config code to diagnose.

**Consequences:** Anyone wiring up a new deploy needs to set both URLs. The
`.env.local.example` Database section now explains the split inline.

### D-006 — Org-scoping convention: top-level only

**Context:** ARCHITECTURE.md Invariant #1 says "every tenant-owned row carries
`organizationId NOT NULL`." Read literally, every descendant table should carry it too.
But the supastarter-shipped + early Virn schema is looser: `workflow` has `organizationId`,
but `workflow_version`, `section`, `step`, `field`, `step_dependency` do not — they derive
through FK chains back to `workflow.organizationId`. Same on the run side: `run` has it,
`run_step`/`field_value`/etc. do not.

**Decision:** Top-level entities (the ones a user creates or that begin a chain) carry
`organizationId`. Descendant tables inherit via FK. Across Phase 1 this maps to:
`organizationId` is present on **workflow, schedule, workflow_role, run, participant,
automation_rule, suggestion, acknowledgment, role, group, role_assignment, comment,
attachment, tag, webhook, audit_log, activity_event, data_set, field_definition** (when
scope=org), **packInstall**; *absent* on **workflow_version, section, step, field,
step_dependency, run_step, run_step_assignee, field_value, run_role_assignment,
automation_condition, automation_action, run_rule_fired, version_approval, comment_mention,
taggable, role_permission, group_member, plan_capability**.

**Rationale:** Following the existing-schema pattern over a literal Invariant #1 reading.
Duplicating `organizationId` on every descendant doubles index storage and adds an extra
column every insert has to populate from the parent — for marginal benefit when the FK
chain already enforces tenant containment. The intended RLS backstop (when added) will
sit on the entry points; queries already join via the parent table for filtering.

**Consequences:** New schema files must follow this convention. If a future table needs
direct org-scoping (e.g. for partial-index efficiency or RLS), add a comment justifying
the duplication. Invariant #1's wording could be tightened — left for a future
ARCHITECTURE.md edit.

### D-007 — Circular FK pattern: `() : AnyPgColumn => otherTable.id`

**Context:** Two FKs span workflows.ts ↔ library.ts:
`workflow.installedFromListingVersionId` → `template_listing_version`, and
`template_listing_version.sourceWorkflowVersionId` → `workflow_version`. Drizzle's
runtime accepts the cycle via lazy `() => other.id` thunks, but TypeScript's structural
inference recurses and fails with "implicitly has type 'any'" on the table declarations.

**Decision:** Annotate the FK callback's return type explicitly:
```ts
.references((): AnyPgColumn => templateListingVersion.id, { onDelete: "set null" })
```
`AnyPgColumn` is imported from `drizzle-orm/pg-core` as a type. The annotation breaks the
TypeScript inference cycle without affecting runtime behavior.

**Rationale:** This is Drizzle's documented pattern for circular references. It costs one
import and one type annotation per circular FK; any alternative (collapsing files, dropping
the FK to plain text, generating a third "FK-only" module) is structurally worse.

**Consequences:** Any future cross-file FK that forms a cycle uses the same pattern.
Document it in the column comment so the next reader knows why the annotation is there.

### D-008 — `suggestion` is the only governance row with `updatedAt`

**Context:** ARCHITECTURE.md Invariant #6 says audit/governance is append-only.
BUILD_PLAN.md Batch 3 says "append-only **except** suggestion." `version_approval`'s
`decision` field also transitions (`pending` → `approved`/`rejected`), which looks like a
mutation.

**Decision:**
- `acknowledgment`: append-only, `createdAt` only.
- `version_approval`: append-only at the row level, but `decision` flips once from
  `pending` (with `decided_at` set when it does). No `updated_at`. The transition is the
  approver's single action; the audit_log records it.
- `suggestion`: the documented exception. Has full `timestamps` (createdAt + updatedAt)
  and a `status` lifecycle (`open` → `accepted`/`rejected`/`merged`) with
  `resolved_by`/`resolved_at` set on terminal transitions.

**Rationale:** Approvals are a single decision; acknowledgments are a single action;
suggestions are content that authors may edit while `open`. The audit_log is the place
that records every change for forensics, so we don't need to rewrite history on the
governance rows themselves.

**Consequences:** Service-layer code that updates `version_approval` must (a) reject the
update if `decided_at IS NOT NULL`, and (b) write an `audit_log` entry. Same for
`suggestion` status terminations.

### D-009 — Custom RBAC is **additive** to Better Auth's `member.role`

**Context:** Better Auth's organization plugin gives each member a single role (`owner`,
`admin`, `member`) stored in `member.role`. ARCHITECTURE.md ADR-004 calls for finer
control. BUILD_PLAN.md Batch 5 adds `role`, `permission`, `role_permission`, `group`,
`group_member`, `role_assignment`.

**Decision:** Better Auth's role still gates app-level permissions (the floor — only an
`owner` can delete the organization, etc.). The Virn `role_assignment` table layers
additional grants on top, scoped to the org. The two never overlap conceptually: Better
Auth's role is identity-level; Virn roles are resource-action-level.

**Rationale:** Replacing Better Auth's role model would require forking the
organization plugin and rewriting every auth check; layering on top costs only the new
tables and a service-layer permission resolver that consults both. Better Auth's role is
also what its built-in UI for org members expects.

**Consequences:** When implementing the permission resolver (Phase 2+), it must merge the
two sources. `role.isSystem` is set to a non-null *source identifier* (e.g. the slug of
the pack that seeded it) — null = user-defined; the convention lets us identify
pack-seeded roles tenants shouldn't delete.

### D-010 — `permission` is a platform-global, seeded catalog

**Context:** Tenants typically can't invent permissions; permissions name what the code
*checks*, not what the tenant *configures*. ADR-004 names `permission` as
`(resource_type, action, scope)`.

**Decision:** `permission` carries no `organizationId`. Rows are seeded by the platform
(eventually by pack manifests for pack-introduced resources). Tenants assemble custom
`role`s out of the existing permission catalog via `role_permission`.

**Rationale:** A tenant adding rows to `permission` would produce permissions no code
checks — confusion without value. The seam for tenant-specific permissions (if ever
needed) is via packs.

**Consequences:** Seed step is required before RBAC is usable. The seed runs in the
migration script (per agents.md / ARCHITECTURE.md §6 convention: "canonical
taxonomy/setting/pack seeds run as part of the migrate script, not optional").

### D-011 — `audit_log` and `activity_event` are deliberately two tables

**Context:** Both are append-only, both carry `(actorUserId, entityType, entityId, data,
createdAt)`, both are org-scoped. Tempting to collapse into one.

**Decision:** Keep them separate.

**Rationale:** They serve different consumers:
- `audit_log` is forensic / compliance — high-fidelity diffs (`changes` jsonb stores
  before/after snapshots), request metadata (IP, route), permanent retention. Read by
  admins debugging "who broke X" and by compliance exports.
- `activity_event` is user-facing — the timeline a user sees in the run UI ("Sam
  completed Step 3 of Move-in Inspection"). Lower fidelity, ephemeral, RBAC differently
  (peers see each other's activity; only admins see the audit log).

Collapsing them would force every row to satisfy both consumer profiles, growing the
table and complicating the RBAC story.

**Consequences:** Write to both when needed. The Inngest action layer that applies
automation actions will likely write an audit_log entry; the run-step status transition
service writes an activity_event.

### D-012 — `template_category.parent_id` is plain text without a FK

**Context:** Categories form a shallow hierarchy. The natural shape is a self-referential
FK.

**Decision:** Leave `parent_id` as a plain `text` column (no `.references()`), validated
by the service layer. Matches the existing `step.due_anchor_step_id` pattern in
`workflows.ts`.

**Rationale:** Self-referential FKs introduce Drizzle-level circularity (the same
`AnyPgColumn` annotation dance as D-007) for a small amount of integrity. The integrity
benefit is also limited — we can't have a recursive `ON DELETE CASCADE` on a self-FK in
Postgres without `DEFERRABLE` constraints, which add their own complexity. Service-layer
validation is the convention.

**Consequences:** When deleting a category, the service must orphan or re-parent its
children explicitly. Same applies to `step.due_anchor_step_id`.

### D-013 — Initial schema is a single squashed `0000_initial.sql`

**Context:** Phase 1 was built batch-by-batch (Batches 2–7) with a `drizzle-kit generate`
between each, producing migrations `0000`–`0006`. Nothing was applied to a database.

**Decision:** Squash to one `0000_initial.sql` baseline. From this point forward (Phase
2+), each schema change gets its own incremental migration.

**Rationale:** The per-batch migration trail is a development-workflow artifact, not a
production-history artifact. The audit trail of "what each batch added" lives in git
commits, PR descriptions, and BUILD_PLAN.md. A 7-migration baseline for an unapplied
schema sends a misleading signal to future devs (suggests seven prior deployments).
Industry convention (Rails, Django, Prisma docs, Drizzle's own examples) is a single
initial migration when no DB has been touched.

**Consequences:** Once `pnpm --filter @virn/database migrate` runs against Neon, the
`0000_initial.sql` baseline is sealed. Future schema changes are additive incremental
migrations and never squashed.
