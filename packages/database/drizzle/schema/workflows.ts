// packages/database/drizzle/schema/workflows.ts
//
// Definition layer (ARCHITECTURE.md §5). Templates are authored and versioned here; runs
// (execution.ts) are created by snapshotting a published version. Invariant #3/#4.
//
// Note: conditional visibility is NOT a column-level feature here — steps/sections carry
// `hiddenByDefault`, and the general automation engine (automation.ts, next batch) reveals
// them. Fields (step + kickoff) are unified into one table to give a single per-version
// variable namespace keyed by `field.key` (Invariant #5).

import { relations, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { aiAuthoringPrompt } from "./ai_authoring";
import { reviewState } from "./entitysets";
import { id, orgId, softDelete, timestamps, user, workflowType } from "./_shared";
// Circular import via lazy thunk — see `installedFromListingVersionId` below.
import { templateListingVersion } from "./library";

export const workflowVersionStatus = pgEnum("workflow_version_status", [
  "draft",
  "published",
  "archived",
]);

export const stepType = pgEnum("step_type", [
  "task",
  "approval",
  "heading",
  "one_off",
  "code", // reserved
  "ai", // reserved
]);

export const fieldType = pgEnum("field_type", [
  "text",
  "textarea",
  "number",
  "date",
  "select",
  "multiselect",
  "file",
  "image",
  "signature",
  "member",
  "lookup", // references a data_set (deferred module); ref lives in config jsonb
]);

export const dueType = pgEnum("due_type", [
  "none",
  "offset_from_start",
  "offset_from_step",
  "from_date_field",
]);

export const scheduleFrequency = pgEnum("schedule_frequency", [
  "daily",
  "weekly",
  "monthly",
  "quarterly",
  "yearly",
]);

// Domain roles for step assignment (Approver, Initiator...). Distinct from Better Auth org
// roles, which govern app-level permissions.
export const workflowRole = pgTable(
  "workflow_role",
  {
    id: id(),
    organizationId: orgId(),
    name: text("name").notNull(),
    isInitiator: boolean("is_initiator").notNull().default(false),
    ...timestamps,
  },
  (t) => [index("idx_workflow_role_org").on(t.organizationId)],
);

export const workflow = pgTable(
  "workflow",
  {
    id: id(),
    organizationId: orgId(),
    type: workflowType("type").notNull().default("procedure"),
    title: text("title").notNull(),
    description: text("description"),
    isActive: boolean("is_active").notNull().default(true),
    // Governance: periodic freshness review (SOP mode).
    reviewIntervalDays: integer("review_interval_days"),
    nextReviewAt: timestamp("next_review_at"),
    // Layer-1 entity-set scope (D-034 / PRD §6.1). Empty array = "applies to any entity"
    // (preserves pre-v1.5 behavior — runs.launch surfaces the workflow regardless of the
    // target entity's set memberships). Non-empty array narrows the workflow to runs
    // launched from an entity whose entity_set memberships intersect this list.
    // Stored as text[] (cuid2 ids) rather than uuid[] because the rest of the codebase
    // uses cuid2 PKs; the PRD's uuid[] in §8.1 is illustrative, not a constraint.
    entitySetIds: text("entity_set_ids").array().notNull().default(sql`'{}'`),
    // Editorial review state (PRD §6.1, §8.1). Distinct from workflow_version.status —
    // that's per-version publishing state (draft / published); this is the workflow-as-
    // artifact review state (draft → in_review → published → archived). Workflows with
    // at least one published version are backfilled to `published`; everything else
    // starts at `draft`.
    reviewState: reviewState("review_state").notNull().default("draft"),
    // Library provenance. The `.references()` is a lazy thunk so workflows.ts and library.ts
    // can have mutually-referential FKs (Drizzle resolves the binding at relation-graph time,
    // not at module-evaluation time).
    installedFromListingVersionId: text("installed_from_listing_version_id").references(
      (): AnyPgColumn => templateListingVersion.id,
      { onDelete: "set null" },
    ),
    // Phase 12.1 -- AI authoring provenance. Set when the workflow was created via
    // agents.authorWorkflow; null for hand-authored or pack-installed workflows.
    // SET NULL on delete preserves the workflow if the provenance row is ever pruned
    // (provenance is auditable but not load-bearing for run execution).
    aiAuthoringPromptId: text("ai_authoring_prompt_id").references(
      () => aiAuthoringPrompt.id,
      { onDelete: "set null" },
    ),
    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
    ...softDelete,
    ...timestamps,
  },
  (t) => [index("idx_workflow_org").on(t.organizationId)],
);

export const workflowVersion = pgTable(
  "workflow_version",
  {
    id: id(),
    workflowId: text("workflow_id")
      .notNull()
      .references(() => workflow.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    status: workflowVersionStatus("status").notNull().default("draft"),
    publishedAt: timestamp("published_at"),
    publishedBy: text("published_by").references(() => user.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (t) => [
    unique("uq_workflow_version_number").on(t.workflowId, t.versionNumber),
    index("idx_workflow_version_workflow").on(t.workflowId),
  ],
);

export const section = pgTable(
  "section",
  {
    id: id(),
    workflowVersionId: text("workflow_version_id")
      .notNull()
      .references(() => workflowVersion.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    position: integer("position").notNull().default(0),
    hiddenByDefault: boolean("hidden_by_default").notNull().default(false),
    ...timestamps,
  },
  (t) => [index("idx_section_version").on(t.workflowVersionId)],
);

export const step = pgTable(
  "step",
  {
    id: id(),
    workflowVersionId: text("workflow_version_id")
      .notNull()
      .references(() => workflowVersion.id, { onDelete: "cascade" }),
    sectionId: text("section_id").references(() => section.id, {
      onDelete: "set null",
    }),
    assignedRoleId: text("assigned_role_id").references(() => workflowRole.id, {
      onDelete: "set null",
    }),
    type: stepType("type").notNull().default("task"),
    title: text("title").notNull(),
    description: text("description"),
    position: integer("position").notNull().default(0),
    isRequired: boolean("is_required").notNull().default(true),
    requiresAllAssignees: boolean("requires_all_assignees")
      .notNull()
      .default(false),
    isStopTask: boolean("is_stop_task").notNull().default(false),
    hiddenByDefault: boolean("hidden_by_default").notNull().default(false),
    // Structured deadline. Anchors are plain text (self/field refs) to avoid circular
    // thunks; resolved by the run-creation service.
    dueType: dueType("due_type").notNull().default("none"),
    dueOffsetDays: integer("due_offset_days"),
    dueAnchorStepId: text("due_anchor_step_id"),
    dueSourceFieldId: text("due_source_field_id"),
    ...timestamps,
  },
  (t) => [
    index("idx_step_version").on(t.workflowVersionId),
    index("idx_step_section").on(t.sectionId),
  ],
);

// Unified field table: a kickoff/launch field has stepId = null; a step field has it set.
// `key` is unique within the version → one variable namespace for merge fields,
// conditions, and automations (Invariant #5).
export const field = pgTable(
  "field",
  {
    id: id(),
    workflowVersionId: text("workflow_version_id")
      .notNull()
      .references(() => workflowVersion.id, { onDelete: "cascade" }),
    stepId: text("step_id").references(() => step.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    label: text("label").notNull(),
    fieldType: fieldType("field_type").notNull(),
    config: jsonb("config").$type<Record<string, unknown>>(), // options, lookup ref, etc.
    isRequired: boolean("is_required").notNull().default(false),
    position: integer("position").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    unique("uq_field_version_key").on(t.workflowVersionId, t.key),
    index("idx_field_step").on(t.stepId),
  ],
);

// Stop-task / sequencing: step cannot start until depends_on_step is complete.
export const stepDependency = pgTable(
  "step_dependency",
  {
    id: id(),
    stepId: text("step_id")
      .notNull()
      .references(() => step.id, { onDelete: "cascade" }),
    dependsOnStepId: text("depends_on_step_id")
      .notNull()
      .references(() => step.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (t) => [unique("uq_step_dependency").on(t.stepId, t.dependsOnStepId)],
);

// Recurring auto-creation of runs.
export const schedule = pgTable(
  "schedule",
  {
    id: id(),
    organizationId: orgId(),
    workflowId: text("workflow_id")
      .notNull()
      .references(() => workflow.id, { onDelete: "cascade" }),
    frequency: scheduleFrequency("frequency").notNull(),
    recurrenceConfig: jsonb("recurrence_config").$type<
      Record<string, unknown>
    >(),
    timezone: text("timezone").notNull().default("UTC"),
    nextRunAt: timestamp("next_run_at"),
    defaultAssigneeId: text("default_assignee_id").references(() => user.id, {
      onDelete: "set null",
    }),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (t) => [
    index("idx_schedule_workflow").on(t.workflowId),
    // H5: partial index — the cron sweeper only ever queries `WHERE is_active AND
    // next_run_at IS NOT NULL AND next_run_at <= now()`. A partial index restricted
    // to that predicate is dramatically smaller than the full b-tree and skips all
    // inactive/unscheduled rows during the scan.
    index("idx_schedule_next_run")
      .on(t.nextRunAt)
      .where(sql`${t.isActive} = true AND ${t.nextRunAt} IS NOT NULL`),
  ],
);

export const workflowRelations = relations(workflow, ({ many }) => ({
  versions: many(workflowVersion),
  schedules: many(schedule),
}));

export const workflowVersionRelations = relations(
  workflowVersion,
  ({ one, many }) => ({
    workflow: one(workflow, {
      fields: [workflowVersion.workflowId],
      references: [workflow.id],
    }),
    sections: many(section),
    steps: many(step),
    fields: many(field),
  }),
);

export const sectionRelations = relations(section, ({ one, many }) => ({
  version: one(workflowVersion, {
    fields: [section.workflowVersionId],
    references: [workflowVersion.id],
  }),
  steps: many(step),
}));

export const stepRelations = relations(step, ({ one, many }) => ({
  version: one(workflowVersion, {
    fields: [step.workflowVersionId],
    references: [workflowVersion.id],
  }),
  section: one(section, {
    fields: [step.sectionId],
    references: [section.id],
  }),
  assignedRole: one(workflowRole, {
    fields: [step.assignedRoleId],
    references: [workflowRole.id],
  }),
  fields: many(field),
}));

export const fieldRelations = relations(field, ({ one }) => ({
  version: one(workflowVersion, {
    fields: [field.workflowVersionId],
    references: [workflowVersion.id],
  }),
  step: one(step, { fields: [field.stepId], references: [step.id] }),
}));

export const scheduleRelations = relations(schedule, ({ one }) => ({
  workflow: one(workflow, {
    fields: [schedule.workflowId],
    references: [workflow.id],
  }),
}));
