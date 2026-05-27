// packages/database/drizzle/schema/_shared.ts
//
// Shared conventions imported by every schema file. See ARCHITECTURE.md §3 (Invariants)
// and §6 (Conventions). Adjust the ./auth import to wherever Better Auth's generated
// schema exports `organization` and `user`.

import { pgEnum, text, timestamp } from "drizzle-orm/pg-core";
import { createId } from "@paralleldrive/cuid2";
import { organization, user } from "./auth";

// cuid2 text PK on every table (matches Better Auth). Invariant #7.
export const id = () => text("id").primaryKey().$defaultFn(() => createId());

export const timestamps = {
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

// Bucket 1 of the soft-delete policy: user-deletable records. Lifecycle entities use
// `lifecycleStatus` instead; audit/governance tables are append-only (no delete column).
export const softDelete = { deletedAt: timestamp("deleted_at") };

// Invariant #1: every tenant-owned row carries this.
export const orgId = () =>
  text("organization_id")
    .notNull()
    .references(() => organization.id, { onDelete: "cascade" });

export { organization, user };

// Bucket 2 of the soft-delete policy: lifecycle status on definition/lookup entities.
export const lifecycleStatus = pgEnum("lifecycle_status", [
  "active",
  "inactive",
  "archived",
]);

// Actor kind for audit + activity rows (ADR-006 + D-022). Three principal kinds:
//   - `user`  : Better Auth user acting through the human UI
//   - `guest` : external participant acting via a tokenized portal
//   - `agent` : AI principal acting via the MCP surface (Phase 11)
// Lives in _shared.ts because both audit_log + activity_event use it (parallel to D-011's
// audit/activity separation).
export const actorKind = pgEnum("actor_kind", ["user", "guest", "agent"]);

// Polymorphic discriminator for cross-cutting tables (comments, attachments, activity,
// tags). Pair with a plain `entity_id text` column + a CHECK — never a bare FK. Grow this
// list as new referenceable entities are added.
export const entityType = pgEnum("entity_type", [
  "workflow",
  "workflow_version",
  "section",
  "step",
  "field",
  "run",
  "run_step",
  "field_value",
  "suggestion",
  "automation_rule",
  "version_approval",
  "acknowledgment",
  "template_listing",
  "template_listing_version",
  "solution_pack",
  "pack_version",
  "field_definition",
  "role",
]);

// Content-type discriminator (ARCHITECTURE.md §5). Lives here rather than in workflows.ts
// because both the definition layer (workflows.ts) and the library layer (library.ts) need
// to type a row by it — keeping the enum in a leaf module breaks the circular import that
// would otherwise form between those two files.
export const workflowType = pgEnum("workflow_type", [
  "procedure", // step-by-step, runnable
  "document", // reference doc (no run machinery)
  "policy", // read-and-acknowledge
  "form", // launch-only data collection
]);
