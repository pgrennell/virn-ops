// packages/database/drizzle/schema/config.ts
//
// The mode engine (ARCHITECTURE.md ADR-001 / domain-core). Capabilities + settings drive
// per-org feature configuration. A product "mode" (checklist / SOP / automation) is an
// enablement profile that toggles a set of capability keys; a solution pack ships such a
// profile. Resolution is override-then-default, computed in a single resolver
// (queries/config.ts), never reimplemented per feature.

import { relations } from "drizzle-orm";
import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
} from "drizzle-orm/pg-core";
import { id, orgId, timestamps, lifecycleStatus } from "./_shared";

export const settingDataType = pgEnum("setting_data_type", [
  "string",
  "number",
  "boolean",
  "json",
  "select",
  "multiselect",
]);

// Platform-level catalog of toggleable features. Seeded (and extended by packs).
export const capability = pgTable("capability", {
  id: id(),
  key: text("key").notNull().unique(), // stable slug, referenced in code + middleware
  name: text("name").notNull(),
  description: text("description"),
  defaultEnabled: boolean("default_enabled").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  status: lifecycleStatus("status").notNull().default("active"),
  ...timestamps,
});

// Sparse per-org override. No row = inherit the capability's default (or entitlement grant).
export const organizationCapability = pgTable(
  "organization_capability",
  {
    organizationId: orgId(),
    capabilityId: text("capability_id")
      .notNull()
      .references(() => capability.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull(),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.organizationId, t.capabilityId] })],
);

// Typed registry of configurable settings, optionally gated behind a capability.
export const settingDefinition = pgTable("setting_definition", {
  id: id(),
  key: text("key").notNull().unique(),
  capabilityId: text("capability_id").references(() => capability.id, {
    onDelete: "set null",
  }),
  name: text("name").notNull(),
  description: text("description"),
  dataType: settingDataType("data_type").notNull(),
  defaultValue: jsonb("default_value"),
  validationSchema: jsonb("validation_schema"), // stored Zod / JSON-schema
  category: text("category"),
  isAdvanced: boolean("is_advanced").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  status: lifecycleStatus("status").notNull().default("active"),
  ...timestamps,
});

// Sparse per-org override. No row = inherit the definition default.
export const organizationSetting = pgTable(
  "organization_setting",
  {
    organizationId: orgId(),
    settingDefinitionId: text("setting_definition_id")
      .notNull()
      .references(() => settingDefinition.id, { onDelete: "cascade" }),
    value: jsonb("value").notNull(),
    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.settingDefinitionId] }),
  ],
);

export const capabilityRelations = relations(capability, ({ many }) => ({
  orgOverrides: many(organizationCapability),
  settings: many(settingDefinition),
}));

export const settingDefinitionRelations = relations(
  settingDefinition,
  ({ one, many }) => ({
    capability: one(capability, {
      fields: [settingDefinition.capabilityId],
      references: [capability.id],
    }),
    orgOverrides: many(organizationSetting),
  }),
);
