// packages/database/drizzle/schema/activity.ts
//
// Append-only user-visible activity stream (ARCHITECTURE.md §7 / Invariant #6). Distinct
// from `audit_log` (audit.ts): activity is the timeline a user sees in the UI ("Sam
// completed Step 3 of the move-in inspection"); audit is the forensic record. They overlap
// in shape but diverge in retention, RBAC, and verbosity.
//
// Polymorphic via the shared `entityType` enum + plain `entity_id` text + service-layer
// validation.

import { relations } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { entityType, id, orgId, user } from "./_shared";

export const activityEvent = pgTable(
  "activity_event",
  {
    id: id(),
    organizationId: orgId(),
    actorUserId: text("actor_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    // Past-tense verb naming the event for the UI, e.g. "completed", "commented",
    // "assigned". Free text so packs can extend the vocabulary.
    verb: text("verb").notNull(),
    entityType: entityType("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    // Display payload — title, snippets, mention list, etc. The UI formats from this.
    data: jsonb("data").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("idx_activity_event_org").on(t.organizationId),
    index("idx_activity_event_actor").on(t.actorUserId),
    index("idx_activity_event_entity").on(t.entityType, t.entityId),
    index("idx_activity_event_created_at").on(t.createdAt),
  ],
);

export const activityEventRelations = relations(activityEvent, ({ one }) => ({
  actor: one(user, {
    fields: [activityEvent.actorUserId],
    references: [user.id],
  }),
}));
