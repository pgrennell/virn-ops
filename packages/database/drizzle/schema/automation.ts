// packages/database/drizzle/schema/automation.ts
//
// The general event → rule → action automation layer (ARCHITECTURE.md ADR-003). MVP scope is
// run-level: rules attach to a published workflow_version, fire on run lifecycle / field
// events, and apply actions like show/hide step, set field value, send notification. The
// table shape is deliberately general so non-run triggers (record changed, SLA breach,
// inbound webhook) can be added later without a schema rewrite.
//
// `run_rule_fired` is the idempotency ledger — a rule fires at most once per run
// (Invariant #6 / append-only).

import { relations } from "drizzle-orm";
import {
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
import { id, orgId, timestamps } from "./_shared";
import {
  field,
  step,
  workflowRole,
  workflowVersion,
} from "./workflows";
import { run } from "./runs";

export const automationTriggerType = pgEnum("automation_trigger_type", [
  "run_started",
  "task_completed",
  "field_changed",
]);

export const automationRuleLogic = pgEnum("automation_rule_logic", [
  "and",
  "or",
]);

// Comparison operator for a single condition. Value semantics are operator-specific:
// - eq/neq/gt/gte/lt/lte: scalar compare against `value`
// - contains/not_contains: substring (text) or membership (array)
// - in/not_in: `value` is an array
// - is_empty/is_not_empty: `value` ignored
export const automationConditionOperator = pgEnum(
  "automation_condition_operator",
  [
    "eq",
    "neq",
    "gt",
    "gte",
    "lt",
    "lte",
    "contains",
    "not_contains",
    "in",
    "not_in",
    "is_empty",
    "is_not_empty",
  ],
);

export const automationActionType = pgEnum("automation_action_type", [
  "show_step",
  "hide_step",
  "show_field",
  "hide_field",
  "set_required",
  "assign",
  "set_deadline",
  "send_notification",
  "call_webhook",
  "run_workflow",
  "set_field_value",
]);

export const automationRule = pgTable(
  "automation_rule",
  {
    id: id(),
    organizationId: orgId(),
    workflowVersionId: text("workflow_version_id")
      .notNull()
      .references(() => workflowVersion.id, { onDelete: "cascade" }),
    triggerType: automationTriggerType("trigger_type").notNull(),
    // For field_changed / task_completed triggers — which field or step the trigger watches.
    // Null for run_started.
    triggerStepId: text("trigger_step_id").references(() => step.id, {
      onDelete: "cascade",
    }),
    triggerFieldId: text("trigger_field_id").references(() => field.id, {
      onDelete: "cascade",
    }),
    logic: automationRuleLogic("logic").notNull().default("and"),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (t) => [
    index("idx_automation_rule_org").on(t.organizationId),
    index("idx_automation_rule_version").on(t.workflowVersionId),
    index("idx_automation_rule_trigger").on(t.triggerType),
  ],
);

// Conditions in the same `groupIndex` are AND-ed together; groups are combined per
// `automation_rule.logic`. `sourceFieldId` is the field whose value is being tested; null is
// reserved for non-field sources (e.g. step status) once those are added.
export const automationCondition = pgTable(
  "automation_condition",
  {
    id: id(),
    ruleId: text("rule_id")
      .notNull()
      .references(() => automationRule.id, { onDelete: "cascade" }),
    sourceFieldId: text("source_field_id").references(() => field.id, {
      onDelete: "cascade",
    }),
    operator: automationConditionOperator("operator").notNull(),
    value: jsonb("value").$type<unknown>(),
    groupIndex: integer("group_index").notNull().default(0),
    position: integer("position").notNull().default(0),
    ...timestamps,
  },
  (t) => [index("idx_automation_condition_rule").on(t.ruleId)],
);

// Actions are applied in `position` order when the rule fires. Target columns are nullable
// and validated per `actionType`: e.g. show_step needs targetStepId, send_notification reads
// targetRoleId + config jsonb (template, payload).
export const automationAction = pgTable(
  "automation_action",
  {
    id: id(),
    ruleId: text("rule_id")
      .notNull()
      .references(() => automationRule.id, { onDelete: "cascade" }),
    actionType: automationActionType("action_type").notNull(),
    targetStepId: text("target_step_id").references(() => step.id, {
      onDelete: "cascade",
    }),
    targetFieldId: text("target_field_id").references(() => field.id, {
      onDelete: "cascade",
    }),
    targetRoleId: text("target_role_id").references(() => workflowRole.id, {
      onDelete: "set null",
    }),
    config: jsonb("config").$type<Record<string, unknown>>(),
    position: integer("position").notNull().default(0),
    ...timestamps,
  },
  (t) => [index("idx_automation_action_rule").on(t.ruleId)],
);

// Append-only ledger — a rule fires at most once per run. Inngest writes here after
// successfully applying actions; the unique constraint is the idempotency guarantee.
export const runRuleFired = pgTable(
  "run_rule_fired",
  {
    id: id(),
    runId: text("run_id")
      .notNull()
      .references(() => run.id, { onDelete: "cascade" }),
    ruleId: text("rule_id")
      .notNull()
      .references(() => automationRule.id, { onDelete: "cascade" }),
    firedAt: timestamp("fired_at").notNull().defaultNow(),
  },
  (t) => [
    unique("uq_run_rule_fired").on(t.runId, t.ruleId),
    index("idx_run_rule_fired_run").on(t.runId),
  ],
);

export const automationRuleRelations = relations(
  automationRule,
  ({ one, many }) => ({
    version: one(workflowVersion, {
      fields: [automationRule.workflowVersionId],
      references: [workflowVersion.id],
    }),
    triggerStep: one(step, {
      fields: [automationRule.triggerStepId],
      references: [step.id],
      relationName: "automation_rule_trigger_step",
    }),
    triggerField: one(field, {
      fields: [automationRule.triggerFieldId],
      references: [field.id],
      relationName: "automation_rule_trigger_field",
    }),
    conditions: many(automationCondition),
    actions: many(automationAction),
    firings: many(runRuleFired),
  }),
);

export const automationConditionRelations = relations(
  automationCondition,
  ({ one }) => ({
    rule: one(automationRule, {
      fields: [automationCondition.ruleId],
      references: [automationRule.id],
    }),
    sourceField: one(field, {
      fields: [automationCondition.sourceFieldId],
      references: [field.id],
      relationName: "automation_condition_source_field",
    }),
  }),
);

export const automationActionRelations = relations(
  automationAction,
  ({ one }) => ({
    rule: one(automationRule, {
      fields: [automationAction.ruleId],
      references: [automationRule.id],
    }),
    targetStep: one(step, {
      fields: [automationAction.targetStepId],
      references: [step.id],
      relationName: "automation_action_target_step",
    }),
    targetField: one(field, {
      fields: [automationAction.targetFieldId],
      references: [field.id],
      relationName: "automation_action_target_field",
    }),
    targetRole: one(workflowRole, {
      fields: [automationAction.targetRoleId],
      references: [workflowRole.id],
    }),
  }),
);

export const runRuleFiredRelations = relations(runRuleFired, ({ one }) => ({
  run: one(run, { fields: [runRuleFired.runId], references: [run.id] }),
  rule: one(automationRule, {
    fields: [runRuleFired.ruleId],
    references: [automationRule.id],
  }),
}));
