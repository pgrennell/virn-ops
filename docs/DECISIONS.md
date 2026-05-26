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

---

## 2026-05-26 — Phase 3 run engine

Decisions made while building the snapshot + completion API (`packages/api/modules/runs/`,
`packages/database/drizzle/queries/runs.ts`) that weren't pre-specified in the Phase 3
brief or `docs/ARCHITECTURE.md`.

### D-014 — Org admins/owners bypass the assignee check on `completeStep` and `setFieldValue`

**Context:** The Phase 3 brief specified that step writes (`setFieldValue`,
`completeStep`) are gated by assignment via `run_step_assignee → participant.userId`. It
left open whether org admins/owners — who can already see every run via
`protectedOrgProcedure` — should also be able to write to steps they aren't personally
assigned to. Two reasonable defaults exist (deny by role; allow by role) and both have
business defenders.

**Decision:** Admins and owners (per `member.role ∈ {admin, owner}`, as exposed by
`adminOrgProcedure`'s membership lookup) bypass the assignee check on both
`completeStep` and `setFieldValue`. Regular org members can only write to steps where
they appear in `run_step_assignee`. Kickoff field writes after launch (`runStepId = null`)
are admin-or-owner only — there is no "assignee" concept for launch-level fields.

**Rationale:** In an operations context, the most common reason to override is to
*unblock*: the assignee is out, the work needs to move, the admin clears the step. Forcing
every override through a reassignment dance (admin → reassign → admin acts as the new
assignee → reassign back) creates friction with no integrity gain — the action is fully
attributed via `run_step.completed_by` and the append-only audit/activity rows. The
denial model would also conflict with how org-config and org-billing actions already work:
admins act broadly. Symmetry.

**Consequences:** Audit and activity rows on admin-completed steps look identical to
assignee-completed steps; the `actor_user_id` distinguishes them. If we later need a
visual "Completed by admin override" treatment in the UI, the data is there (admin vs.
assignee can be derived by joining `run_step_assignee` against the actor at render time).
A future refinement could expose a per-org setting (`runs.allow_admin_override`) gated by
a capability if this default proves wrong for some verticals.

### D-015 — Run auto-completes when every *required* step is done; optional steps don't block

**Context:** `step.is_required` (default `true`) was already in the definition schema and
`step.type` includes `heading` and `one_off` types that are typically not required. The
brief said "mark the run complete when all required steps are done" — but didn't define
what "required" means in the cascade: every runStep, every required runStep, or every
runStep matching some other rule (e.g. excluding `not_applicable`).

**Decision:** A run cascades to `status='completed'` when every runStep whose source
`step.is_required = true` has `run_step.status = 'completed'`. Optional steps
(`is_required = false`) and explicitly `skipped` / `not_applicable` runSteps do not gate
the cascade. Implemented in `areAllRequiredRunStepsComplete()`
([packages/database/drizzle/queries/runs.ts](../packages/database/drizzle/queries/runs.ts))
and triggered at the tail of `completeRunStep()`
([packages/api/modules/runs/lib/complete-step.ts](../packages/api/modules/runs/lib/complete-step.ts)).

**Rationale:** Optional steps exist precisely so they don't block forward progress —
treating them as cascade gates would defeat the column. Matches how SOP / checklist tools
behave in practice (e.g., Asana's "required custom fields" pattern, ServiceNow's
mandatory-vs-conditional tasks). Skipped / not-applicable are already explicit completion
states with the same intent: "this step is resolved, just not by being done."

**Consequences:** A run with all optional steps would never auto-complete by this rule
(no required rows → `areAllRequiredRunStepsComplete()` returns `false`). The schema
default of `is_required = true` means most workflows are unaffected, but a future
workflow consisting only of optional steps would need to be completed by an explicit
"mark complete" action — that procedure doesn't exist yet; flag if it's ever needed. The
cascade emits its own audit + activity pair (`action="run.completed"`, attributed to the
user who completed the final triggering step) — useful for the activity feed but
potentially misleading if read as "this user completed the run."

---

## 2026-05-26 — Audit model: every audited event references a real entity

### D-016 — `audit_log.entity_type` and `audit_log.entity_id` are NOT NULL

**Context:** The supastarter-shipped `audit_log` had `entity_type` and `entity_id` as
nullable columns — the table inherited an "optional polymorphic target" stance where
some audit events (e.g. session login, account deletion) could point at no specific
entity. The same was true for `activity_event` and the cross-cutting polymorphic tables
(`attachment`, `comment`, `taggable`). Migration `0001_overrated_green_goblin.sql`
tightens this: `audit_log.entity_type` and `entity_id` become NOT NULL, and all five
polymorphic tables get a CHECK constraint enforcing `length(entity_id) > 0`. Applied to
the Neon dev DB on 2026-05-26 after a pre-flight that confirmed zero existing violations
(54 rows inspected; the only writers in the codebase are `writeAuditAndActivity`, which
already required both fields at the procedure boundary).

**Decision:** Every audited event must reference a real entity. There are no
"unattached" audit rows — `audit_log.entity_type` is NOT NULL, `audit_log.entity_id` is
NOT NULL, and the polymorphic side tables (`audit_log`, `activity_event`, `attachment`,
`comment`, `taggable`) all reject empty-string entity ids at the DB level.

**Rationale:** Polymorphic auditability works only when every row pins a target — joining
audit events back to the entity is the whole point of the table, and a row with no
target is unjoinable / unfilterable / unactionable in any audit-feed UI. Making the
constraint explicit at the DB pushes the discipline to the writer (must decide what
the event is about) rather than the reader (must handle the unattached case forever).
Session-shaped events ("user logged in") that don't fit naturally into entity-pinning
land in Better Auth's own session/event tables, not `audit_log`. The empty-string
defense covers the failure mode where a polymorphic writer fills `entity_id` with
`""` instead of a real id (a subtle bug that the NOT NULL alone wouldn't catch).

**Consequences:** This is a one-way tightening. To re-open `audit_log` to entity-less
events later would require both a migration (drop the NOT NULL / CHECK constraints) and
a corresponding model decision about what "unattached" means in the UI. The right
mechanism if a "system event" category emerges is a separate `system_event` table with
its own shape, not a relaxation here. Practical implication for builders: any new code
that wants to emit an audit row needs to commit to a polymorphic target — if the
event genuinely has no target, it doesn't belong in `audit_log`.

---

## 2026-05-26 — Field key lifecycle: auto-slug → editable → locked → frozen

### D-017 — `field.key` lifecycle in the Workflow Builder

**Context:** Per Invariant #5, every `field` row has an immutable `key` that merge
variables, conditions, due-rules, and automations target. The friendly `label` can
change anytime, but the `key` is the stable identity behind the scenes — a key that
moves after being referenced is a broken reference. The Workflow Builder (Pass 1)
defines that lifecycle for the authoring UI.

**Decision:** A `field.key` moves through four states:

1. **Auto-slugged on create.** The builder takes the user's friendly label and slugs
   it (`@sindresorhus/slugify` with `_` separator + lowercase) into a candidate key.
   Validated against `/^[a-z][a-z0-9_]*$/` (≤ 64 chars). Collisions within the version
   resolve via `_2`, `_3`, … suffix until unique.
2. **Editable while unreferenced.** The user can override the auto-slug, and rename
   the key at any time, AS LONG AS no schema reference points at the field's id.
   Today's reference surfaces are `automation_condition.sourceFieldId` (show-when
   conditions) and `step.dueSourceFieldId` (date-field-driven due rules); a single
   probe in `findFieldReferencers` enumerates both.
3. **Locked the moment any reference exists.** A `key` rename refuses with
   `FIELD_KEY_LOCKED`; deletion refuses with `FIELD_HAS_REFERENCERS`. Both error
   payloads include the referencer list so the UI can render "clear these first."
   The UI surfaces a locked-key chip in `getVersionEditBundle` so the user knows
   the rename path is closed before they try it.
4. **Frozen on publish.** Once `workflow_version.status='published'`, the entire
   version is immutable through the API (Invariant #3, enforced by
   `assertVersionIsDraft`). Fork creates a fresh draft that copies field keys
   verbatim (D-018) — they remain stable across the fork.

**Rationale:** Silent rename of a referenced key is a worse failure mode than
forcing the user to clear references first. Same probe for rename and delete keeps
the two refusal flows consistent; whenever the reference surface grows, both flows
pick up the new path automatically. Slug + suffix collision resolution gives the
user "free, sensible" keys for 99% of cases without ever having to type one.

**Consequences:**

- **Merge-variable text scans are deferred.** Today's probe covers schema
  references only — it does NOT scan `{{key}}` interpolations in step descriptions,
  comment templates, or automation message bodies. Verified during the Pass 1
  build that no such interpolations exist anywhere in the codebase, so the lock is
  complete for the current feature set. When merge variables ship, extend
  `findFieldReferencers` in `@virn/database` to also scan the relevant text
  columns — the lib layer just trusts what the helper returns, so the extension
  is centralized.
- **Step references mirror the field pattern.** `findStepReferencers` enumerates
  step_dependency edges + `step.dueAnchorStepId` references; step deletion uses the
  same refuse-on-reference posture as field deletion. The `dueAnchorStepId` consumer
  (offset_from_step due rules) is deferred today, but the guard is wired now so it
  can't be forgotten when the consumer ships.

---

## 2026-05-26 — Workflow versioning: draft = only editable; publish = immutable; edit = resume-or-fork

### D-018 — Workflow Builder versioning model

**Context:** Invariants #3 and #4 mandate that runs are immutable snapshots of a
PUBLISHED workflow_version, that editing a template never touches an in-flight or
historical run, and that the snapshot is self-contained. The Workflow Builder is
the surface that produces those published versions; it has to enforce the
invariants by construction, not by convention.

**Decision:** Three operations + one chokepoint + one structural invariant.

1. **Draft is the only editable state.** Every section / step / field / step_dependency
   write routes through a single `assertVersionIsDraft` guard at the api/lib boundary.
   It resolves the version, scopes to the org, and refuses on any status other than
   `draft` (`VERSION_NOT_DRAFT`). One chokepoint = one rule that can't be forgotten.
   The published snapshot is physically immutable through this API.
2. **Publish is atomic + audited.** `publishVersion` transitions
   `workflow_version.status` from `draft` → `published` via an UPDATE with
   `WHERE status='draft'` so two concurrent publishers can't both "succeed"
   (the loser receives `PUBLISH_RACE` and should refetch). Publish refuses on empty
   versions (`VERSION_HAS_NO_STEPS`). An audit + activity pair fires inside the
   same transaction (Invariant #6).
3. **Editing a published workflow = RESUME or FORK.** `editPublished` enforces
   AT MOST ONE OPEN DRAFT per workflow, server-side. If a draft already exists,
   the procedure returns it (`forked: false`). If not, it deep-copies the latest
   published version into a new draft (`forked: true`) and returns the new id.
   The naive "always fork" alternative produces orphan drafts: edit → navigate
   away → edit again → v2 and v3 both open. The product invariant is one open
   draft, so the server owns it — the UI doesn't have to.

**Fork mechanics:**
   - Deep-copy sections, steps, fields, and step_dependencies into the new draft.
   - Field `key` values are preserved VERBATIM — keys are the stable identity
     (Invariant #5), only IDs are per-version.
   - IDs are remapped: `step.sectionId`, `step.dueAnchorStepId`,
     `step.dueSourceFieldId`, `field.stepId`, and both endpoints of
     `step_dependency` get rewritten from the source ids to the freshly-copied ids.
   - References that somehow point outside the version (shouldn't happen with the
     current schema, but defensive) get cleared — the fork is fully independent.
   - In-flight runs hold their own snapshot (Invariant #4) — they are not perturbed.

**Workflow-level archive vs version-level archive:** keep these distinct.
`workflow.deletedAt` (set by `archiveWorkflowOp`) is the WORKFLOW-LEVEL archive — the
whole authored asset is hidden from the Library. `workflow_version.status='archived'`
retires one published version while the workflow itself stays live. Don't blur the
two notions in UI copy or API names.

**Rationale:** A workflow that's seen any use needs a clear "current published"
vs "what's being worked on" boundary. Resume-or-fork is the load-bearing
correctness fix that prevents orphan drafts without making the UI carry the
invariant. The single `assertVersionIsDraft` chokepoint is the kind of guard you
write once and forget — every write goes through it, so there's no way for a new
mutation procedure to forget to check.

**Consequences:**

- No hard delete of workflows. `archiveWorkflowOp` is soft (sets `deletedAt`);
  Invariant #6 (audit/governance is append-only) implies authored content survives
  in history. To wipe everything, drop the org.
- Published versions never mutate. Even a typo-fix in a published step requires a
  fork. The friction is the feature — the published snapshot is what runs depend
  on, and a "small fix" that silently mutates a published version would corrupt
  in-flight execution semantics.
- The acceptance test (`acceptance.test.ts`) walks
  `create → addStructure → publish → launchRun` end-to-end and asserts the run's
  field_value rows reference field rows keyed by the original keys. That single
  test proves the authoring half and the execution half are wired together — if
  it ever fails, the publish-to-launch contract is broken at the field level.
