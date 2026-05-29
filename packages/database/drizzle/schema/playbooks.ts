// packages/database/drizzle/schema/playbooks.ts
//
// Phase 9.6 -- Playbooks schema seam (PRD_PLAYBOOKS.md §8.1). Playbooks are the
// lifecycle-sequence sibling primitive to Workflows: multi-step, time-and-event-staged
// sequences triggered by lifecycle events (run.completed, listing.entity_set_added,
// vendor.upserted, etc.). Workflows handle branching procedures executed once;
// Playbooks handle cadences over time, often launching Workflows along the way.
//
// This module ships the schema seam ONLY -- no procedures, no UI, no Inngest functions.
// Authoring lands in Phase 18a, execution in Phase 18b, AI authoring in Phase 18c.
// Lands AFTER v1.5a (Phase 9.5) so it can reuse:
//   - `step_provenance` enum (workflows.ts, per D-040)
//   - `review_state` enum (entitysets.ts)
//   - `ai_authoring_prompt` table (ai_authoring.ts)
//   - `organization.requireConciergeReview` / `organization.labelOverrides` (auth.ts)
//   - shared `entity_type` enum (extended in _shared.ts to include the four new
//     playbook-related discriminator values)
//
// Architectural commitments encoded here:
//   - D-006: org-scoping top-level (every table carries organizationId via orgId() helper,
//     or inherits via FK chain through playbook).
//   - D-018: snapshot immutability on publish. playbook_version is the snapshot;
//     in-flight playbook_runs pin to a specific playbook_version_id; editing creates
//     a new version row (writes never mutate a published version).
//   - D-039: step-list is canonical authoring data model. NO node-graph schema here;
//     branching is modeled as a single step type (`branch_on_data_set`) with N labeled
//     sub-paths captured via `branch_label` + `parent_step_id` on playbook_step.
//   - D-040: per-step provenance tracking. playbook_step.provenance reuses the shared
//     `step_provenance` enum; `agents.regeneratePlaybookStep` (Phase 18c) refuses to
//     write any sibling step with `manually_edited`.
//   - D-041: no canvas/layout state on the snapshot. If/when authoring-grade canvas
//     ships for Playbooks (Phase 13+ per D-039), layout lives in a separate
//     playbook_canvas_layout table keyed by playbook_id -- NOT on playbook_version.
//
// Design notes:
//   - "Current version" is computed via a query for published versions, not a
//     workflow.currentVersionId FK -- matches the workflow precedent. Skips a circular-
//     thunk pattern that the workflow table also skips. If a single-FK perf concern
//     emerges later, add it then with the AnyPgColumn lazy-thunk pattern.
//   - playbook_run.trigger_fingerprint enables per-trigger dedup (mirrors run_rule_fired
//     from automation.ts). Unique (playbook_version_id, trigger_entity_id, trigger_fingerprint)
//     prevents double-firing on duplicate trigger events.
//   - playbook_run_step.launched_run_id is only populated for `launch_workflow` step
//     types after the spawned `runs.launch` resolves. ON DELETE SET NULL so a deleted
//     workflow run doesn't cascade-delete its parent playbook execution history.
//   - `is_active` default false: newly authored Playbooks must be explicitly enabled
//     before the Inngest dispatcher (Phase 18b) will fire them. Critical for safely
//     staging a Playbook + dry-rendering it before live event traffic touches it.

import { relations, sql } from "drizzle-orm";
import {
	type AnyPgColumn,
	boolean,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	unique,
} from "drizzle-orm/pg-core";

import { aiAuthoringPrompt } from "./ai_authoring";
import { reviewState } from "./entitysets";
import { run } from "./runs";
import { stepProvenance } from "./workflows";
import {
	id,
	orgId,
	organization,
	softDelete,
	timestamps,
	user,
} from "./_shared";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

// The six v1 step types. Deliberately small (per PRD §6.1) -- all other Besty-style
// step shapes (call webhook directly, set field on a parent entity, escalate) are
// covered by `automation_action` actions on the Workflows that Playbooks launch,
// keeping the action catalog single-sourced.
export const playbookStepType = pgEnum("playbook_step_type", [
	"wait_for_duration",
	"wait_for_event",
	"launch_workflow",
	"send_notification",
	"branch_on_data_set",
	"write_to_data_set",
]);

// `manual` = operator clicks "Run Playbook" from the detail page; one-off, ignores
// is_active gate (operator-initiated override).
// `lifecycle_event` = Inngest dispatcher fires on a matching event from
// `playbook_lifecycle_event` plus trigger_config narrowing.
export const playbookTriggerType = pgEnum("playbook_trigger_type", [
	"manual",
	"lifecycle_event",
]);

// v1 lifecycle event catalog. PM-initiated work is NOT a separate trigger -- per
// D-025 there are no PM → Ops webhook events; PM calls `runs.launch` as an agent
// principal and the resulting run carries `crossProductOrigin='virn-pm'`. Playbooks
// that want to scope to PM-initiated work add a `crossProductOriginFilter='virn-pm'`
// in `trigger_config`. No `cross_product` enum value needed.
export const playbookLifecycleEvent = pgEnum("playbook_lifecycle_event", [
	"run.completed",
	"run.state_changed",
	"listing.entity_set_added",
	"vendor.upserted",
]);

// Lifecycle states for an entire playbook_run. `waiting` distinguishes "blocked on
// step.sleep / step.waitForEvent" from `active` ("currently executing a step body").
// `cancelled` records operator-initiated termination; `failed` records orchestrator
// terminal error after retry budget.
export const playbookRunStatus = pgEnum("playbook_run_status", [
	"pending",
	"active",
	"waiting",
	"completed",
	"failed",
	"cancelled",
]);

// Per-step execution states. `skipped` records branches not taken on a
// `branch_on_data_set` step (only the chosen sub-path executes).
export const playbookRunStepStatus = pgEnum("playbook_run_step_status", [
	"pending",
	"active",
	"waiting",
	"completed",
	"skipped",
	"failed",
	"cancelled",
]);

// ---------------------------------------------------------------------------
// Definition layer
// ---------------------------------------------------------------------------

export const playbook = pgTable(
	"playbook",
	{
		id: id(),
		organizationId: orgId(),
		name: text("name").notNull(),
		description: text("description"),
		// D-039 / PRD §6.3 -- entity-set scope. Empty array = "applies to any entity"
		// (default; preserves "no scoping" behavior). Non-empty narrows the trigger
		// dispatcher to entities whose entity_set memberships intersect this list.
		// text[] (cuid2) for parity with workflow.entity_set_ids (NOT uuid[]).
		entitySetIds: text("entity_set_ids").array().notNull().default(sql`'{}'`),
		// PRD §6.1 -- editorial review state. Reuses the same `review_state` enum
		// authored in entitysets.ts (v1.5a) and adopted by workflow.review_state.
		// `requireConciergeReview` org gate flips Publish → Submit for review.
		reviewState: reviewState("review_state").notNull().default("draft"),
		// PRD §6.1 / §6.4 -- top-bar Enabled/Disabled toggle. The Inngest dispatcher
		// (Phase 18b) MUST filter on `is_active = true` before firing lifecycle-event
		// triggers -- disabled Playbooks are skipped. Default false so newly authored
		// Playbooks must be explicitly enabled before live event traffic touches them.
		// Manual launches via `playbookRuns.launchManual` (Phase 18b) ignore this gate
		// (operator-initiated, intentional override).
		isActive: boolean("is_active").notNull().default(false),
		// Phase 18c -- AI authoring provenance. Set when the playbook was created via
		// `agents.authorPlaybook`; null for hand-authored playbooks. SET NULL on
		// delete (provenance is auditable but not load-bearing for run execution).
		aiAuthoringPromptId: text("ai_authoring_prompt_id").references(
			() => aiAuthoringPrompt.id,
			{ onDelete: "set null" },
		),
		createdBy: text("created_by").references(() => user.id, {
			onDelete: "set null",
		}),
		...softDelete,
		...timestamps,
	},
	(t) => [
		index("idx_playbook_org").on(t.organizationId),
		// Org-scoped uniqueness. Soft-deleted rows would not collide because Drizzle's
		// `unique()` honors all rows; we accept the collision risk as the simpler v1
		// shape and mirror workflow's name-collision posture (no per-org name dedupe
		// on workflow today either -- both rely on operator discipline + builder UX).
		unique("uq_playbook_org_name").on(t.organizationId, t.name),
	],
);

export const playbookVersion = pgTable(
	"playbook_version",
	{
		id: id(),
		playbookId: text("playbook_id")
			.notNull()
			.references(() => playbook.id, { onDelete: "cascade" }),
		versionNumber: integer("version_number").notNull(),
		// Trigger configuration captured at PUBLISH time -- the snapshot includes
		// what triggers this version listens for. Editing the playbook to change
		// triggers creates a new version; in-flight playbook_runs continue with
		// their pinned trigger config.
		triggerType: playbookTriggerType("trigger_type").notNull(),
		// Null when trigger_type='manual'. The specific lifecycle event name when
		// trigger_type='lifecycle_event'.
		triggerEvent: playbookLifecycleEvent("trigger_event"),
		// Trigger narrowing config: { workflowId?, workflowSlug?, stateFrom?, stateTo?,
		// crossProductOriginFilter? }. Schema is enforced at the procedure layer (Zod
		// validator in Phase 18a) -- jsonb here to avoid an enum-per-trigger schema
		// explosion as new lifecycle events land.
		triggerConfig: jsonb("trigger_config").notNull().default(sql`'{}'::jsonb`),
		// Optional dedup window in hours -- null means "no extra dedup beyond the
		// (playbookVersionId, triggerEntityId, triggerFingerprint) uniqueness on
		// playbook_run". Used by triggers that genuinely want re-fire after a
		// cooldown (e.g. "re-engage if vendor.upserted fires again after 90 days").
		dedupWindowHours: integer("dedup_window_hours"),
		publishedAt: timestamp("published_at"),
		publishedBy: text("published_by").references(() => user.id, {
			onDelete: "set null",
		}),
		...timestamps,
	},
	(t) => [
		unique("uq_playbook_version_number").on(t.playbookId, t.versionNumber),
		index("idx_playbook_version_playbook").on(t.playbookId),
	],
);

export const playbookStep = pgTable(
	"playbook_step",
	{
		id: id(),
		playbookVersionId: text("playbook_version_id")
			.notNull()
			.references(() => playbookVersion.id, { onDelete: "cascade" }),
		position: integer("position").notNull().default(0),
		type: playbookStepType("type").notNull(),
		// Type-specific config payload. Shape varies by `type`:
		//   wait_for_duration: { amount: int, unit: 'minutes'|'hours'|'days'|'weeks' }
		//   wait_for_event: { eventName, entityRef, timeoutDays?, onTimeout: 'continue'|'abort' }
		//   launch_workflow: { workflowId, kickoffMapping, waitForCompletion: bool, mode? }
		//   send_notification: { channelHint, templateRef, audience, payloadMapping }
		//   branch_on_data_set: { source, operator, branches: [{ label, condition, nextStepId }] }
		//   write_to_data_set: { datasetId, recordKey, fieldMapping }
		// Validation lives at the Phase 18a procedure layer (Zod discriminated union);
		// jsonb here to avoid one column-per-step-type explosion.
		config: jsonb("config").notNull(),
		// Branch sub-path label (e.g. "approved", "rejected", "yes", "no") -- non-null
		// on steps that are children of a `branch_on_data_set` step. Renders inline
		// in the builder vertical step list as labeled sub-lanes per PRD §6.1.
		branchLabel: text("branch_label"),
		// Self-FK to the parent branching step. Non-null for branch children. SET NULL
		// on delete so deleting the branch parent doesn't cascade-delete the sub-steps
		// (which may have valuable AI authoring history); the application surfaces
		// orphaned branch children for the author to re-parent or delete. Lazy thunk
		// for the self-reference (Drizzle resolves at relation-graph time, not at
		// module-evaluation time -- same pattern as workflow.installedFromListingVersionId).
		parentStepId: text("parent_step_id").references(
			(): AnyPgColumn => playbookStep.id,
			{ onDelete: "set null" },
		),
		// D-040 -- partial-regeneration contract. Same `step_provenance` enum used
		// by workflow.step (v1.5a, per acaa8a8 commit). AI-emitted steps via
		// `agents.authorPlaybook` / `agents.regeneratePlaybookStep` (Phase 18c) write
		// `ai_generated`; any manual edit through the Phase 18a structure procedure
		// flips back to `manually_edited` (irreversible in v1). The future regenerate
		// procedure refuses to touch siblings with `manually_edited`.
		provenance: stepProvenance("provenance")
			.notNull()
			.default("manually_edited"),
		...timestamps,
	},
	(t) => [
		index("idx_playbook_step_version_position").on(
			t.playbookVersionId,
			t.position,
		),
		index("idx_playbook_step_parent").on(t.parentStepId),
	],
);

// ---------------------------------------------------------------------------
// Execution layer
// ---------------------------------------------------------------------------

export const playbookRun = pgTable(
	"playbook_run",
	{
		id: id(),
		organizationId: orgId(),
		playbookVersionId: text("playbook_version_id")
			.notNull()
			.references(() => playbookVersion.id),
		status: playbookRunStatus("status").notNull().default("pending"),
		// Inbound trigger context. `triggerEntityType` matches the polymorphic
		// `entity_type` discriminator (e.g. 'run', 'listing', 'vendor'); the entity_id
		// is plain text (cuid2) -- no FK because the entity type varies and may include
		// non-FK targets (cross-product references).
		triggerEntityType: text("trigger_entity_type"),
		triggerEntityId: text("trigger_entity_id"),
		// Full snapshot of the inbound trigger payload (the Inngest event body the
		// dispatcher received). Used by branch evaluators + step config resolvers; also
		// preserved for forensic replay if a run misfires.
		triggerPayload: jsonb("trigger_payload").notNull(),
		// Hash of (entityRef + meaningful payload fields) for idempotency. Combined
		// with playbook_version_id + trigger_entity_id in the unique constraint below
		// to prevent double-firing on duplicate trigger events.
		triggerFingerprint: text("trigger_fingerprint").notNull(),
		// Pointer to the currently-executing or last-known step. Updated as the
		// Inngest orchestrator advances through the step list. Null when status is
		// 'pending' (not yet started) or 'completed' / 'cancelled' (no current step).
		currentStepId: text("current_step_id").references(() => playbookStep.id, {
			onDelete: "set null",
		}),
		// Scheduled wake time for `wait_for_duration` / `wait_for_event` steps. Read
		// by the operator surface to render the "next wake at ..." countdown on the
		// Active Run card (R6 lift, per UX_SPEC §5.6).
		nextWakeAt: timestamp("next_wake_at"),
		startedAt: timestamp("started_at"),
		completedAt: timestamp("completed_at"),
		cancelledAt: timestamp("cancelled_at"),
		cancelledByUserId: text("cancelled_by_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		// Cross-product origin attribution, per D-027. Set when the trigger came
		// from a PM-initiated run (the source run carries `crossProductOrigin='virn-pm'`
		// on its audit rows, and the Playbook dispatcher propagates the value through).
		// Propagated to all downstream effects (launched workflow runs, audit/activity
		// writes) so the cross-product origin survives the whole orchestration chain.
		crossProductOrigin: text("cross_product_origin"),
		...timestamps,
	},
	(t) => [
		index("idx_playbook_run_org").on(t.organizationId),
		index("idx_playbook_run_status").on(t.status),
		index("idx_playbook_run_next_wake").on(t.nextWakeAt),
		// Idempotency guard: a given (playbook_version, entity, fingerprint) tuple
		// can produce at most one playbook_run. Duplicate trigger events that hash
		// to the same fingerprint collide on this constraint and are dropped at
		// the dispatcher layer. Composite includes playbook_version_id so a new
		// version of the same playbook can re-fire against the same entity.
		unique("uq_playbook_run_dedup").on(
			t.playbookVersionId,
			t.triggerEntityId,
			t.triggerFingerprint,
		),
	],
);

export const playbookRunStep = pgTable(
	"playbook_run_step",
	{
		id: id(),
		playbookRunId: text("playbook_run_id")
			.notNull()
			.references(() => playbookRun.id, { onDelete: "cascade" }),
		playbookStepId: text("playbook_step_id")
			.notNull()
			.references(() => playbookStep.id),
		status: playbookRunStepStatus("status").notNull().default("pending"),
		// Per-step result payload. Shape varies by step type:
		//   send_notification: { messageId, deliveredAt }
		//   launch_workflow: { runId, status }
		//   branch_on_data_set: { evaluatedValue, takenBranchLabel }
		//   write_to_data_set: { recordId }
		//   wait_for_* : null (waits don't produce a result, just state transitions)
		// Populated by the Inngest orchestrator at step completion / failure.
		resultPayload: jsonb("result_payload"),
		// For `launch_workflow` steps -- the run id of the spawned Ops run. Set after
		// the inner `runs.launch` resolves. Lets the Active Run card surface the
		// child Workflow run alongside the parent Playbook run on entity pages
		// (per UX_SPEC §5.6). ON DELETE SET NULL so a deleted Workflow run doesn't
		// cascade-delete this row (the playbook run history is still valuable).
		launchedRunId: text("launched_run_id").references(() => run.id, {
			onDelete: "set null",
		}),
		startedAt: timestamp("started_at"),
		completedAt: timestamp("completed_at"),
		...timestamps,
	},
	(t) => [
		index("idx_playbook_run_step_run").on(t.playbookRunId),
		index("idx_playbook_run_step_step").on(t.playbookStepId),
	],
);

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const playbookRelations = relations(playbook, ({ one, many }) => ({
	organization: one(organization, {
		fields: [playbook.organizationId],
		references: [organization.id],
	}),
	aiAuthoringPrompt: one(aiAuthoringPrompt, {
		fields: [playbook.aiAuthoringPromptId],
		references: [aiAuthoringPrompt.id],
	}),
	creator: one(user, {
		fields: [playbook.createdBy],
		references: [user.id],
	}),
	versions: many(playbookVersion),
}));

export const playbookVersionRelations = relations(
	playbookVersion,
	({ one, many }) => ({
		playbook: one(playbook, {
			fields: [playbookVersion.playbookId],
			references: [playbook.id],
		}),
		publisher: one(user, {
			fields: [playbookVersion.publishedBy],
			references: [user.id],
		}),
		steps: many(playbookStep),
		runs: many(playbookRun),
	}),
);

export const playbookStepRelations = relations(
	playbookStep,
	({ one, many }) => ({
		playbookVersion: one(playbookVersion, {
			fields: [playbookStep.playbookVersionId],
			references: [playbookVersion.id],
		}),
		parent: one(playbookStep, {
			fields: [playbookStep.parentStepId],
			references: [playbookStep.id],
			relationName: "playbook_step_branch_children",
		}),
		children: many(playbookStep, {
			relationName: "playbook_step_branch_children",
		}),
		runSteps: many(playbookRunStep),
	}),
);

export const playbookRunRelations = relations(
	playbookRun,
	({ one, many }) => ({
		organization: one(organization, {
			fields: [playbookRun.organizationId],
			references: [organization.id],
		}),
		playbookVersion: one(playbookVersion, {
			fields: [playbookRun.playbookVersionId],
			references: [playbookVersion.id],
		}),
		currentStep: one(playbookStep, {
			fields: [playbookRun.currentStepId],
			references: [playbookStep.id],
			relationName: "playbook_run_current_step",
		}),
		canceller: one(user, {
			fields: [playbookRun.cancelledByUserId],
			references: [user.id],
		}),
		runSteps: many(playbookRunStep),
	}),
);

export const playbookRunStepRelations = relations(
	playbookRunStep,
	({ one }) => ({
		playbookRun: one(playbookRun, {
			fields: [playbookRunStep.playbookRunId],
			references: [playbookRun.id],
		}),
		playbookStep: one(playbookStep, {
			fields: [playbookRunStep.playbookStepId],
			references: [playbookStep.id],
		}),
		launchedRun: one(run, {
			fields: [playbookRunStep.launchedRunId],
			references: [run.id],
		}),
	}),
);
