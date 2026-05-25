// packages/database/drizzle/schema/packs.ts
//
// Solution packs (ARCHITECTURE.md ADR-001) — the "products" layer. A pack is a versioned
// bundle of capability grants, setting definitions, taxonomy rows, field definitions, role
// definitions, and seed templates. Packs are **platform-owned**, not tenant-owned (Invariant
// #2 cross-tenant exception): solution_pack / pack_version live outside any org;
// `pack_install` records the per-org installation and provenance.

import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
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
} from "./_shared";

// Platform-owned. No orgId. `isOfficial` is informational (Virn-published vs. a future
// partner-published pack).
export const solutionPack = pgTable("solution_pack", {
  id: id(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  summary: text("summary"),
  isOfficial: boolean("is_official").notNull().default(true),
  status: lifecycleStatus("status").notNull().default("active"),
  ...timestamps,
});

// `manifest` is the published bundle definition: capability grants, settings, taxonomy
// rows, field definitions, role defs, seed template references. Stored as jsonb so a
// version is self-contained for replay during install.
export const packVersion = pgTable(
  "pack_version",
  {
    id: id(),
    packId: text("pack_id")
      .notNull()
      .references(() => solutionPack.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    manifest: jsonb("manifest").$type<Record<string, unknown>>().notNull(),
    changelog: text("changelog"),
    publishedAt: timestamp("published_at").notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [
    unique("uq_pack_version_number").on(t.packId, t.versionNumber),
    index("idx_pack_version_pack").on(t.packId),
  ],
);

// Per-org install ledger. A given pack is installed at most once per org at a given time
// (uniq on organizationId + packId); upgrading swaps the packVersionId.
export const packInstall = pgTable(
  "pack_install",
  {
    id: id(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    packId: text("pack_id")
      .notNull()
      .references(() => solutionPack.id, { onDelete: "cascade" }),
    packVersionId: text("pack_version_id")
      .notNull()
      .references(() => packVersion.id, { onDelete: "restrict" }),
    installedBy: text("installed_by").references(() => user.id, {
      onDelete: "set null",
    }),
    installedAt: timestamp("installed_at").notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [
    unique("uq_pack_install_org_pack").on(t.organizationId, t.packId),
    index("idx_pack_install_org").on(t.organizationId),
    index("idx_pack_install_version").on(t.packVersionId),
  ],
);

export const solutionPackRelations = relations(solutionPack, ({ many }) => ({
  versions: many(packVersion),
  installs: many(packInstall),
}));

export const packVersionRelations = relations(packVersion, ({ one, many }) => ({
  pack: one(solutionPack, {
    fields: [packVersion.packId],
    references: [solutionPack.id],
  }),
  installs: many(packInstall),
}));

export const packInstallRelations = relations(packInstall, ({ one }) => ({
  organization: one(organization, {
    fields: [packInstall.organizationId],
    references: [organization.id],
  }),
  pack: one(solutionPack, {
    fields: [packInstall.packId],
    references: [solutionPack.id],
  }),
  version: one(packVersion, {
    fields: [packInstall.packVersionId],
    references: [packVersion.id],
  }),
  installer: one(user, {
    fields: [packInstall.installedBy],
    references: [user.id],
  }),
}));
