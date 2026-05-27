// packages/database/drizzle/schema/agents.ts
//
// Agent principals (ADR-006 + D-022, 2026-05-27). Org-scoped long-lived identity for AI
// agents that drive runs via the MCP surface (Phase 11). The per-run binding is a
// `participant` row with `kind='agent'` and `agentId` set — `run_step_assignee` is unchanged
// (one assignee model, three principal kinds).
//
// Phase 8 step 1 lands the schema only; agent-aware writers (assignAgent, launchRunWithMode,
// MCP credential-validating boundary) come in Phase 8 step 2 + Phase 11.

import { relations } from "drizzle-orm";
import { boolean, index, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { id, orgId, softDelete, timestamps, user } from "./_shared";
import { capability } from "./config";

export const agent = pgTable(
  "agent",
  {
    id: id(),
    organizationId: orgId(),
    name: text("name").notNull(),
    description: text("description"),
    // Argon2id hash of the API-key-shaped credential. Algorithm choice deferred to Phase 11
    // when the MCP credential-validating boundary lands (the column is shape-agnostic).
    // Never stores plaintext — standard service-account pattern: shown once on creation,
    // user stores it, lost = rotate.
    credentialHash: text("credential_hash").notNull(),
    // Last 4 chars of the plaintext credential for UI display ("…a3f9"). Convenience only;
    // not a secret.
    credentialLastFour: text("credential_last_four"),
    // Set on creation and on every rotation. Drives "your agent credential is 90 days old"
    // UI in a later pass.
    credentialRotatedAt: timestamp("credential_rotated_at"),
    // Cross-product origin (D-027, 2026-05-27 cross-repo). Free-text identifier of the
    // sibling product whose machine principal this agent represents -- e.g. 'virn-pm' when
    // PM is provisioned as an Ops agent. Audit/activity writes triggered by this agent
    // propagate `crossProductOrigin = agent.originProduct` so downstream consumers (oncall,
    // monitor, BI) can distinguish "PM-driven writes" from "in-house agent writes" from
    // "human writes." Null for in-house agents; the dominant case in v1.
    originProduct: text("origin_product"),
    // Soft-disable without delete. A disabled agent fails authentication at the MCP boundary
    // (the participant rows remain for historical audit; the agent just can't act).
    isActive: boolean("is_active").notNull().default(true),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    ...timestamps,
    // Three-bucket soft delete (D-006). Historical participant rows pointing at a
    // soft-deleted agent still join correctly; new authentication fails.
    ...softDelete,
  },
  (t) => [
    unique("uq_agent_org_name").on(t.organizationId, t.name),
    index("idx_agent_org").on(t.organizationId),
    // Common picker query "active agents in org" — join target for the agent-assignment UI.
    index("idx_agent_org_active").on(t.organizationId, t.isActive),
  ],
);

// Per-agent capability grants (ADR-006 capability composition). Composes with the org-level
// capability — an agent only sees workflows where capability_enabled(org) ∧
// agent_has_capability(agentId, capability). Per-agent grants are an additional narrowing
// on top of org-level capability (never broader).
//
// Descendant table per D-006: no `organizationId` (derives through agent.organizationId via
// FK chain); no `deletedAt` (grants are added/removed, not soft-deleted).
export const agentCapability = pgTable(
  "agent_capability",
  {
    id: id(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agent.id, { onDelete: "cascade" }),
    capabilityId: text("capability_id")
      .notNull()
      .references(() => capability.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("uq_agent_capability").on(t.agentId, t.capabilityId),
    index("idx_agent_capability_agent").on(t.agentId),
    index("idx_agent_capability_capability").on(t.capabilityId),
  ],
);

export const agentRelations = relations(agent, ({ many, one }) => ({
  capabilities: many(agentCapability),
  createdBy: one(user, {
    fields: [agent.createdByUserId],
    references: [user.id],
  }),
}));

export const agentCapabilityRelations = relations(agentCapability, ({ one }) => ({
  agent: one(agent, {
    fields: [agentCapability.agentId],
    references: [agent.id],
  }),
  capability: one(capability, {
    fields: [agentCapability.capabilityId],
    references: [capability.id],
  }),
}));
