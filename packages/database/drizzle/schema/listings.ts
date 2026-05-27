// packages/database/drizzle/schema/listings.ts
//
// Listing — the first first-class runnable property entity (D-034 /
// PRD_WORKFLOW_SOP_BUILDER.md §8.1). A listing represents a single unit a
// property-ops org manages: a vacation rental, a leased apartment, a commercial
// suite, a multifamily unit. Property type is intentionally free text in v1.5;
// cohort membership via `entity_set` (entitysets.ts, lands later in v1.5a) is
// the canonical categorization mechanism — this table stays minimal.
//
// First registered EntityAdapter type (Layer-1 seam per PRD §6.1). When Layer-1
// full configurable entity model lands post-v1, tenant-defined entity types
// join `listing` as registered adapters; nothing about this table changes.
//
// Verified 2026-05-27: no `listing` table previously existed (only
// `template_listing` / `template_listing_version` for library distribution).
// Created here as a v1.5a prerequisite so:
//   - `entity_set_member` (lands days 3–5) has a target to point at,
//   - Phase 17 (property-ops pack) seeded sample data has a home,
//   - Phase 8 (vendor / participant model) gets a real listing concept to lean on.

import { relations, sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import {
  id,
  orgId,
  organization,
  softDelete,
  timestamps,
  user,
} from "./_shared";

export const listing = pgTable(
  "listing",
  {
    id: id(),
    organizationId: orgId(),
    name: text("name").notNull(),
    description: text("description"),
    // Free text in v1.5. Expected values: 'str' | 'ltr' | 'commercial' |
    // 'multifamily' | 'mixed_use'. Cohort membership via `entity_set` is the
    // canonical categorization mechanism (PRD §6.2); this column is a
    // convenience hint for filters that don't want to JOIN through entity_set.
    propertyType: text("property_type"),
    // Optional structured address: { street, city, region, postal, country }.
    // jsonb instead of separate columns so we don't lock in a shape before
    // customers tell us which fields matter; iterate as needed.
    address: jsonb("address"),
    // Cross-system identifier for sync (Hospitable, Guesty, OwnerRez, AppFolio,
    // MRI/Yardi for commercial, etc.). NULL when the listing is org-native or
    // not yet linked. Unique per (organizationId, externalListingId) when
    // populated — enforced by partial unique index below.
    externalListingId: text("external_listing_id"),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    ...timestamps,
    // Three-bucket soft delete (D-006). Historical references (run kickoff
    // metadata, entity_set_member rows) continue to resolve; new selection
    // skips soft-deleted rows.
    ...softDelete,
  },
  (t) => [
    index("idx_listing_org").on(t.organizationId),
    // Active-listings query for the picker UI: "non-deleted listings in org."
    index("idx_listing_org_deleted").on(t.organizationId, t.deletedAt),
    // Partial unique: only enforce when externalListingId is populated. Allows
    // many org-native listings (all with NULL external id) plus exactly one
    // listing per external system id when linked.
    uniqueIndex("uq_listing_org_external_id")
      .on(t.organizationId, t.externalListingId)
      .where(sql`${t.externalListingId} is not null`),
  ],
);

export const listingRelations = relations(listing, ({ one }) => ({
  organization: one(organization, {
    fields: [listing.organizationId],
    references: [organization.id],
  }),
  createdBy: one(user, {
    fields: [listing.createdByUserId],
    references: [user.id],
  }),
}));
