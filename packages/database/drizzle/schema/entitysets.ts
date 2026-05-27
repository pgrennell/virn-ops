// packages/database/drizzle/schema/entitysets.ts
//
// Layer-1 entity-set seam (D-034 / PRD_WORKFLOW_SOP_BUILDER.md §6.1 + §8.1). Replaces
// the v1-draft `listing_cohort` framing with a polymorphic primitive that's entity-
// agnostic from day one. In v1.5 the only registered `entity_type` is `'listing'`; future
// packs add values (vendor / building / suite / tenant / lease / asset / incident /
// ticket / site) without schema migration — just adapter registration + UI plumbing.
//
// Two tables:
//   - `entity_set`: org-scoped named cohort with an entity-type discriminator (e.g.
//     "STR penthouses", "Commercial suites in Building A", "Class-A office assets").
//     UNIQUE per (org, type, name) so authors can reuse a name across types if they
//     ever need to ("Premium" listings vs "Premium" vendors).
//   - `entity_set_member`: composite PK (entity_set_id, entity_type, entity_id) — the
//     polymorphic join. We deliberately DO NOT model entity_id as a typed FK: doing so
//     would require either (a) a per-type column or (b) a CHECK constraint with a
//     subquery (Postgres allows but flags the latter as "may be expensive" and the
//     PRD §8.1 explicitly defers the choice). Referential integrity for the entity_id
//     pointer is enforced by the EntityAdapter registry at the application layer; soft-
//     delete of a target entity (e.g. listing.deleted_at) leaves the membership row
//     intact for audit, and the application's "active members" reader filters those
//     out via the adapter.
//
// What this seam unlocks (deliberately deferred to follow-up sessions):
//   - workflow.entity_set_ids[] (declared scope) — extends workflows.ts; lands in this
//     same migration alongside entity_set/entity_set_member so the seams ship together.
//   - workflow.review_state (draft/in_review/published/archived) — editorial layer
//     distinct from per-version workflow_version.status (publishing state).
//   - runs.launch entity-set filter — UI picker that surfaces only workflows whose
//     entity_set_ids intersect the target entity's memberships.

import { relations } from "drizzle-orm";
import {
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

import {
  entityType,
  id,
  orgId,
  organization,
  timestamps,
} from "./_shared";

// Editorial review state for the workflow as an authored artifact. Distinct from
// `workflow_version.status` (which is a per-version publishing state — draft / published).
// `review_state` lets an org gate "submit for concierge review" → "approve" → publish
// without polluting the version-status semantics.
export const reviewState = pgEnum("review_state", [
  "draft",
  "in_review",
  "published",
  "archived",
]);

export const entitySet = pgTable(
  "entity_set",
  {
    id: id(),
    organizationId: orgId(),
    // Polymorphic discriminator. Reuses the shared `entity_type` enum (extended in
    // migration 0007 to include 'listing'). Future packs add values; the CHECK on
    // `entity_set_member` is application-enforced (no DB-level CHECK to avoid the
    // subquery-CHECK perf footgun called out in PRD §8.1).
    entityType: entityType("entity_type").notNull(),
    name: text("name").notNull(),
    // UI color for the set chip (free-text hex / tailwind token / null). Display-only.
    color: text("color"),
    description: text("description"),
    ...timestamps,
  },
  (t) => [
    // (org, type, name) -- authors can reuse a name across types if/when more types land.
    unique("uq_entity_set_org_type_name").on(
      t.organizationId,
      t.entityType,
      t.name,
    ),
    index("idx_entity_set_org").on(t.organizationId),
    // Common picker query: "all entity sets of type X in this org."
    index("idx_entity_set_org_type").on(t.organizationId, t.entityType),
  ],
);

// Polymorphic membership: which entity sets does (entityType, entityId) belong to?
// Composite PK enforces no duplicate memberships. Cascade on entity_set delete; entity
// deletion is handled by the application (adapter-aware soft-delete leaves rows intact).
export const entitySetMember = pgTable(
  "entity_set_member",
  {
    entitySetId: text("entity_set_id")
      .notNull()
      .references(() => entitySet.id, { onDelete: "cascade" }),
    entityType: entityType("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.entitySetId, t.entityType, t.entityId] }),
    // Reverse-lookup index for the most common reader query:
    //   "which entity sets does THIS entity (typed) belong to?"
    // Used by the runs.launch filter (does the target entity's set intersect the
    // workflow's declared scope?) and the entity detail view (chip list).
    index("idx_entity_set_member_entity").on(t.entityType, t.entityId),
  ],
);

export const entitySetRelations = relations(entitySet, ({ many, one }) => ({
  organization: one(organization, {
    fields: [entitySet.organizationId],
    references: [organization.id],
  }),
  members: many(entitySetMember),
}));

export const entitySetMemberRelations = relations(entitySetMember, ({ one }) => ({
  entitySet: one(entitySet, {
    fields: [entitySetMember.entitySetId],
    references: [entitySet.id],
  }),
}));
