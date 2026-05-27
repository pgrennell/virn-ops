// packages/database/drizzle/schema/vendors.ts
//
// Vendor principals (ADR-007 + D-023, 2026-05-27). Org-scoped third-party business
// relationships — vertical-agnostic primitive (property ops has pest control/HVAC; IT
// ops has MSPs/cloud providers; marketing ops has agencies). Distinct from `guest`
// (one-off external) and `agent` (machine principal). The per-run binding is a
// `participant` row with `kind='vendor'` + `vendorId` + `vendorContactId` set (which
// specific human at the vendor is acting in this run).
//
// PM has its own complete vendor entity (per ARCHITECTURE §1 Principle #5 —
// product independence with linking). The `linkedPmVendorId` column on this side stores
// the cross-product reference; PM's side uses its polymorphic `external_identifiers`
// table per D-026. The integration layer (Phase 11 action surface) keeps overlapping
// fields in sync (LWW per D-028); product-specific fields stay in their owning product.

import { relations } from "drizzle-orm";
import { boolean, index, pgEnum, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { id, orgId, organization, softDelete, timestamps, user } from "./_shared";
import { capability } from "./config";

// Operational state distinct from `isActive`. `preferred` = vendor of choice for the
// category at the property/portfolio level; `blacklisted` blocks selection even when
// otherwise active. `under_review` and `probation` are workflow states for vendor
// evaluation. ADR-007.
export const vendorStatus = pgEnum("vendor_status", [
  "active",
  "preferred",
  "approved",
  "under_review",
  "probation",
  "blacklisted",
]);

// Vendor categories — pack-seedable lookup (D-023). Org-scoped initially (`organizationId`
// nullable for platform-seeded). Slugs are the canonical identifier across products —
// PM's vendor sync (D-028) maps via slug. `parentCategoryId` is plain text without a FK
// (matches the `template_category.parent_id` + `step.due_anchor_step_id` convention —
// service-layer integrity, no self-referential FK).
export const vendorCategory = pgTable(
  "vendor_category",
  {
    id: id(),
    // NULL = platform-seeded; otherwise org-custom. Orgs may override platform categories
    // with their own same-slug rows (UNIQUE per org enforces this).
    organizationId: text("organization_id").references(() => organization.id, {
      onDelete: "cascade",
    }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    // Self-reference kept as plain text (D-012 pattern).
    parentCategoryId: text("parent_category_id"),
    ...timestamps,
  },
  (t) => [
    unique("uq_vendor_category_org_slug").on(t.organizationId, t.slug),
    index("idx_vendor_category_parent").on(t.parentCategoryId),
    index("idx_vendor_category_org").on(t.organizationId),
  ],
);

// Vendor entity — universal process-ops primitive. Top-level org-scoped (D-006). PM's
// own vendor entity is independent and complete (Principle #5); the linkedPmVendorId
// column is a string identifier in PM's namespace — no `.references()` clause because
// PM's database is physically separate (cross-product reference, integration layer
// maintains validity).
export const vendor = pgTable(
  "vendor",
  {
    id: id(),
    organizationId: orgId(),
    name: text("name").notNull(),
    description: text("description"),
    // Lookup FK into vendor_category. Categories are pack-seedable for the
    // property-ops pack (pest-control, HVAC, plumbing, landscaping, GC, locksmith,
    // cleaning, pool-spa) and verticals like IT ops can seed their own.
    categoryId: text("category_id").references(() => vendorCategory.id, {
      onDelete: "set null",
    }),
    status: vendorStatus("status").notNull().default("active"),
    // Soft-disable without delete. A disabled vendor can't be selected for new runs;
    // historical participant rows pointing at it remain valid.
    isActive: boolean("is_active").notNull().default(true),
    // Cross-product link to Virn PM's vendor row when both products are installed.
    // No `.references()` — PM's database is separate; the link's validity is
    // maintained by the integration layer (Phase 11 action surface + D-028 sync
    // mechanism). NULL when PM isn't installed or the vendor hasn't been linked yet.
    linkedPmVendorId: text("linked_pm_vendor_id"),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    ...timestamps,
    // Three-bucket soft delete (D-006). Historical participant rows pointing at a
    // soft-deleted vendor still join correctly; new selection fails.
    ...softDelete,
  },
  (t) => [
    unique("uq_vendor_org_name").on(t.organizationId, t.name),
    index("idx_vendor_org").on(t.organizationId),
    // Common picker query "active vendors in org by category" — join target for the
    // vendor-assignment UI and the property-ops Service Request Router's selection
    // logic.
    index("idx_vendor_org_category_active").on(
      t.organizationId,
      t.categoryId,
      t.isActive,
    ),
    // Quick lookup by PM-side ID for the integration layer's "did this PM vendor
    // already get linked here?" check.
    index("idx_vendor_linked_pm").on(t.linkedPmVendorId),
  ],
);

// Multiple humans per vendor (D-023). A specific contact is bound to a per-run
// participant via `participant.vendorContactId` — Mike's run is different from Jose's
// even when both work at Acme. Descendant table per D-006: no `organizationId`
// (derives through vendor.organizationId via FK chain). Soft-disable via `isActive`
// rather than a third soft-delete bucket — employees leaving the vendor doesn't
// require a separate deletedAt lifecycle.
export const vendorContact = pgTable(
  "vendor_contact",
  {
    id: id(),
    vendorId: text("vendor_id")
      .notNull()
      .references(() => vendor.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    role: text("role"),
    isPrimary: boolean("is_primary").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (t) => [
    index("idx_vendor_contact_vendor").on(t.vendorId),
    // Active-contacts query for the per-run participant picker.
    index("idx_vendor_contact_vendor_active").on(t.vendorId, t.isActive),
  ],
);

// Per-vendor capability grants (ADR-007 capability composition). Composes with the
// org-level capability — a vendor only sees workflows where capability_enabled(org) ∧
// vendor_has_capability(vendorId, capability). Enables natural step-level gates like
// "this step is fulfillable only by a vendor of category 'pest-control' with
// capability 'field-execution'."
//
// Descendant table per D-006: no `organizationId`; no `deletedAt` (grants are
// added/removed, not soft-deleted — mirrors agent_capability).
export const vendorCapability = pgTable(
  "vendor_capability",
  {
    id: id(),
    vendorId: text("vendor_id")
      .notNull()
      .references(() => vendor.id, { onDelete: "cascade" }),
    capabilityId: text("capability_id")
      .notNull()
      .references(() => capability.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("uq_vendor_capability").on(t.vendorId, t.capabilityId),
    index("idx_vendor_capability_vendor").on(t.vendorId),
    index("idx_vendor_capability_capability").on(t.capabilityId),
  ],
);

// Relations.

export const vendorCategoryRelations = relations(vendorCategory, ({ many, one }) => ({
  vendors: many(vendor),
  organization: one(organization, {
    fields: [vendorCategory.organizationId],
    references: [organization.id],
  }),
}));

export const vendorRelations = relations(vendor, ({ many, one }) => ({
  category: one(vendorCategory, {
    fields: [vendor.categoryId],
    references: [vendorCategory.id],
  }),
  contacts: many(vendorContact),
  capabilities: many(vendorCapability),
  createdBy: one(user, {
    fields: [vendor.createdByUserId],
    references: [user.id],
  }),
}));

export const vendorContactRelations = relations(vendorContact, ({ one }) => ({
  vendor: one(vendor, {
    fields: [vendorContact.vendorId],
    references: [vendor.id],
  }),
}));

export const vendorCapabilityRelations = relations(vendorCapability, ({ one }) => ({
  vendor: one(vendor, {
    fields: [vendorCapability.vendorId],
    references: [vendor.id],
  }),
  capability: one(capability, {
    fields: [vendorCapability.capabilityId],
    references: [capability.id],
  }),
}));
