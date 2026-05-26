// packages/database/drizzle/schema/governance.ts
//
// Governance / lifecycle records (ARCHITECTURE.md §5, Invariant #6 — append-only with one
// documented exception). `version_approval` and `acknowledgment` are append-only audit:
// once written they are not deleted; `version_approval.decision` may transition from
// pending → approved/rejected (each transition recorded in audit_log, Batch 6). `suggestion`
// is the documented exception: it has a status lifecycle (open → accepted/rejected/merged)
// and a `resolvedBy`/`resolvedAt` pair set when the lifecycle terminates.

import { relations } from "drizzle-orm";
import {
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { id, orgId, timestamps, user } from "./_shared";
import { workflow, workflowVersion } from "./workflows";

export const approvalDecision = pgEnum("approval_decision", [
  "pending",
  "approved",
  "rejected",
]);

export const suggestionStatus = pgEnum("suggestion_status", [
  "open",
  "accepted",
  "rejected",
  "merged",
]);

// Append-only: one row per approval request. The decision flips from `pending` once; never
// edited after `decidedAt` is set (enforced in the service layer; the audit_log keeps the
// transition history).
export const versionApproval = pgTable(
  "version_approval",
  {
    id: id(),
    workflowVersionId: text("workflow_version_id")
      .notNull()
      .references(() => workflowVersion.id, { onDelete: "cascade" }),
    requestedBy: text("requested_by").references(() => user.id, {
      onDelete: "set null",
    }),
    approverId: text("approver_id").references(() => user.id, {
      onDelete: "set null",
    }),
    decision: approvalDecision("decision").notNull().default("pending"),
    note: text("note"),
    decidedAt: timestamp("decided_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_version_approval_version").on(t.workflowVersionId),
    index("idx_version_approval_approver").on(t.approverId),
  ],
);

// The documented exception to invariant #6 — suggestions have a status lifecycle. Authors
// can edit while `open`; once resolved, treat as immutable in application code.
export const suggestion = pgTable(
  "suggestion",
  {
    id: id(),
    organizationId: orgId(),
    workflowId: text("workflow_id")
      .notNull()
      .references(() => workflow.id, { onDelete: "cascade" }),
    suggestedBy: text("suggested_by").references(() => user.id, {
      onDelete: "set null",
    }),
    body: text("body").notNull(),
    status: suggestionStatus("status").notNull().default("open"),
    resolvedBy: text("resolved_by").references(() => user.id, {
      onDelete: "set null",
    }),
    resolvedAt: timestamp("resolved_at"),
    ...timestamps,
  },
  (t) => [
    index("idx_suggestion_org").on(t.organizationId),
    index("idx_suggestion_workflow").on(t.workflowId),
    index("idx_suggestion_status").on(t.status),
    // H2: composite for the most common UI query "open suggestions in my org".
    index("idx_suggestion_org_status").on(t.organizationId, t.status),
  ],
);

// Append-only — one acknowledgment per (workflowVersionId, userId). The unique constraint
// is the dedupe guarantee for the "I've read this version" signal (policy mode).
export const acknowledgment = pgTable(
  "acknowledgment",
  {
    id: id(),
    organizationId: orgId(),
    workflowVersionId: text("workflow_version_id")
      .notNull()
      .references(() => workflowVersion.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    acknowledgedAt: timestamp("acknowledged_at").notNull().defaultNow(),
  },
  (t) => [
    unique("uq_acknowledgment_version_user").on(t.workflowVersionId, t.userId),
    index("idx_acknowledgment_org").on(t.organizationId),
    index("idx_acknowledgment_user").on(t.userId),
  ],
);

export const versionApprovalRelations = relations(
  versionApproval,
  ({ one }) => ({
    version: one(workflowVersion, {
      fields: [versionApproval.workflowVersionId],
      references: [workflowVersion.id],
    }),
    requester: one(user, {
      fields: [versionApproval.requestedBy],
      references: [user.id],
      relationName: "version_approval_requester",
    }),
    approver: one(user, {
      fields: [versionApproval.approverId],
      references: [user.id],
      relationName: "version_approval_approver",
    }),
  }),
);

export const suggestionRelations = relations(suggestion, ({ one }) => ({
  workflow: one(workflow, {
    fields: [suggestion.workflowId],
    references: [workflow.id],
  }),
  author: one(user, {
    fields: [suggestion.suggestedBy],
    references: [user.id],
    relationName: "suggestion_author",
  }),
  resolver: one(user, {
    fields: [suggestion.resolvedBy],
    references: [user.id],
    relationName: "suggestion_resolver",
  }),
}));

export const acknowledgmentRelations = relations(acknowledgment, ({ one }) => ({
  version: one(workflowVersion, {
    fields: [acknowledgment.workflowVersionId],
    references: [workflowVersion.id],
  }),
  user: one(user, {
    fields: [acknowledgment.userId],
    references: [user.id],
  }),
}));
