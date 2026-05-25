// packages/database/drizzle/schema/entitlements.ts
//
// Billing → configuration bridge (ARCHITECTURE.md ADR-005). Capabilities are the shared unit
// of both feature toggling and billing entitlement: a plan grants a set of capabilities (+
// optional limits as jsonb), and a purchase points the org at a plan. The capability flag
// that gates a feature is the same flag a plan pays for. Per-org capability overrides live
// on `organization_capability` (config.ts) and stack on top.
//
// MVP: just the plan → capability mapping. Usage metering is deferred.

import { relations } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
} from "drizzle-orm/pg-core";
import { id, lifecycleStatus, timestamps } from "./_shared";
import { capability } from "./config";

// Platform-global catalog of billable plans. `key` is the stable identifier used by the
// payments side (e.g. matched against a Stripe priceId via the purchase table).
export const plan = pgTable(
  "plan",
  {
    id: id(),
    key: text("key").notNull().unique(),
    name: text("name").notNull(),
    description: text("description"),
    sortOrder: integer("sort_order").notNull().default(0),
    status: lifecycleStatus("status").notNull().default("active"),
    ...timestamps,
  },
  (t) => [index("idx_plan_status").on(t.status)],
);

// Many-to-many: a plan grants a capability and (optionally) bounds its usage. `limits` is
// jsonb so future metered grants (e.g. {"runs_per_month": 1000}) need no migration.
export const planCapability = pgTable(
  "plan_capability",
  {
    planId: text("plan_id")
      .notNull()
      .references(() => plan.id, { onDelete: "cascade" }),
    capabilityId: text("capability_id")
      .notNull()
      .references(() => capability.id, { onDelete: "cascade" }),
    limits: jsonb("limits").$type<Record<string, unknown>>(),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.planId, t.capabilityId] })],
);

export const planRelations = relations(plan, ({ many }) => ({
  capabilities: many(planCapability),
}));

export const planCapabilityRelations = relations(planCapability, ({ one }) => ({
  plan: one(plan, { fields: [planCapability.planId], references: [plan.id] }),
  capability: one(capability, {
    fields: [planCapability.capabilityId],
    references: [capability.id],
  }),
}));
