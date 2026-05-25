// packages/database/drizzle/schema/datasets.ts
//
// Reserved / deferred (ARCHITECTURE.md §5, MVP scope matrix). Tables exist so the `lookup`
// field type in workflows.ts has something to point at, and so packs can declare a data set
// in their manifest without a future migration. The reader/writer service, lookup
// resolution at run time, and the data-set admin UI are deferred until a vertical actually
// asks for org-level structured reference data.

import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
} from "drizzle-orm/pg-core";
import {
  id,
  lifecycleStatus,
  orgId,
  softDelete,
  timestamps,
} from "./_shared";
import { settingDataType } from "./config";

// Org-scoped catalog. `key` is the stable identifier the `lookup` field type points at.
export const dataSet = pgTable(
  "data_set",
  {
    id: id(),
    organizationId: orgId(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    status: lifecycleStatus("status").notNull().default("active"),
    ...timestamps,
  },
  (t) => [
    unique("uq_data_set_org_key").on(t.organizationId, t.key),
    index("idx_data_set_org").on(t.organizationId),
  ],
);

// Schema for a record in the data set. `key` is the property name keys in
// `data_set_record.values`.
export const dataSetField = pgTable(
  "data_set_field",
  {
    id: id(),
    dataSetId: text("data_set_id")
      .notNull()
      .references(() => dataSet.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    dataType: settingDataType("data_type").notNull(),
    isRequired: boolean("is_required").notNull().default(false),
    position: integer("position").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    unique("uq_data_set_field_key").on(t.dataSetId, t.key),
    index("idx_data_set_field_data_set").on(t.dataSetId),
  ],
);

// One row per record. `values` is jsonb keyed by `data_set_field.key`; validation against
// the field schemas is the service layer's job.
export const dataSetRecord = pgTable(
  "data_set_record",
  {
    id: id(),
    dataSetId: text("data_set_id")
      .notNull()
      .references(() => dataSet.id, { onDelete: "cascade" }),
    values: jsonb("values").$type<Record<string, unknown>>().notNull(),
    ...softDelete,
    ...timestamps,
  },
  (t) => [index("idx_data_set_record_data_set").on(t.dataSetId)],
);

export const dataSetRelations = relations(dataSet, ({ many }) => ({
  fields: many(dataSetField),
  records: many(dataSetRecord),
}));

export const dataSetFieldRelations = relations(dataSetField, ({ one }) => ({
  dataSet: one(dataSet, {
    fields: [dataSetField.dataSetId],
    references: [dataSet.id],
  }),
}));

export const dataSetRecordRelations = relations(dataSetRecord, ({ one }) => ({
  dataSet: one(dataSet, {
    fields: [dataSetRecord.dataSetId],
    references: [dataSet.id],
  }),
}));
