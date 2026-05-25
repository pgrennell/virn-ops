// packages/database/drizzle/schema/audit.ts
//
// Append-only audit log (ARCHITECTURE.md Invariant #6). Every state change worth keeping for
// compliance / debugging / "who did what" lands here. Polymorphic via (`entityType`,
// `entityId`) — pair the shared enum from _shared.ts with a plain text column, per the
// codebase convention (never a bare FK to a discriminated table).
//
// `audit_log` is application-level (intent-rich, business-meaningful): "user X published
// workflow_version Y", "approver Z rejected request R". For raw column-level diffs use
// `changes` jsonb (before/after snapshots). The separate `activity_event` table
// (activity.ts) carries user-visible activity-feed events.

import { relations } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { entityType, id, orgId, user } from "./_shared";

export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    organizationId: orgId(),
    actorUserId: text("actor_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    // The verb / event name, e.g. "workflow.published", "approval.decided",
    // "field_definition.created". Free text — no enum, since pack-installed code will
    // emit its own action names.
    action: text("action").notNull(),
    entityType: entityType("entity_type"),
    entityId: text("entity_id"),
    // Before/after diff, request payload, decision context — whatever the writer wants
    // searchable for forensics. Indexable later via GIN if needed.
    changes: jsonb("changes").$type<Record<string, unknown>>(),
    // Optional request metadata (IP, user-agent, oRPC route). Kept distinct from `changes`
    // so we can structure RBAC redactions later.
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_audit_log_org").on(t.organizationId),
    index("idx_audit_log_actor").on(t.actorUserId),
    index("idx_audit_log_entity").on(t.entityType, t.entityId),
    index("idx_audit_log_created_at").on(t.createdAt),
  ],
);

export const auditLogRelations = relations(auditLog, ({ one }) => ({
  actor: one(user, {
    fields: [auditLog.actorUserId],
    references: [user.id],
  }),
}));
