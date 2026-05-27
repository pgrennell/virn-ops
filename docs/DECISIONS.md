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

---

## 2026-05-27 — Workflow Builder Preview is a no-side-effect dry render, not a throwaway run

### D-019 — Builder Preview neutralizes mutations rather than launching a real run

**Context:** UX_SPEC §4.3 originally described Preview as *"launches a throwaway run
to test"* — the intuitive reading of "preview" inherited from many builder tools.
When Pass 2 of the Workflow Builder shipped (`6ccd5af`), the implementation pivoted
to a dry render instead: the canvas pivots into a synthesized run-shaped view via a
small definition→synthetic-run adapter (`buildPreviewFromBundle`) and the same
`RunStepList` / `RunStepPanel` primitives paint it. The mutation callbacks
(`onSetFieldValue`, `onCompleteStep`) are wired to `PREVIEW_NOOP_*` -- functions
exported from `apps/saas/modules/builder/lib/preview-callbacks.ts` that, by
construction, don't import the oRPC client and can't reach any mutation.

**Decision:** Preview is a dry render. It never calls `runs.launch`,
`runs.setFieldValue`, `runs.completeStep`, or any other procedure that mutates
server state. The author sees what the operator will see; nothing reaches Postgres.

**Rationale:**

- The Pass 1 acceptance test + the Pass 2.5 Neon walk already exercise the real
  launch path against actual Postgres. Preview's job is "what will the operator
  see?", not "does launch work?" -- the latter is proven elsewhere.
- A real throwaway run produces side effects that linger: a `run` row, audit
  entries, activity events, potentially `participant` rows. "Throwaway" implies a
  cleanup pass that the author has to remember to run -- friction the dry render
  removes.
- Authors will preview frequently while iterating on the draft. Each throwaway run
  would compound audit-log + activity-feed noise in the org's history.
- The no-side-effect guarantee is testable in isolation: `preview-callbacks.ts`
  doesn't import `@shared/lib/orpc`, and the BuilderView source's `PreviewBody`
  branch contains zero mutation references. Three regression tests assert this.

**Consequences:**

- Anything that depends on observing a real run's behavior (run-engine cascade,
  step_dependency resolution at run time, audit + activity writes) is NOT covered
  by Preview. Authors who need to verify that behavior launch via the Library's
  Run action, same as an operator.
- UX_SPEC §4.3's "throwaway run" phrasing is superseded by this decision. The
  spec is updated in the same change set; this entry is the authoritative record
  of the pivot.
- If a future feature genuinely needs a "throwaway run" surface (e.g. a dedicated
  "rehearsal mode" with full automation firing), introduce it under a different
  name -- don't conflate it with Preview.

---

## 2026-05-27 — @virn/api wildcard export is a temporary scaffolding, not a contract

### D-020 — Replace `@virn/api` wildcard subpath export with curated entries

**Context:** When the Pass 2.5 Neon walk script needed to call the Workflow Builder
lib functions directly (bypassing the oRPC HTTP layer because the alternative was a
browser-side session cookie the script can't acquire), I added an `exports` field
to `packages/api/package.json`:

```json
"exports": {
  ".": "./index.ts",
  "./modules/workflows/lib": "./modules/workflows/lib/index.ts",
  "./*": "./*.ts",
  "./*.ts": "./*.ts"
}
```

The first two entries are curated subpath exports. The wildcard `./*` exists ONLY
because adding any `exports` field turns it into an allowlist -- without the
wildcard, existing saas-side deep imports (`@virn/api/orpc/router`,
`@virn/api/modules/payments/procedures/list-purchases`) would have broken at
type-check time. The wildcard was added reactively to avoid bundling a saas-wide
import refactor into the walk-script change.

**Decision:** The wildcard is intentional scaffolding, not a permanent
architectural choice. Before more code accretes deep imports against it, replace
it with curated subpath exports covering exactly what saas + tooling/scripts
legitimately need, then migrate the existing deep imports to use those entries.
The end state is an `exports` field that documents the package's public surface
explicitly rather than re-exposing the entire internal directory.

**Rationale:**

- The wildcard nullifies the encapsulation the `exports` field is supposed to
  buy. Any deep import inside `@virn/api` -- private helpers, test fixtures,
  internal lib modules -- becomes a publicly reachable contract by default.
- Deep-import surfaces are easy to open and painful to close. Each consumer that
  starts depending on a wildcard-exposed path becomes a migration step later.
- The legitimate consumers are small and known today: saas's `orpc/router` +
  `payments/procedures/list-purchases`, plus tooling/scripts' Builder lib +
  launch-run. A curated exports map of ~5 entries covers them.

**Concrete cleanup:**

1. Audit current `@virn/api/...` deep imports across saas + tooling/scripts.
2. Add a curated subpath export entry per legitimate consumer path.
3. Drop the `./*` / `./*.ts` wildcards.
4. Re-run `pnpm safety-check` to confirm nothing else was leaning on the
   wildcards quietly.

**Status:** Not a blocker. The wildcard works today and the Pass 3 build is green
with it in place. Logged here so the cleanup doesn't drift into ambient debt.

---

## 2026-05-26 — Hard pivot: vertical-first property ops + AI-credible v1

### D-021 — Pivot from "platform of process-shaped products" lead to "property-ops OS" lead; AI moves from deferred to in-scope for v1

**Context:** STRATEGY.md v1 (drafted same day) anchored to four reference products
(Manifestly, Process Street, SweetProcess, Tallyfy), framed the public story as
"platform of process-shaped products," and parked AI (S-01), Data Sets (S-02),
reader-KB (S-03), and the agent-native MCP surface (S-01a) in the reserved /
deferred column. A growth-scorecard competitive read prepared 2026-05-26 sharpened
the picture: the four reference products are flat-or-fading (Process Street's last
raise was 2020; SweetProcess is a $2.8M / 13-year lifestyle business), while the
capital and mindshare in the category have moved decisively to two cohorts — the
AI-native orchestrators (n8n at $2.5B / $40M+ ARR / 10× usage YoY; Gumloop;
Lindy) and the AI-powered capture / "what should we automate" tier (Scribe at
$1.3B / 78K paying orgs / 2× rev YoY; Tango; Guidde). The category has moved while
we were architecting against the wrong anchors. Continuing on the v1 plan would
ship a 2026 product that looks like 2023.

**Decision:** A hard pivot — narrowed positioning, re-anchored competitive frame,
re-sequenced build plan. Four interlocking moves:

1. **Lock the vertical.** Property operations (STR turnover & housekeeping as
   the concrete first shape; expanding to inspections, maintenance routing,
   vendor/tenant onboarding). Stops being "the natural first pack among
   several" — becomes *the product* for the next 12 months. Ties directly into
   Virn PM as adjacent product.
2. **Re-anchor the competitive frame.** Demote Manifestly / Process Street /
   SweetProcess / Tallyfy to *data-shape lessons* — they are no longer the
   strategic competitors. Promote the AI-native cohort (Scribe, Tango, n8n,
   Lindy, Gumloop) to the strategic frame. We do not try to be n8n; we win the
   property-ops vertical decisively on an *AI-credible* substrate.
3. **Promote the wedge.** S-07 (one authored procedure → three execution modes:
   human checklist / AI-assisted / fully automated) becomes the headline
   product story. This is the unclaimed white space — only Tango (in capture)
   is gesturing at it, and our single-content-object substrate (Invariants
   #2–#5) is what makes it tractable for us and hard for incumbents to
   retrofit. Distinct framing from "we have AI features."
4. **Re-sequence the build.** AI authoring + the agent-native MCP surface +
   Data Sets (minimal subset) + reader-facing KB + operator surfaces +
   lightweight monitor view + thin compliance/evidence surface all move from
   "deferred" / "v1.1 fast-follow" into **v1 completeness**. Partner (not
   build) for screen-capture authoring — import a Tango/Scribe export as a
   draft `workflow_version`. See BUILD_PLAN.md for the new phase order.

**Rationale:** Two facts forced the call. **First**, the four reference products
were the wrong strategic anchors — the market has moved past them, and a v1 that
benchmarks against them ships looking a generation behind. **Second**, our
architecture is uniquely positioned for the AI-native turn: strict org-scoping,
append-only audit, definition/execution split, stable field keys, and a clean
oRPC procedure layer are *exactly* the shape a safe, auditable agent action
surface needs — the incumbents would have to retrofit it; we already have it.
Combining the vertical-first discipline with the AI-credible substrate is a
defensible position; doing neither is not.

The "platform of process-shaped products" framing is not deleted — it remains the
long-term architectural truth (packs/config/RBAC/data-model machinery is
preserved verbatim). It moves from *public lead* to *long-term moat behind the
vertical win*. The win condition is: prove the vertical, then the pack model
repeats it cheaply.

**Consequences:**

- **STRATEGY.md** is rewritten — §1 bet, §2 reference set, §4 gap ranking,
  §5 bets re-sequenced, §6 scorecard reframed. The four-product table moves to
  an appendix labeled "data-shape lessons (historical)." S-01, S-02, S-03,
  S-07 are promoted from "reserved/deferred" to "v1." S-04 (narrow-first) is
  tightened: the vertical is locked, not still being chosen.
- **BUILD_PLAN.md** is re-sequenced. AI authoring (prompt→workflow + Tango/
  Scribe import) + the MCP agent surface + Data Sets minimal subset
  (`data_set` reference lists + `lookup` field type) + reader-KB surface +
  operator surfaces (My Work / Run view) + a thin run-summary view all enter
  v1. Pack marketplace and Slack/Teams delivery (S-09) remain post-v1.
- **ARCHITECTURE.md** §1 vision is reframed to lead with property ops. The
  platform mechanic is preserved as the *layered* architecture — it is no
  longer the headline of the Vision section. §7 MVP scope shifts accordingly
  (Data Sets moves from "Reserved" to "In v1"; AI authoring + MCP move from
  implicit-deferred to "In v1"). Invariants (§3) are unchanged. ADRs are
  unchanged. The foundation is the substrate that makes the pivot *possible*.
- **agents.md** Part 1 "what this is" is rewritten to lead with property ops
  and the one-procedure-three-modes wedge. Part 2 (framework conventions) is
  unchanged.
- **BRANDING.md**: Virn Ops is described as the property-ops OS (with the
  long-term platform moat noted). The product-family architecture (Virn Ops +
  Virn PM on a shared foundation) is unchanged.
- **UX_SPEC.md**: §1 reference-set sentence is rewritten. §3 nav phase tags
  shift — operator screens (§5) move from `[DESIGNED · build deferred]` to
  `[NOW]` because vertical-first means execution surfaces are launch-critical,
  not v1.1.
- **SCRATCHPAD.md**: the pause-and-reconsider entry is marked acted-on
  (pointing at this decision); the marketing-copy draft is marked superseded
  (vertical-first lead, not platform-first).
- **Memory**: the project memory "AI work (S-01) is deferred — focus is
  non-AI core" is deleted as stale. A new memory records the pivot direction.
- **Shipped foundation code is untouched.** D-001 through D-020 stand. The
  pivot is in framing, sequencing, and *what we build next* — not in unwinding
  what's already built. The pack mechanism, RBAC scaffolding, content-object
  model, snapshot isolation, two-axis gating, governance data model all carry
  forward as-is.

**No-going-back stance.** Per the user's explicit direction (2026-05-26),
this is a hard pivot, not a tentative direction. References to the
four-reference-product framing, "AI deferred," and "platform-of-process-products"
as the lead positioning are removed from forward-looking docs. The historical
context survives in this entry, in the SCRATCHPAD competitive-read excerpts, and
in git history — but it does not appear in any doc that drives future build
decisions.

---

## 2026-05-27 — Agent principal model: implementation specifics for ADR-006

### D-022 — Agent table + participant kind extension + audit attribution

**Context:** ARCHITECTURE.md ADR-006 (2026-05-27) locks the *shape* of the agent
principal model — hybrid: org-scoped `agent` table + `participant.kind=agent` +
`participant.agentId` FK, with `run_step_assignee` unchanged. This entry locks the
*implementation specifics* — concrete column shapes, the migration sequence, the
credential storage choice, and the audit-attribution column — so Phase 8 (S-07
wedge) has a deterministic target to land against.

**Decision:** Phase 8 ships these schema changes in a single migration (no agent-aware
code lands until the schema is in place):

1. **New file `drizzle/schema/agents.ts`.** Holds the `agent` table + an
   `agent_capability` join (per-agent capability grants). One file per domain group
   (D-001 convention).

2. **`agent` table — org-scoped, top-level (D-006 convention).** Columns:
   - `id text PK` (`cuid()` via the shared helper, D-007).
   - `organizationId text NOT NULL REFERENCES organization(id)` (Invariant #1, top-level
     entity per D-006).
   - `name text NOT NULL` — human-readable name for the agent ("Turnover AI", "Inspection
     Drafter"). Unique per org via `UNIQUE(organizationId, name)`.
   - `description text` — what this agent does (helps humans assigning it work).
   - `credentialHash text NOT NULL` — bcrypt/argon2 hash of the API-key-shaped credential.
     **Never store the plaintext.** The plaintext is shown once on creation and never again
     (the standard service-account pattern). Credential format TBD in Phase 11 (MCP) — the
     hash column is shape-agnostic.
   - `credentialLastFour text` — last 4 chars of the plaintext credential for UI display
     ("…a3f9"). Convenience only; not a secret.
   - `credentialRotatedAt timestamp` — set on creation and on every rotation. Drives
     "your agent credential is 90 days old, consider rotating" UI later.
   - `isActive boolean NOT NULL DEFAULT true` — soft-disable without delete. A disabled
     agent fails authentication at the MCP boundary (the participant rows remain for
     historical audit, but the agent can't act).
   - `createdByUserId text REFERENCES user(id)` — which human created the agent (audit
     attribution for the creation event).
   - `timestamps` (createdAt + updatedAt, shared helper).
   - `deletedAt timestamp` — three-bucket soft delete (D-006 convention), since an agent
     is user-deletable. Historical `participant` rows pointing at a soft-deleted agent
     still join correctly; new authentication fails.

3. **`agent_capability` join table.** Per-agent capability grants composed with org-level
   capabilities (ADR-006 capability composition):
   - `id text PK`
   - `agentId text NOT NULL REFERENCES agent(id) ON DELETE CASCADE`
   - `capabilityId text NOT NULL REFERENCES capability(id)`
   - `UNIQUE(agentId, capabilityId)`
   - `createdAt timestamp`
   - No `organizationId` (descendant table per D-006 — derives through `agent.organizationId`).
   - No `deletedAt` — grants are added/removed, not soft-deleted.

4. **`participant.kind` enum extension.** Currently `{user, guest}`; add `agent`. This is
   an `ALTER TYPE … ADD VALUE` migration on the existing pgEnum.

5. **`participant.agentId text` column.** Nullable; `REFERENCES agent(id) ON DELETE
   RESTRICT` (an agent with any historical participant rows can't be hard-deleted; it gets
   soft-deleted via `agent.deletedAt`). CHECK constraint:
   `(kind = 'agent') = (agentId IS NOT NULL)` — kind and FK presence stay in lockstep,
   same shape as the existing `userId`/`email` discriminator.

6. **`audit_log.actorKind` enum + column.** New pgEnum `actor_kind ∈ {user, guest, agent}`.
   `audit_log.actorKind` is `NOT NULL`. Backfill all existing rows to `'user'` in the same
   migration (the only writers today are human-triggered). Going forward, every audit
   write sets `actorKind` from the acting participant's kind (or `'user'` when the action
   has no participant context, e.g. org-config writes by an admin acting *as themselves*
   outside any run). The existing `actorUserId` column stays — it's populated for `'user'`
   actors; nullable for `'agent'` / `'guest'` actors (the actor identity for those is in
   the participant row, which the audit row already links via `entityId` when relevant or
   via a new optional `actorParticipantId` column for cross-entity actions).
   - **Open detail:** whether to add `audit_log.actorParticipantId text NULLABLE
     REFERENCES participant(id)` in this same migration, or defer to Phase 11 when the
     MCP write path actually populates it. Working assumption: **add it now** so the
     schema is complete and Phase 11 is purely behavioral.

7. **Activity event mirror.** `activity_event` gets the same `actorKind` enum column
   (parallel to D-011's separation — `activity_event` is the user-facing timeline; agents
   need to be visible there too: "Turnover AI completed Step 3").

**Why these specifics:**

- **Top-level org-scoping on `agent` (not on `agent_capability`)** follows D-006 — only
  the entry point of an entity chain carries `organizationId`. `agent_capability` derives
  through `agent.organizationId` via FK chain, and the capability resolver already joins
  through the parent for tenant filtering.
- **Credential as a hash, not plaintext** is the only correct answer for any secret stored
  server-side. The plaintext is shown once on creation (the standard service-account
  pattern that every infra tool uses) and the user is responsible for storing it. Hashing
  algorithm: argon2id via the same library Better Auth uses for password hashing if exposed,
  otherwise `@node-rs/argon2`. Decide in Phase 11 — the column is shape-agnostic.
- **`UNIQUE(organizationId, name)`** prevents two agents in the same org sharing a name —
  the name is the human's primary handle ("which agent is acting?"), so collisions would
  confuse the assignment + audit UI. Cross-org collisions are fine (each org has its own
  namespace).
- **`audit_log.actorKind` denormalized, not derived via join.** Audit reads are
  high-volume (every admin view of a run pulls the audit feed); deriving `actor_kind`
  via a join through `actorParticipantId → participant.kind` per row would multiply
  the query cost. Denormalize the kind onto `audit_log` itself; the participant FK is
  still there for the full identity join when needed.
- **Soft-delete on `agent`, hard-CASCADE on `agent_capability`.** Agents are
  user-deletable but their historical participant rows reference them — `ON DELETE
  RESTRICT` on `participant.agentId` enforces this. Capability *grants* have no
  historical-reference concern (revoking a capability doesn't unwind any past action),
  so cascade-on-delete is fine for the join.
- **No `agent`-scoped audit attribution column on `agent` itself** — every agent action
  is audited via the existing `audit_log` (with `actorKind='agent'` + the participant
  FK). Agent *creation/modification* events are audited the same way, with
  `actorKind='user'` + `actorUserId` set to the admin who did it. Don't introduce a
  parallel `agent_event` table.

**Consequences:**

- Phase 8 (BUILD_PLAN.md) ships exactly this migration before any agent-aware code
  lands. The `participant.kind` enum extension is an `ALTER TYPE ADD VALUE` —
  consistent with D-003's stance on extending enums up front while data volume is low.
- Phase 11 (MCP) layers the credential validation + the actual write path (find-or-create
  the per-run participant row, set `actorKind='agent'` on every audit/activity write).
  No additional schema; the foundation is already in place from Phase 8.
- The existing audit infrastructure (`writeAuditAndActivity`) needs one parameter
  addition: `actorKind: 'user' | 'guest' | 'agent'` (default `'user'` to preserve current
  call sites). All existing callers default-thread through unchanged; only the new MCP
  write path and the run-engine assignee handling need to pass `'agent'`.
- **Out of scope, decide later:** agent-to-agent delegation; cross-org agents (a Virn-owned
  "platform agent" usable across tenants); agent OAuth flows for action-on-behalf-of a
  user; agent fine-grained ACLs beyond capability gating. ADR-006 explicitly defers these.
