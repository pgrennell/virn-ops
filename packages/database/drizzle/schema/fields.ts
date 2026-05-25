// packages/database/drizzle/schema/fields.ts
//
// Metadata-driven custom field registry (ARCHITECTURE.md ADR-002). `field_definition` is the
// generalization of Propvana's setting_definitions — keyed by `object_type` + scope, with
// validated jsonb storage on consuming records. `object_type` is reserved (BUILD_PLAN.md
// Batch 5 / ADR-002 deferred): the row exists so packs and verticals can register custom
// business objects (Property, Campaign, Cleaning Job) later without a migration.
//
// Reuses `settingDataType` from config.ts so the config and field-definition layers share
// one validated-jsonb data-type vocabulary.

import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  unique,
} from "drizzle-orm/pg-core";
import {
  id,
  lifecycleStatus,
  organization,
  timestamps,
} from "./_shared";
import { settingDataType } from "./config";
import { packVersion } from "./packs";

// Three-layer registry: platform-shipped, pack-shipped, or org-defined. When `scope = "org"`
// the row carries an organizationId; when `scope = "pack"` it may carry a packVersionId for
// provenance. Platform-scope rows have neither.
export const fieldDefinitionScope = pgEnum("field_definition_scope", [
  "platform",
  "pack",
  "org",
]);

// Reserved: a registered custom business object type. The actual record storage / object
// builder is deferred (ADR-002); this table exists so field_definition can already key on
// it.
export const objectType = pgTable("object_type", {
  id: id(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  status: lifecycleStatus("status").notNull().default("active"),
  ...timestamps,
});

export const fieldDefinition = pgTable(
  "field_definition",
  {
    id: id(),
    key: text("key").notNull(),
    objectTypeId: text("object_type_id").references(() => objectType.id, {
      onDelete: "cascade",
    }),
    scope: fieldDefinitionScope("scope").notNull(),
    // Set when scope = "org". Null otherwise.
    organizationId: text("organization_id").references(() => organization.id, {
      onDelete: "cascade",
    }),
    // Set when scope = "pack" (provenance back to the publishing pack version).
    packVersionId: text("pack_version_id").references(() => packVersion.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    description: text("description"),
    dataType: settingDataType("data_type").notNull(),
    defaultValue: jsonb("default_value"),
    validationSchema: jsonb("validation_schema"), // stored Zod / JSON-schema (ADR-002)
    isRequired: boolean("is_required").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    status: lifecycleStatus("status").notNull().default("active"),
    ...timestamps,
  },
  (t) => [
    unique("uq_field_definition_scope_key").on(
      t.scope,
      t.organizationId,
      t.packVersionId,
      t.objectTypeId,
      t.key,
    ),
    index("idx_field_definition_org").on(t.organizationId),
    index("idx_field_definition_object_type").on(t.objectTypeId),
  ],
);

export const objectTypeRelations = relations(objectType, ({ many }) => ({
  fields: many(fieldDefinition),
}));

export const fieldDefinitionRelations = relations(fieldDefinition, ({ one }) => ({
  objectType: one(objectType, {
    fields: [fieldDefinition.objectTypeId],
    references: [objectType.id],
  }),
  organization: one(organization, {
    fields: [fieldDefinition.organizationId],
    references: [organization.id],
  }),
  packVersion: one(packVersion, {
    fields: [fieldDefinition.packVersionId],
    references: [packVersion.id],
  }),
}));
