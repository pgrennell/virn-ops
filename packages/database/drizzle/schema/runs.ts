// packages/database/drizzle/schema/runs.ts
//
// Execution layer (ARCHITECTURE.md §5, Invariant #3/#4). A run is created by snapshotting a
// published workflow_version. run_step copies title/description so later template edits never
// rewrite history; field definitions are read from the pinned version via field_value.fieldId.

import { relations, sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { id, orgId, softDelete, timestamps, user } from "./_shared";
import { agent } from "./agents";
import { vendor, vendorContact } from "./vendors";
import {
  field,
  schedule,
  step,
  workflow,
  workflowRole,
  workflowVersion,
} from "./workflows";

export const runStatus = pgEnum("run_status", [
  "active",
  "completed",
  "archived",
]);

export const runStepStatus = pgEnum("run_step_status", [
  "pending",
  "completed",
  "skipped",
  "not_applicable",
]);

// Discriminator for the participant identity. Each kind pairs with exactly one populated
// identity column (userId / guestEmail / agentId / (vendorId + vendorContactId)); the CHECK
// on `participant` keeps them in lockstep. ADR-006 + D-022 (agent, 2026-05-27); ADR-007 +
// D-023 (vendor, 2026-05-27).
export const participantKind = pgEnum("participant_kind", [
  "user",
  "guest",
  "agent",
  "vendor",
]);

// A principal on a run: an internal Better Auth user, an external guest (email), an
// org-scoped AI agent (ADR-006 hybrid), or a vendor (ADR-007 — a specific contact at a
// known third-party business). `kind` and the corresponding identity FK(s) stay in
// lockstep via the CHECK below. Vendor participants carry BOTH vendorId AND
// vendorContactId — the audit story requires identifying both "Acme" and "Mike at Acme."
export const participant = pgTable(
  "participant",
  {
    id: id(),
    organizationId: orgId(),
    runId: text("run_id").notNull(), // FK below (run defined after) — see note
    kind: participantKind("kind").notNull(),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    guestEmail: text("guest_email"),
    guestName: text("guest_name"),
    // Agent identity (ADR-006). RESTRICT on delete — an agent with historical participant
    // rows cannot be hard-deleted; it gets soft-deleted via agent.deletedAt.
    agentId: text("agent_id").references(() => agent.id, { onDelete: "restrict" }),
    // Vendor identity (ADR-007). Same RESTRICT pattern as agent — historical participant
    // rows preserve audit integrity; soft-delete via vendor.deletedAt is the user path.
    // Both vendorId AND vendorContactId are required when kind='vendor' (the CHECK
    // enforces this) — anonymous-vendor participation isn't modeled.
    vendorId: text("vendor_id").references(() => vendor.id, { onDelete: "restrict" }),
    vendorContactId: text("vendor_contact_id").references(() => vendorContact.id, {
      onDelete: "restrict",
    }),
    ...timestamps,
  },
  (t) => [
    index("idx_participant_run").on(t.runId),
    // Single CHECK enforces both "exactly one identity surface populated" AND "kind
    // matches whichever surface is populated" — four-kind generalization. Vendor case
    // requires BOTH vendorId AND vendorContactId together (anonymous-vendor not allowed).
    //
    // **`kind::text` casts on every branch** are required for Postgres compatibility: a
    // CHECK that compares an enum column directly to a value freshly added to the enum
    // (`'vendor'` here, added in the same migration via `ALTER TYPE … ADD VALUE`) is
    // rejected because the new enum OID isn't yet committed. Casting to text compares
    // text strings without consulting the enum OID cache, side-stepping the restriction.
    // Applies uniformly to every branch for consistency, and works the same for existing
    // values that the enum already knows about.
    check(
      "participant_identity",
      sql`(
        (${t.kind}::text = 'user' and ${t.userId} is not null and ${t.guestEmail} is null and ${t.agentId} is null and ${t.vendorId} is null and ${t.vendorContactId} is null) or
        (${t.kind}::text = 'guest' and ${t.guestEmail} is not null and ${t.userId} is null and ${t.agentId} is null and ${t.vendorId} is null and ${t.vendorContactId} is null) or
        (${t.kind}::text = 'agent' and ${t.agentId} is not null and ${t.userId} is null and ${t.guestEmail} is null and ${t.vendorId} is null and ${t.vendorContactId} is null) or
        (${t.kind}::text = 'vendor' and ${t.vendorId} is not null and ${t.vendorContactId} is not null and ${t.userId} is null and ${t.guestEmail} is null and ${t.agentId} is null)
      )`,
    ),
  ],
);

export const run = pgTable(
  "run",
  {
    id: id(),
    organizationId: orgId(),
    workflowId: text("workflow_id")
      .notNull()
      .references(() => workflow.id, { onDelete: "cascade" }),
    // Snapshot pointer — the exact version this run was born from.
    workflowVersionId: text("workflow_version_id")
      .notNull()
      .references(() => workflowVersion.id, { onDelete: "restrict" }),
    scheduleId: text("schedule_id").references(() => schedule.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    status: runStatus("status").notNull().default("active"),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    dueAt: timestamp("due_at"),
    completedAt: timestamp("completed_at"),
    createdBy: text("created_by").references(() => user.id, {
      onDelete: "set null",
    }),
    ...softDelete,
    ...timestamps,
  },
  (t) => [
    index("idx_run_org").on(t.organizationId),
    index("idx_run_workflow").on(t.workflowId),
    index("idx_run_status").on(t.status),
    // H1: composite for the common UI query "active runs in org by due date".
    index("idx_run_org_status_due").on(t.organizationId, t.status, t.dueAt),
  ],
);

export const runStep = pgTable(
  "run_step",
  {
    id: id(),
    runId: text("run_id")
      .notNull()
      .references(() => run.id, { onDelete: "cascade" }),
    stepId: text("step_id").references(() => step.id, { onDelete: "set null" }),
    title: text("title").notNull(), // snapshot
    description: text("description"), // snapshot
    position: integer("position").notNull().default(0),
    status: runStepStatus("status").notNull().default("pending"),
    assignedRoleId: text("assigned_role_id").references(() => workflowRole.id, {
      onDelete: "set null",
    }),
    dueAt: timestamp("due_at"),
    completedBy: text("completed_by").references(() => user.id, {
      onDelete: "set null",
    }),
    completedAt: timestamp("completed_at"),
    ...timestamps,
  },
  (t) => [
    index("idx_run_step_run").on(t.runId),
    index("idx_run_step_status").on(t.status),
    // H1 (run-step variant): "my tasks by due date" filters by status='pending'
    // and orders by dueAt; this composite serves that path without two index hops.
    index("idx_run_step_status_due").on(t.status, t.dueAt),
  ],
);

export const runStepAssignee = pgTable(
  "run_step_assignee",
  {
    id: id(),
    runStepId: text("run_step_id")
      .notNull()
      .references(() => runStep.id, { onDelete: "cascade" }),
    participantId: text("participant_id")
      .notNull()
      .references(() => participant.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (t) => [
    unique("uq_run_step_assignee").on(t.runStepId, t.participantId),
    // H4: the unique covers (runStepId, participantId) queries; this serves the
    // reverse direction — "what step assignments does this participant have?"
    index("idx_run_step_assignee_participant").on(t.participantId),
  ],
);

// Unified collected value. Kickoff field → runStepId null; step field → runStepId set.
// fieldId points at the pinned version's field definition. One value per field per run.
export const fieldValue = pgTable(
  "field_value",
  {
    id: id(),
    runId: text("run_id")
      .notNull()
      .references(() => run.id, { onDelete: "cascade" }),
    runStepId: text("run_step_id").references(() => runStep.id, {
      onDelete: "cascade",
    }),
    fieldId: text("field_id").references(() => field.id, {
      onDelete: "set null",
    }),
    value: jsonb("value"),
    ...timestamps,
  },
  (t) => [
    unique("uq_field_value_run_field").on(t.runId, t.fieldId),
    index("idx_field_value_run").on(t.runId),
    // H3: per-step value lookups (e.g. "show all values collected on this run step").
    index("idx_field_value_run_step").on(t.runStepId),
  ],
);

// Binds a domain role to a participant for a specific run.
export const runRoleAssignment = pgTable(
  "run_role_assignment",
  {
    id: id(),
    runId: text("run_id")
      .notNull()
      .references(() => run.id, { onDelete: "cascade" }),
    roleId: text("role_id")
      .notNull()
      .references(() => workflowRole.id, { onDelete: "cascade" }),
    participantId: text("participant_id")
      .notNull()
      .references(() => participant.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (t) => [
    unique("uq_run_role_assignment").on(t.runId, t.roleId),
    // H4: "what role assignments does this participant have?" — common for the
    // "my work" surface that resolves a user's task set across runs.
    index("idx_run_role_assignment_participant").on(t.participantId),
  ],
);

export const runRelations = relations(run, ({ one, many }) => ({
  workflow: one(workflow, {
    fields: [run.workflowId],
    references: [workflow.id],
  }),
  version: one(workflowVersion, {
    fields: [run.workflowVersionId],
    references: [workflowVersion.id],
  }),
  steps: many(runStep),
  participants: many(participant),
  values: many(fieldValue),
  roleAssignments: many(runRoleAssignment),
}));

export const runStepRelations = relations(runStep, ({ one, many }) => ({
  run: one(run, { fields: [runStep.runId], references: [run.id] }),
  assignees: many(runStepAssignee),
  values: many(fieldValue),
}));

export const runStepAssigneeRelations = relations(runStepAssignee, ({ one }) => ({
  runStep: one(runStep, {
    fields: [runStepAssignee.runStepId],
    references: [runStep.id],
  }),
  participant: one(participant, {
    fields: [runStepAssignee.participantId],
    references: [participant.id],
  }),
}));

export const runRoleAssignmentRelations = relations(runRoleAssignment, ({ one }) => ({
  run: one(run, { fields: [runRoleAssignment.runId], references: [run.id] }),
  participant: one(participant, {
    fields: [runRoleAssignment.participantId],
    references: [participant.id],
  }),
}));

export const participantRelations = relations(participant, ({ one }) => ({
  run: one(run, { fields: [participant.runId], references: [run.id] }),
  user: one(user, { fields: [participant.userId], references: [user.id] }),
  agent: one(agent, { fields: [participant.agentId], references: [agent.id] }),
  vendor: one(vendor, { fields: [participant.vendorId], references: [vendor.id] }),
  vendorContact: one(vendorContact, {
    fields: [participant.vendorContactId],
    references: [vendorContact.id],
  }),
}));

export const fieldValueRelations = relations(fieldValue, ({ one }) => ({
  run: one(run, { fields: [fieldValue.runId], references: [run.id] }),
  runStep: one(runStep, {
    fields: [fieldValue.runStepId],
    references: [runStep.id],
  }),
  field: one(field, { fields: [fieldValue.fieldId], references: [field.id] }),
}));

// Tokenized guest access (UX_SPEC §5.4, DECISIONS.md D-016 + Phase 3.5 plan).
//
// A `participant_token` lets an external participant (a `participant` row whose `userId`
// is null and `guestEmail` is set) reach a narrowed Run view at /run-guest/ with no
// Better Auth session. The token's plaintext lives only in the URL fragment sent to the
// guest -- never written to disk on our side. We store an HMAC-SHA256 hex of it, keyed by
// a stable server-side `PARTICIPANT_TOKEN_SECRET`. Determinism (`tokenHash` is a function
// of plaintext + secret) is what makes the WHERE-by-hash lookup O(1); the secret is what
// makes a DB-only leak insufficient to forge tokens.
//
// Rotating PARTICIPANT_TOKEN_SECRET invalidates every outstanding link by design -- treat
// as a stable, long-lived signing key. Soft-revoke (`revokedAt` set) preserves audit.
export const participantToken = pgTable(
  "participant_token",
  {
    id: id(),
    organizationId: orgId(),
    participantId: text("participant_id")
      .notNull()
      .references(() => participant.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    lastUsedAt: timestamp("last_used_at"),
    revokedAt: timestamp("revoked_at"),
    issuedByUserId: text("issued_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (t) => [
    unique("uq_participant_token_hash").on(t.tokenHash),
    index("idx_participant_token_org").on(t.organizationId),
    index("idx_participant_token_participant").on(t.participantId),
    check(
      "participant_token_expires_after_created",
      sql`${t.expiresAt} > ${t.createdAt}`,
    ),
  ],
);

export const participantTokenRelations = relations(participantToken, ({ one }) => ({
  participant: one(participant, {
    fields: [participantToken.participantId],
    references: [participant.id],
  }),
  issuedBy: one(user, {
    fields: [participantToken.issuedByUserId],
    references: [user.id],
  }),
}));
