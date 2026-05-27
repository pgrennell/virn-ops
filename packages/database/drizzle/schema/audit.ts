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

import { relations, sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { actorKind, entityType, id, orgId, user } from "./_shared";
import { participant } from "./runs";

export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    organizationId: orgId(),
    // Discriminator for which principal kind acted (ADR-006 + D-022). Populated from the
    // acting participant's kind, or 'user' when the action has no participant context
    // (e.g. org-config writes by an admin acting as themselves outside any run).
    actorKind: actorKind("actor_kind").notNull(),
    actorUserId: text("actor_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    // Cross-entity actor pointer for 'guest' / 'agent' actors whose identity lives in the
    // participant row. Nullable; populated by the new writers in Phase 11 (MCP). Per D-022:
    // added now so the schema is complete and Phase 11 is purely behavioural.
    actorParticipantId: text("actor_participant_id").references(() => participant.id, {
      onDelete: "set null",
    }),
    // The verb / event name, e.g. "workflow.published", "approval.decided",
    // "field_definition.created". Free text — no enum, since pack-installed code will
    // emit its own action names.
    action: text("action").notNull(),
    // Polymorphic target. Both columns NOT NULL — an audit row without an entity is
    // meaningless and would defeat the (entity_type, entity_id) lookup index.
    entityType: entityType("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
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
    index("idx_audit_log_actor_participant").on(t.actorParticipantId),
    index("idx_audit_log_entity").on(t.entityType, t.entityId),
    index("idx_audit_log_created_at").on(t.createdAt),
    // _shared.ts mandates polymorphic FK + CHECK; enforce non-empty entity_id here.
    check("audit_log_entity_id_nonempty", sql`length(${t.entityId}) > 0`),
  ],
);

export const auditLogRelations = relations(auditLog, ({ one }) => ({
  actor: one(user, {
    fields: [auditLog.actorUserId],
    references: [user.id],
  }),
  actorParticipant: one(participant, {
    fields: [auditLog.actorParticipantId],
    references: [participant.id],
  }),
}));
