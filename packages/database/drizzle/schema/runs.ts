// packages/database/drizzle/schema/runs.ts
//
// Execution layer (ARCHITECTURE.md §5, Invariant #3/#4). A run is created by snapshotting a
// published workflow_version. run_step copies title/description so later template edits never
// rewrite history; field definitions are read from the pinned version via field_value.fieldId.

import { relations, sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { id, orgId, softDelete, timestamps, user } from "./_shared";
import {
  field,
  schedule,
  step,
  workflow,
  workflowRole,
  workflowVersion,
} from "./workflows";

export const runStatus = pgEnum("run_status", [
  "active",
  "completed",
  "archived",
]);

export const runStepStatus = pgEnum("run_step_status", [
  "pending",
  "completed",
  "skipped",
  "not_applicable",
]);

// A person on a run: either an internal Better Auth user OR an external guest (email).
// CHECK enforces exactly one identity.
export const participant = pgTable(
  "participant",
  {
    id: id(),
    organizationId: orgId(),
    runId: text("run_id").notNull(), // FK below (run defined after) — see note
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    guestEmail: text("guest_email"),
    guestName: text("guest_name"),
    ...timestamps,
  },
  (t) => [
    index("idx_participant_run").on(t.runId),
    check(
      "participant_identity",
      sql`(${t.userId} is not null) <> (${t.guestEmail} is not null)`,
    ),
  ],
);

export const run = pgTable(
  "run",
  {
    id: id(),
    organizationId: orgId(),
    workflowId: text("workflow_id")
      .notNull()
      .references(() => workflow.id, { onDelete: "cascade" }),
    // Snapshot pointer — the exact version this run was born from.
    workflowVersionId: text("workflow_version_id")
      .notNull()
      .references(() => workflowVersion.id, { onDelete: "restrict" }),
    scheduleId: text("schedule_id").references(() => schedule.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    status: runStatus("status").notNull().default("active"),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    dueAt: timestamp("due_at"),
    completedAt: timestamp("completed_at"),
    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
    ...softDelete,
    ...timestamps,
  },
  (t) => [
    index("idx_run_org").on(t.organizationId),
    index("idx_run_workflow").on(t.workflowId),
    index("idx_run_status").on(t.status),
  ],
);

export const runStep = pgTable(
  "run_step",
  {
    id: id(),
    runId: text("run_id")
      .notNull()
      .references(() => run.id, { onDelete: "cascade" }),
    stepId: text("step_id").references(() => step.id, { onDelete: "set null" }),
    title: text("title").notNull(), // snapshot
    description: text("description"), // snapshot
    position: integer("position").notNull().default(0),
    status: runStepStatus("status").notNull().default("pending"),
    assignedRoleId: text("assigned_role_id").references(() => workflowRole.id, {
      onDelete: "set null",
    }),
    dueAt: timestamp("due_at"),
    completedBy: text("completed_by").references(() => user.id, {
      onDelete: "set null",
    }),
    completedAt: timestamp("completed_at"),
  },
  (t) => [
    index("idx_run_step_run").on(t.runId),
    index("idx_run_step_status").on(t.status),
  ],
);

export const runStepAssignee = pgTable(
  "run_step_assignee",
  {
    id: id(),
    runStepId: text("run_step_id")
      .notNull()
      .references(() => runStep.id, { onDelete: "cascade" }),
    participantId: text("participant_id")
      .notNull()
      .references(() => participant.id, { onDelete: "cascade" }),
  },
  (t) => [unique("uq_run_step_assignee").on(t.runStepId, t.participantId)],
);

// Unified collected value. Kickoff field → runStepId null; step field → runStepId set.
// fieldId points at the pinned version's field definition. One value per field per run.
export const fieldValue = pgTable(
  "field_value",
  {
    id: id(),
    runId: text("run_id")
      .notNull()
      .references(() => run.id, { onDelete: "cascade" }),
    runStepId: text("run_step_id").references(() => runStep.id, {
      onDelete: "cascade",
    }),
    fieldId: text("field_id").references(() => field.id, {
      onDelete: "set null",
    }),
    value: jsonb("value"),
    ...timestamps,
  },
  (t) => [
    unique("uq_field_value_run_field").on(t.runId, t.fieldId),
    index("idx_field_value_run").on(t.runId),
  ],
);

// Binds a domain role to a participant for a specific run.
export const runRoleAssignment = pgTable(
  "run_role_assignment",
  {
    id: id(),
    runId: text("run_id")
      .notNull()
      .references(() => run.id, { onDelete: "cascade" }),
    roleId: text("role_id")
      .notNull()
      .references(() => workflowRole.id, { onDelete: "cascade" }),
    participantId: text("participant_id")
      .notNull()
      .references(() => participant.id, { onDelete: "cascade" }),
  },
  (t) => [unique("uq_run_role_assignment").on(t.runId, t.roleId)],
);

export const runRelations = relations(run, ({ one, many }) => ({
  workflow: one(workflow, {
    fields: [run.workflowId],
    references: [workflow.id],
  }),
  version: one(workflowVersion, {
    fields: [run.workflowVersionId],
    references: [workflowVersion.id],
  }),
  steps: many(runStep),
  participants: many(participant),
  values: many(fieldValue),
  roleAssignments: many(runRoleAssignment),
}));

export const runStepRelations = relations(runStep, ({ one, many }) => ({
  run: one(run, { fields: [runStep.runId], references: [run.id] }),
  assignees: many(runStepAssignee),
  values: many(fieldValue),
}));

export const runStepAssigneeRelations = relations(runStepAssignee, ({ one }) => ({
  runStep: one(runStep, {
    fields: [runStepAssignee.runStepId],
    references: [runStep.id],
  }),
  participant: one(participant, {
    fields: [runStepAssignee.participantId],
    references: [participant.id],
  }),
}));

export const runRoleAssignmentRelations = relations(runRoleAssignment, ({ one }) => ({
  run: one(run, { fields: [runRoleAssignment.runId], references: [run.id] }),
  participant: one(participant, {
    fields: [runRoleAssignment.participantId],
    references: [participant.id],
  }),
}));

export const participantRelations = relations(participant, ({ one }) => ({
  run: one(run, { fields: [participant.runId], references: [run.id] }),
}));

export const fieldValueRelations = relations(fieldValue, ({ one }) => ({
  run: one(run, { fields: [fieldValue.runId], references: [run.id] }),
  runStep: one(runStep, {
    fields: [fieldValue.runStepId],
    references: [runStep.id],
  }),
  field: one(field, { fields: [fieldValue.fieldId], references: [field.id] }),
}));
