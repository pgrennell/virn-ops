# BUILD_PLAN.md

Phased roadmap for building Virn. Each phase is roughly one Claude Code session — verify and
commit between phases. Follow CLAUDE.md conventions and ARCHITECTURE.md invariants throughout.
Do not run migrations against Neon without explicit confirmation.

## Phase 0 — base (verify)

Supastarter cloned, switched to Drizzle, Neon wired (pooled = app, direct = migrations),
`@virn/*` scope applied, the four schema files (`_shared`, `config`, `workflows`, `runs`) wired
into `schema/postgres.ts`, `pnpm --filter database generate` succeeds, app boots with `pnpm dev`.

## Phase 1 — complete the data model

Add the remaining schema files, matching the existing four exactly. Use shared helpers; extend
the `entityType` enum in `_shared.ts` as new polymorphic targets appear.

**Batch 2 — automation.ts** (general event → rule → action engine, ADR-003)
- `automation_rule` (workflowVersionId, triggerType: run_started|task_completed|field_changed,
  logic: and|or, isActive)
- `automation_condition` (ruleId, sourceFieldId → field nullable, operator, value, groupIndex)
- `automation_action` (ruleId, actionType: show_step|hide_step|show_field|hide_field|set_required|
  assign|set_deadline|send_notification|call_webhook|run_workflow|set_field_value, targetStepId,
  targetFieldId, targetRoleId, config jsonb)
- `run_rule_fired` (runId, ruleId, firedAt; unique(runId, ruleId)) — rules fire once per run

**Batch 3 — governance.ts** (append-only except suggestion)
- `version_approval` (workflowVersionId, requestedBy, approverId nullable, decision:
  pending|approved|rejected, note, decidedAt, createdAt)
- `suggestion` (organizationId, workflowId, suggestedBy, body, status: open|accepted|rejected|
  merged, resolvedBy, resolvedAt, timestamps)
- `acknowledgment` (organizationId, workflowVersionId, userId, acknowledgedAt;
  unique(workflowVersionId, userId))

**Batch 4 — library.ts** (cross-tenant exception — NOT org-scoped)
- `template_category` (slug unique, name, parentId nullable)
- `template_listing` (publisherOrganizationId nullable = first-party, categoryId, contentType,
  title, summary, coverImageKey, slug unique, visibility: private|link|organization|public,
  shareToken nullable, isOfficial, installCount, status)
- `template_listing_version` (listingId, sourceWorkflowVersionId → workflowVersion, versionNumber,
  changelog, publishedAt)
- `template_review` (listingId, reviewerUserId, rating, body, timestamps)
- Wire `workflow.installedFromListingVersionId` → `template_listing_version` FK

**Batch 5 — platform** (split: packs.ts, fields.ts, entitlements.ts, rbac.ts)
- packs: `solution_pack`, `pack_version` (manifest jsonb), `pack_install` (per org)
- fields: `object_type` (reserved), `field_definition` (key, objectTypeId nullable, scope:
  platform|pack|org, organizationId nullable, dataType, defaultValue, validationSchema, …)
- entitlements: `plan`, `plan_capability` (plan → capability grants + limits)
- rbac: `role` (custom, org-scoped), `permission` (resourceType/action/scope), `group`,
  `group_member`, `role_assignment` — layered on Better Auth org roles

**Batch 6 — cross-cutting** (audit.ts / activity.ts / collab.ts)
- `audit_log` (append-only), `activity_event` (append-only), `comment` + `comment_mention`
  (polymorphic), `attachment` (polymorphic), `tag` + `taggable` (polymorphic), `webhook`.
- NOTE: do **not** add a notification table — reuse Better Auth's existing one. Ask first if
  app-specific notification types are needed.

**Batch 7 — datasets.ts** (reserved / deferred, schema only)
- `data_set`, `data_set_field`, `data_set_record`

## Phase 2 — config / mode system

Seed `capability` + `setting_definition` rows. Define the three enablement profiles
(checklist / SOP / automation) as capability sets. Build/port the resolver
(`getEffectiveCapabilities`, `getEffectiveSettings`, `isCapabilityEnabledForOrg`,
`applyEnablementProfile`) and the org-config admin UI. **Port from Propvana** (see graft below).

## Phase 3 — run engine

The run-creation service: snapshot a published `workflow_version` into `run` + `run_step` rows,
resolve role → participant assignments, compute structured due dates, enforce stop-task gating,
and handle run-step status transitions. Inngest for scheduled (recurring) runs.

## Phase 4 — oRPC API surface

Workflow/version/step/field CRUD; run operations (start, complete step, set field value); config
procedures. All org-scoped via `protectedOrgProcedure` / `adminOrgProcedure`. Port Propvana's
oRPC procedure scaffolding + middleware.

## Phase 5 — UI

Workflow builder (definition), run/checklist view (execution), dashboard / my-work, config admin.
Sub-phase as needed.

## Phase 6 — automation execution

Inngest functions that evaluate `automation_rule` on events and apply actions; `run_rule_fired`
idempotency so each rule fires once per run.

## Phase 7 — template library

Publish a version → listing; install = deep-clone into the org with provenance
(`installedFromListingVersionId`); categories + browse/import UI. Seed first-party templates.

## Phase 8 — governance, packs, first vertical

Approvals / reviews / acknowledgments flows; the `solution_pack` install mechanism; then build
**one** process-shaped vertical pack end-to-end as proof — STR turnover & housekeeping,
marketing ops, or compliance SOPs. (Full property management is **not** a pack — that's Virn PM,
a separate app on the shared foundation; see `docs/ARCHITECTURE.md` §1.)

## Propvana graft (parallel, woven into Phases 2 & 4)

Port the KEEP list from the sibling repo `C:\Projects\Virn\virn-pm` (formerly `propvana-app`
before the Propvana → Virn PM rename): auth customizations (invitation-only plugin,
`requireOrganization`, `ActiveOrganizationProvider`), the org-config resolver/procedures/admin UI,
the oRPC procedures + middleware, shared packages, and the cross-cutting conventions. A dedicated
graft prompt will be provided when you reach Phase 2.
