// packages/database/drizzle/schema/library.ts
//
// Template library (ARCHITECTURE.md §5, Invariant #2 cross-tenant exception). Listings are
// publisher- or platform-owned, never tenant-owned: `publisherOrganizationId` is nullable —
// NULL = first-party (Virn-published). A listing version snapshots a published
// `workflow_version`; install = deep-clone into the consuming org with provenance recorded
// on `workflow.installedFromListingVersionId`.

import { relations } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import {
  id,
  lifecycleStatus,
  organization,
  timestamps,
  user,
  workflowType,
} from "./_shared";
import { workflowVersion } from "./workflows";

export const listingVisibility = pgEnum("listing_visibility", [
  "private", // author-only (drafts)
  "link", // anyone with the shareToken can install
  "organization", // visible only inside publisherOrganizationId
  "public", // discoverable by all orgs
]);

// Categories are platform-global (no orgId). `parentId` is a self-reference (kept as plain
// text without a FK to match the `step.due_anchor_step_id` pattern in workflows.ts —
// application code enforces referential integrity).
export const templateCategory = pgTable(
  "template_category",
  {
    id: id(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    parentId: text("parent_id"),
    ...timestamps,
  },
  (t) => [index("idx_template_category_parent").on(t.parentId)],
);

export const templateListing = pgTable(
  "template_listing",
  {
    id: id(),
    // NULL = first-party / platform-published. Otherwise the publishing org.
    //
    // `restrict` (not `set null`) — deleting a publisher org must not silently convert
    // their listings into first-party listings, which would misrepresent ownership and
    // pollute the curated `isOfficial` set. Org-delete flows that need to remove
    // listings must do so explicitly (delete or transfer) before removing the org.
    publisherOrganizationId: text("publisher_organization_id").references(
      () => organization.id,
      { onDelete: "restrict" },
    ),
    categoryId: text("category_id").references(() => templateCategory.id, {
      onDelete: "set null",
    }),
    contentType: workflowType("content_type").notNull().default("procedure"),
    title: text("title").notNull(),
    summary: text("summary"),
    coverImageKey: text("cover_image_key"),
    slug: text("slug").notNull().unique(),
    visibility: listingVisibility("visibility").notNull().default("private"),
    // Random opaque token for link-visibility installs. Null otherwise.
    shareToken: text("share_token"),
    // Curated badge: only true for first-party listings (publisherOrganizationId IS NULL).
    isOfficial: boolean("is_official").notNull().default(false),
    installCount: integer("install_count").notNull().default(0),
    status: lifecycleStatus("status").notNull().default("active"),
    ...timestamps,
  },
  (t) => [
    index("idx_template_listing_publisher").on(t.publisherOrganizationId),
    index("idx_template_listing_category").on(t.categoryId),
    index("idx_template_listing_visibility").on(t.visibility),
  ],
);

export const templateListingVersion = pgTable(
  "template_listing_version",
  {
    id: id(),
    listingId: text("listing_id")
      .notNull()
      .references(() => templateListing.id, { onDelete: "cascade" }),
    // The published workflow_version snapshot that backs this listing version. Restrict
    // delete: a listing version pins its source so installs always have provenance to
    // resolve back to definition.
    sourceWorkflowVersionId: text("source_workflow_version_id")
      .notNull()
      .references((): AnyPgColumn => workflowVersion.id, { onDelete: "restrict" }),
    versionNumber: integer("version_number").notNull(),
    changelog: text("changelog"),
    publishedAt: timestamp("published_at").notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [
    unique("uq_template_listing_version").on(t.listingId, t.versionNumber),
    index("idx_template_listing_version_listing").on(t.listingId),
  ],
);

export const templateReview = pgTable(
  "template_review",
  {
    id: id(),
    listingId: text("listing_id")
      .notNull()
      .references(() => templateListing.id, { onDelete: "cascade" }),
    reviewerUserId: text("reviewer_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    rating: integer("rating").notNull(), // 1..5; validated in service layer
    body: text("body"),
    ...timestamps,
  },
  (t) => [
    unique("uq_template_review_listing_user").on(t.listingId, t.reviewerUserId),
    index("idx_template_review_listing").on(t.listingId),
  ],
);

export const templateCategoryRelations = relations(
  templateCategory,
  ({ one, many }) => ({
    parent: one(templateCategory, {
      fields: [templateCategory.parentId],
      references: [templateCategory.id],
      relationName: "template_category_parent",
    }),
    children: many(templateCategory, {
      relationName: "template_category_parent",
    }),
    listings: many(templateListing),
  }),
);

export const templateListingRelations = relations(
  templateListing,
  ({ one, many }) => ({
    publisher: one(organization, {
      fields: [templateListing.publisherOrganizationId],
      references: [organization.id],
    }),
    category: one(templateCategory, {
      fields: [templateListing.categoryId],
      references: [templateCategory.id],
    }),
    versions: many(templateListingVersion),
    reviews: many(templateReview),
  }),
);

export const templateListingVersionRelations = relations(
  templateListingVersion,
  ({ one }) => ({
    listing: one(templateListing, {
      fields: [templateListingVersion.listingId],
      references: [templateListing.id],
    }),
    sourceVersion: one(workflowVersion, {
      fields: [templateListingVersion.sourceWorkflowVersionId],
      references: [workflowVersion.id],
    }),
  }),
);

export const templateReviewRelations = relations(templateReview, ({ one }) => ({
  listing: one(templateListing, {
    fields: [templateReview.listingId],
    references: [templateListing.id],
  }),
  reviewer: one(user, {
    fields: [templateReview.reviewerUserId],
    references: [user.id],
  }),
}));
