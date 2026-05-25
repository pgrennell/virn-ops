// packages/database/drizzle/schema/collab.ts
//
// Cross-cutting collaboration + integration tables (BUILD_PLAN.md Batch 6). All polymorphic
// targets use the shared `entityType` enum + plain `entity_id` text column, per
// ARCHITECTURE.md §6 ("polymorphic FK + CHECK on entityType — not a bare FK").
//
// Tables: comment, comment_mention, attachment, tag, taggable, webhook. Soft-delete via
// `deletedAt` on user-deletable rows (comments, attachments); tags are lifecycle-managed.

import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import {
  entityType,
  id,
  lifecycleStatus,
  orgId,
  softDelete,
  timestamps,
  user,
} from "./_shared";

// Polymorphic. Body is markdown / rich text — render-time concern, stored verbatim.
export const comment = pgTable(
  "comment",
  {
    id: id(),
    organizationId: orgId(),
    entityType: entityType("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    authorUserId: text("author_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    body: text("body").notNull(),
    ...softDelete,
    ...timestamps,
  },
  (t) => [
    index("idx_comment_org").on(t.organizationId),
    index("idx_comment_entity").on(t.entityType, t.entityId),
    index("idx_comment_author").on(t.authorUserId),
  ],
);

// Drives notifications and the @-mention popover. One row per mentioned user per comment.
export const commentMention = pgTable(
  "comment_mention",
  {
    commentId: text("comment_id")
      .notNull()
      .references(() => comment.id, { onDelete: "cascade" }),
    mentionedUserId: text("mentioned_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("uq_comment_mention").on(t.commentId, t.mentionedUserId),
    index("idx_comment_mention_user").on(t.mentionedUserId),
  ],
);

// Polymorphic. Storage backend (S3) referenced by `fileKey`; binary lives outside the DB.
export const attachment = pgTable(
  "attachment",
  {
    id: id(),
    organizationId: orgId(),
    entityType: entityType("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    uploaderUserId: text("uploader_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    fileKey: text("file_key").notNull(),
    filename: text("filename").notNull(),
    mimeType: text("mime_type"),
    sizeBytes: integer("size_bytes"),
    ...softDelete,
    ...timestamps,
  },
  (t) => [
    index("idx_attachment_org").on(t.organizationId),
    index("idx_attachment_entity").on(t.entityType, t.entityId),
    index("idx_attachment_uploader").on(t.uploaderUserId),
  ],
);

// Tag catalog — org-scoped. `key` is the stable identifier; `name` and `color` are display.
export const tag = pgTable(
  "tag",
  {
    id: id(),
    organizationId: orgId(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    color: text("color"),
    status: lifecycleStatus("status").notNull().default("active"),
    ...timestamps,
  },
  (t) => [
    unique("uq_tag_org_key").on(t.organizationId, t.key),
    index("idx_tag_org").on(t.organizationId),
  ],
);

// Polymorphic join: tag ↔ any taggable entity. Same polymorphic shape as comments.
export const taggable = pgTable(
  "taggable",
  {
    tagId: text("tag_id")
      .notNull()
      .references(() => tag.id, { onDelete: "cascade" }),
    entityType: entityType("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("uq_taggable").on(t.tagId, t.entityType, t.entityId),
    index("idx_taggable_entity").on(t.entityType, t.entityId),
  ],
);

// Outbound webhook subscription. `events` is the list of event names this endpoint receives
// (text array — Postgres native). `secret` is the HMAC-signing key; encrypt at rest in the
// application layer.
export const webhook = pgTable(
  "webhook",
  {
    id: id(),
    organizationId: orgId(),
    name: text("name").notNull(),
    url: text("url").notNull(),
    secret: text("secret"),
    events: text("events").array().notNull().default([]),
    isActive: boolean("is_active").notNull().default(true),
    ...softDelete,
    ...timestamps,
  },
  (t) => [index("idx_webhook_org").on(t.organizationId)],
);

export const commentRelations = relations(comment, ({ one, many }) => ({
  author: one(user, {
    fields: [comment.authorUserId],
    references: [user.id],
  }),
  mentions: many(commentMention),
}));

export const commentMentionRelations = relations(commentMention, ({ one }) => ({
  comment: one(comment, {
    fields: [commentMention.commentId],
    references: [comment.id],
  }),
  mentionedUser: one(user, {
    fields: [commentMention.mentionedUserId],
    references: [user.id],
  }),
}));

export const attachmentRelations = relations(attachment, ({ one }) => ({
  uploader: one(user, {
    fields: [attachment.uploaderUserId],
    references: [user.id],
  }),
}));

export const tagRelations = relations(tag, ({ many }) => ({
  taggables: many(taggable),
}));

export const taggableRelations = relations(taggable, ({ one }) => ({
  tag: one(tag, { fields: [taggable.tagId], references: [tag.id] }),
}));
