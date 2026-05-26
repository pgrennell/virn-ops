// packages/database/drizzle/queries/runs.ts
//
// Execution-layer DB helpers for the run engine (ARCHITECTURE.md §5; BUILD_PLAN.md Phase 3).
// Every read/write here is org-scoped per Invariant #1 -- callers pass `organizationId`
// explicitly and the queries filter on it. There is no global "current org" context.
//
// Snapshot semantics (Invariant #3 / #4): runs are created from PUBLISHED workflow_versions.
// runStep.title and .description are copied by value so later template edits never rewrite
// in-flight runs. Fields are NOT re-copied per-run; field_value.fieldId FKs the pinned
// version's field rows, which are immutable post-publish by convention.

import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";

import { db, type DbExecutor } from "../client";
import {
	activityEvent,
	auditLog,
	field,
	fieldValue,
	organization,
	participant,
	run,
	runRoleAssignment,
	runStep,
	runStepAssignee,
	stepDependency,
	workflow,
	type fieldType as fieldTypeEnum,
} from "../schema/postgres";

// ---------------------------------------------------------------------------
// Types shared by api/modules/runs/lib
// ---------------------------------------------------------------------------

// Derived from the pgEnum in schema/workflows.ts. Single source of truth — adding
// a new field type there (with a migration) automatically expands this union and
// catches missing branches in `buildFieldZod` / `validateFieldValue` at compile time.
export type FieldType = (typeof fieldTypeEnum)["enumValues"][number];

export interface RoleAssignmentInput {
	roleId: string;
	userId?: string | null;
	guestEmail?: string | null;
	guestName?: string | null;
}

// ---------------------------------------------------------------------------
// Definition reads (for launchRun)
// ---------------------------------------------------------------------------

/** Fetch a workflow scoped to the org. Returns null if not found or not in this org. */
export async function getWorkflowForOrg(organizationId: string, workflowId: string) {
	return (
		(await db.query.workflow.findFirst({
			where: (w, { and: a, eq: e }) => a(e(w.id, workflowId), e(w.organizationId, organizationId)),
		})) ?? null
	);
}

/** Find the most recent published version of a workflow. Returns null if none is published. */
export async function getLatestPublishedWorkflowVersion(workflowId: string) {
	return (
		(await db.query.workflowVersion.findFirst({
			where: (v, { and: a, eq: e }) => a(e(v.workflowId, workflowId), e(v.status, "published")),
			orderBy: (v, { desc }) => [desc(v.versionNumber)],
		})) ?? null
	);
}

/** Fetch a specific version. Caller must verify status before launching from it. */
export async function getWorkflowVersionById(versionId: string) {
	return (
		(await db.query.workflowVersion.findFirst({
			where: (v, { eq: e }) => e(v.id, versionId),
		})) ?? null
	);
}

/** Pull everything needed to snapshot a launch: all steps (with due-config), all fields
 * (kickoff + step-scoped), and all step_dependency rows for the version. Returned in a
 * single object for atomic consumption by launchRun. */
export async function getVersionLaunchBundle(workflowVersionId: string) {
	const [steps, fields, deps] = await Promise.all([
		db.query.step.findMany({
			where: (s, { eq: e }) => e(s.workflowVersionId, workflowVersionId),
			orderBy: (s, { asc }) => [asc(s.position)],
		}),
		db.query.field.findMany({
			where: (f, { eq: e }) => e(f.workflowVersionId, workflowVersionId),
			orderBy: (f, { asc }) => [asc(f.position)],
		}),
		db
			.select({
				stepId: stepDependency.stepId,
				dependsOnStepId: stepDependency.dependsOnStepId,
			})
			.from(stepDependency)
			.innerJoin(
				sql`(SELECT id FROM step WHERE workflow_version_id = ${workflowVersionId}) AS s`,
				sql`s.id = ${stepDependency.stepId}`,
			),
	]);
	return { steps, fields, deps };
}

// ---------------------------------------------------------------------------
// Snapshot write (transactional)
// ---------------------------------------------------------------------------

export interface SnapshotStepRow {
	stepId: string;
	title: string;
	description: string | null;
	position: number;
	assignedRoleId: string | null;
	dueAt: Date | null;
}

export interface SnapshotKickoffValue {
	fieldId: string;
	value: unknown;
}

export interface SnapshotParticipantRow {
	tempKey: string; // caller-assigned key so we can wire role/assignee rows after insert
	userId: string | null;
	guestEmail: string | null;
	guestName: string | null;
}

export interface SnapshotRoleAssignmentRow {
	roleId: string;
	participantTempKey: string;
}

export interface SnapshotStepAssignmentRow {
	stepId: string; // definition stepId; we resolve to the newly-created runStepId
	participantTempKey: string;
}

/** Insert run + runSteps + kickoff field_values + participants + role assignments + step
 * assignees in a single transaction. Returns the new runId. */
export async function insertRunSnapshot(input: {
	organizationId: string;
	workflowId: string;
	workflowVersionId: string;
	title: string;
	createdBy: string;
	startedAt: Date;
	runDueAt: Date | null;
	steps: SnapshotStepRow[];
	kickoffValues: SnapshotKickoffValue[];
	participants: SnapshotParticipantRow[];
	roleAssignments: SnapshotRoleAssignmentRow[];
	stepAssignments: SnapshotStepAssignmentRow[];
}): Promise<{ runId: string; runStepIdByStepId: Map<string, string> }> {
	return await db.transaction(async (tx) => {
		const [runRow] = await tx
			.insert(run)
			.values({
				organizationId: input.organizationId,
				workflowId: input.workflowId,
				workflowVersionId: input.workflowVersionId,
				title: input.title,
				status: "active",
				startedAt: input.startedAt,
				dueAt: input.runDueAt,
				createdBy: input.createdBy,
			})
			.returning({ id: run.id });
		const runId = runRow.id;

		// runSteps
		const runStepIdByStepId = new Map<string, string>();
		if (input.steps.length > 0) {
			const inserted = await tx
				.insert(runStep)
				.values(
					input.steps.map((s) => ({
						runId,
						stepId: s.stepId,
						title: s.title,
						description: s.description,
						position: s.position,
						assignedRoleId: s.assignedRoleId,
						dueAt: s.dueAt,
						status: "pending" as const,
					})),
				)
				.returning({ id: runStep.id, stepId: runStep.stepId });
			for (const r of inserted) {
				if (r.stepId) runStepIdByStepId.set(r.stepId, r.id);
			}
		}

		// kickoff field_values
		if (input.kickoffValues.length > 0) {
			await tx.insert(fieldValue).values(
				input.kickoffValues.map((v) => ({
					runId,
					runStepId: null,
					fieldId: v.fieldId,
					value: v.value,
				})),
			);
		}

		// participants (with temp keys we resolve to ids below)
		const participantIdByTempKey = new Map<string, string>();
		if (input.participants.length > 0) {
			const inserted = await tx
				.insert(participant)
				.values(
					input.participants.map((p) => ({
						organizationId: input.organizationId,
						runId,
						userId: p.userId,
						guestEmail: p.guestEmail,
						guestName: p.guestName,
					})),
				)
				.returning({ id: participant.id });
			for (let i = 0; i < inserted.length; i++) {
				participantIdByTempKey.set(input.participants[i].tempKey, inserted[i].id);
			}
		}

		// role assignments
		if (input.roleAssignments.length > 0) {
			await tx.insert(runRoleAssignment).values(
				input.roleAssignments.map((ra) => ({
					runId,
					roleId: ra.roleId,
					participantId:
						participantIdByTempKey.get(ra.participantTempKey) ??
						(() => {
							throw new Error(
								`insertRunSnapshot: unresolved participant tempKey "${ra.participantTempKey}" in roleAssignments`,
							);
						})(),
				})),
			);
		}

		// step assignees
		if (input.stepAssignments.length > 0) {
			await tx.insert(runStepAssignee).values(
				input.stepAssignments.map((sa) => {
					const runStepId = runStepIdByStepId.get(sa.stepId);
					if (!runStepId) {
						throw new Error(
							`insertRunSnapshot: stepAssignments references unknown stepId "${sa.stepId}"`,
						);
					}
					const participantId = participantIdByTempKey.get(sa.participantTempKey);
					if (!participantId) {
						throw new Error(
							`insertRunSnapshot: stepAssignments references unresolved tempKey "${sa.participantTempKey}"`,
						);
					}
					return { runStepId, participantId };
				}),
			);
		}

		return { runId, runStepIdByStepId };
	});
}

// ---------------------------------------------------------------------------
// Run-view reads (for getRun)
// ---------------------------------------------------------------------------

/** Fetch a run with everything the Run view needs: steps + values + participants + role
 * assignments + the workflow title for chrome + the version's snapshot context (sections,
 * step definitions for section/type lookup, field definitions for input rendering).
 *
 * Returns null if not found or wrong org. The version's sections/steps/fields are
 * IMMUTABLE post-publish by convention (Invariant #4), so they're safe to surface to the
 * client alongside the mutable runtime data without breaking snapshot semantics.
 */
export async function getRunForOrg(organizationId: string, runId: string) {
	return (
		(await db.query.run.findFirst({
			where: (r, { and: a, eq: e }) => a(e(r.id, runId), e(r.organizationId, organizationId)),
			with: {
				workflow: {
					columns: { id: true, title: true, type: true },
				},
				version: {
					columns: { id: true, versionNumber: true, status: true },
					with: {
						sections: true,
						steps: true,
						fields: true,
					},
				},
				steps: {
					with: {
						assignees: {
							with: {
								participant: true,
							},
						},
					},
				},
				values: true,
				participants: true,
				roleAssignments: true,
			},
		})) ?? null
	);
}

/** Get all step_dependency rows for the steps referenced by a run's snapshotted steps.
 * Used to compute the `blocked` flag in the view layer. */
export async function getDependenciesForRunSteps(
	stepIds: string[],
): Promise<Array<{ stepId: string; dependsOnStepId: string }>> {
	if (stepIds.length === 0) return [];
	return await db
		.select({
			stepId: stepDependency.stepId,
			dependsOnStepId: stepDependency.dependsOnStepId,
		})
		.from(stepDependency)
		.where(inArray(stepDependency.stepId, stepIds));
}

// ---------------------------------------------------------------------------
// Guest run bundle (for tokenized guest access -- Phase 3.5)
// ---------------------------------------------------------------------------
//
// Single narrowed read that returns ONLY the data a guest participant is allowed to see
// for one run: the run header, the steps they're assigned to, step-scoped fields (NOT
// kickoff), their values, plus the dependency rows needed to compute the `blocked` flag.
// Nothing about other participants, other steps, kickoff fields, the workflow graph, or
// org settings leaks through. The narrowing IS the security boundary -- transport-layer
// bugs can't leak data we never fetched.
//
// Keeping this in @virn/database (not in @virn/api/lib) preserves the convention that
// only the database package imports drizzle-orm primitives.

export interface GuestRunBundle {
	run: {
		id: string;
		title: string;
		status: "active" | "completed" | "archived";
		startedAt: Date;
		dueAt: Date | null;
		orgName: string;
	};
	steps: Array<{
		id: string;
		stepId: string | null;
		title: string;
		description: string | null;
		status: "pending" | "completed" | "skipped" | "not_applicable";
		dueAt: Date | null;
	}>;
	fields: Array<{
		id: string;
		stepId: string | null;
		key: string;
		label: string;
		fieldType: FieldType;
		config: Record<string, unknown> | null;
		isRequired: boolean;
		position: number;
	}>;
	values: Array<{
		fieldId: string | null;
		runStepId: string | null;
		value: unknown;
	}>;
	dependencies: Array<{ stepId: string; dependsOnStepId: string }>;
	dependeeStatuses: Array<{ stepId: string | null; status: string }>;
}

/** Return null when the run doesn't exist or doesn't match the participant's org. The
 * caller (`getRunForGuest` in api lib) treats null as `GUEST_TOKEN_INVALID`. */
export async function getGuestRunBundle(input: {
	organizationId: string;
	participantId: string;
	runId: string;
}): Promise<GuestRunBundle | null> {
	const runRows = await db
		.select({
			id: run.id,
			title: run.title,
			status: run.status,
			startedAt: run.startedAt,
			dueAt: run.dueAt,
			orgName: organization.name,
		})
		.from(run)
		.innerJoin(organization, eq(organization.id, run.organizationId))
		.where(and(eq(run.id, input.runId), eq(run.organizationId, input.organizationId)))
		.limit(1);
	const r = runRows[0];
	if (!r) return null;

	const steps = await db
		.select({
			id: runStep.id,
			stepId: runStep.stepId,
			title: runStep.title,
			description: runStep.description,
			status: runStep.status,
			dueAt: runStep.dueAt,
		})
		.from(runStepAssignee)
		.innerJoin(runStep, eq(runStep.id, runStepAssignee.runStepId))
		.where(
			and(
				eq(runStepAssignee.participantId, input.participantId),
				eq(runStep.runId, input.runId),
			),
		);

	if (steps.length === 0) {
		return {
			run: r,
			steps: [],
			fields: [],
			values: [],
			dependencies: [],
			dependeeStatuses: [],
		};
	}

	const defStepIds = steps.map((s) => s.stepId).filter((id): id is string => id !== null);
	const runStepIds = steps.map((s) => s.id);

	const [dependencies, fields, values] = await Promise.all([
		defStepIds.length
			? db
					.select({
						stepId: stepDependency.stepId,
						dependsOnStepId: stepDependency.dependsOnStepId,
					})
					.from(stepDependency)
					.where(inArray(stepDependency.stepId, defStepIds))
			: Promise.resolve([] as Array<{ stepId: string; dependsOnStepId: string }>),
		defStepIds.length
			? db
					.select({
						id: field.id,
						stepId: field.stepId,
						key: field.key,
						label: field.label,
						fieldType: field.fieldType,
						config: field.config,
						isRequired: field.isRequired,
						position: field.position,
					})
					.from(field)
					.where(inArray(field.stepId, defStepIds))
			: Promise.resolve(
					[] as Array<{
						id: string;
						stepId: string | null;
						key: string;
						label: string;
						fieldType: FieldType;
						config: Record<string, unknown> | null;
						isRequired: boolean;
						position: number;
					}>,
				),
		runStepIds.length
			? db
					.select({
						fieldId: fieldValue.fieldId,
						runStepId: fieldValue.runStepId,
						value: fieldValue.value,
					})
					.from(fieldValue)
					.where(inArray(fieldValue.runStepId, runStepIds))
			: Promise.resolve(
					[] as Array<{ fieldId: string | null; runStepId: string | null; value: unknown }>,
				),
	]);

	const dependeeStepIds = [...new Set(dependencies.map((d) => d.dependsOnStepId))];
	const dependeeStatuses = dependeeStepIds.length
		? await db
				.select({ stepId: runStep.stepId, status: runStep.status })
				.from(runStep)
				.where(
					and(eq(runStep.runId, input.runId), inArray(runStep.stepId, dependeeStepIds)),
				)
		: [];

	return {
		run: r,
		steps,
		fields,
		values,
		dependencies,
		dependeeStatuses,
	};
}

// ---------------------------------------------------------------------------
// Field-value mutator (for setFieldValue)
// ---------------------------------------------------------------------------

/** Find a field row by version + key, optionally scoped to a particular step (or kickoff
 * when stepId is null). The unique-by-(versionId, key) constraint on `field` ensures at
 * most one match. */
export async function findFieldByVersionAndKey(
	workflowVersionId: string,
	fieldKey: string,
): Promise<typeof field.$inferSelect | null> {
	return (
		(await db.query.field.findFirst({
			where: (f, { and: a, eq: e }) =>
				a(e(f.workflowVersionId, workflowVersionId), e(f.key, fieldKey)),
		})) ?? null
	);
}

/** Upsert a field value scoped to (runId, fieldId). Returns nothing -- caller handles
 * audit + activity writes separately. */
export async function upsertRunFieldValue(
	input: {
		runId: string;
		runStepId: string | null;
		fieldId: string;
		value: unknown;
	},
	executor: DbExecutor = db,
): Promise<void> {
	await executor
		.insert(fieldValue)
		.values({
			runId: input.runId,
			runStepId: input.runStepId,
			fieldId: input.fieldId,
			value: input.value,
		})
		.onConflictDoUpdate({
			target: [fieldValue.runId, fieldValue.fieldId],
			set: {
				value: input.value,
				runStepId: input.runStepId,
				updatedAt: new Date(),
			},
		});
}

// ---------------------------------------------------------------------------
// Step-completion reads + mutators
// ---------------------------------------------------------------------------

/** Fetch a runStep with its parent run (for org check + version lookup). Returns null if
 * not found or wrong org. The nested `participant` columns are not narrowed because
 * drizzle's column-selection on nested relations infers `never` for the related entity in
 * some configurations -- so we select all participant columns. */
export async function getRunStepWithRun(organizationId: string, runStepId: string) {
	const found = await db.query.runStep.findFirst({
		where: (rs, { eq: e }) => e(rs.id, runStepId),
		with: {
			run: {
				columns: {
					id: true,
					organizationId: true,
					status: true,
					workflowVersionId: true,
				},
			},
			assignees: {
				with: { participant: true },
			},
		},
	});
	if (!found) return null;
	if (found.run.organizationId !== organizationId) return null;
	return found;
}

/** All required fields belonging to a definition step. Used by completeStep refusal. */
export async function getRequiredFieldsForStep(
	stepId: string,
): Promise<Array<{ id: string; key: string }>> {
	return await db
		.select({ id: field.id, key: field.key })
		.from(field)
		.where(and(eq(field.stepId, stepId), eq(field.isRequired, true)));
}

/** Fetch field_value rows for a run + fieldIds set. Used to verify required fields are
 * filled before completing a step. */
export async function getFieldValuesForRun(
	runId: string,
	fieldIds: string[],
): Promise<Array<{ fieldId: string | null; value: unknown }>> {
	if (fieldIds.length === 0) return [];
	return await db
		.select({ fieldId: fieldValue.fieldId, value: fieldValue.value })
		.from(fieldValue)
		.where(and(eq(fieldValue.runId, runId), inArray(fieldValue.fieldId, fieldIds)));
}

/** Find any stop-task dependencies for the given definition step whose dependee's runStep
 * is NOT in `completed` status for this run. Returns the offending definition stepIds. */
export async function findIncompleteStopDependencies(
	runId: string,
	stepId: string,
): Promise<string[]> {
	const deps = await db
		.select({ dependsOnStepId: stepDependency.dependsOnStepId })
		.from(stepDependency)
		.where(eq(stepDependency.stepId, stepId));
	if (deps.length === 0) return [];
	const depStepIds = deps.map((d) => d.dependsOnStepId);
	const dependeeRunSteps = await db
		.select({ stepId: runStep.stepId, status: runStep.status })
		.from(runStep)
		.where(and(eq(runStep.runId, runId), inArray(runStep.stepId, depStepIds)));
	const completedSet = new Set(
		dependeeRunSteps.filter((r) => r.status === "completed").map((r) => r.stepId),
	);
	return depStepIds.filter((id) => !completedSet.has(id));
}

/** Mark a runStep completed. `completedBy` is nullable -- a guest participant has no
 * Better Auth user id; the actor's identity for guests is captured in audit/activity
 * metadata (participantId) instead. No-op if already completed (caller should check
 * first to avoid duplicate audit/activity writes). */
export async function markRunStepCompleted(
	input: {
		runStepId: string;
		completedBy: string | null;
	},
	executor: DbExecutor = db,
): Promise<void> {
	await executor
		.update(runStep)
		.set({
			status: "completed",
			completedAt: new Date(),
			completedBy: input.completedBy,
		})
		.where(eq(runStep.id, input.runStepId));
}

/** Count runSteps grouped by status for cascade-to-run-complete. Returns whether every
 * REQUIRED step (i.e. step.isRequired = true) is `completed`. Heading/optional steps don't
 * block run completion. */
export async function areAllRequiredRunStepsComplete(runId: string): Promise<boolean> {
	const rows = await db
		.select({
			runStepStatus: runStep.status,
			isRequired: sql<boolean>`COALESCE(s.is_required, false)`,
		})
		.from(runStep)
		.leftJoin(sql`step AS s`, sql`s.id = ${runStep.stepId}`)
		.where(eq(runStep.runId, runId));
	if (rows.length === 0) return false;
	const requiredRows = rows.filter((r) => r.isRequired === true);
	if (requiredRows.length === 0) return false;
	return requiredRows.every((r) => r.runStepStatus === "completed");
}

/**
 * Mark a run completed, but only if it's still `active`. Returns `true` when the row
 * was actually transitioned, `false` when it was already completed/archived.
 *
 * The `WHERE status = 'active'` clause closes the cascade race condition (G3 in the
 * code-review plan): two concurrent "complete the last step" calls can both observe
 * `areAllRequiredRunStepsComplete === true`, but only the one whose UPDATE acquires
 * the row first will see `status='active'` to update — the other UPDATE matches zero
 * rows. Callers use the boolean return to decide whether to write the cascade audit
 * row, so the audit log can't contain duplicates.
 */
export async function markRunCompleted(
	runId: string,
	executor: DbExecutor = db,
): Promise<boolean> {
	const result = await executor
		.update(run)
		.set({ status: "completed", completedAt: new Date() })
		.where(and(eq(run.id, runId), eq(run.status, "active")))
		.returning({ id: run.id });
	return result.length > 0;
}

// ---------------------------------------------------------------------------
// Append-only writes (Invariant #6)
// ---------------------------------------------------------------------------

export async function writeAuditAndActivity(
	input: {
		organizationId: string;
		/** `null` when the actor is a guest participant (no Better Auth user). For guest
		 * actions, encode the participantId in `metadata` so the row is still attributable. */
		actorUserId: string | null;
		action: string; // for audit_log
		verb: string; // for activity_event
		entityType:
			| "workflow"
			| "workflow_version"
			| "section"
			| "step"
			| "field"
			| "run"
			| "run_step"
			| "field_value"
			| "suggestion"
			| "automation_rule"
			| "version_approval"
			| "acknowledgment"
			| "template_listing"
			| "template_listing_version"
			| "solution_pack"
			| "pack_version"
			| "field_definition"
			| "role";
		entityId: string;
		changes?: Record<string, unknown>;
		metadata?: Record<string, unknown>;
		activityData?: Record<string, unknown>;
	},
	executor: DbExecutor = db,
): Promise<void> {
	await Promise.all([
		executor.insert(auditLog).values({
			organizationId: input.organizationId,
			actorUserId: input.actorUserId,
			action: input.action,
			entityType: input.entityType,
			entityId: input.entityId,
			changes: input.changes,
			metadata: input.metadata,
		}),
		executor.insert(activityEvent).values({
			organizationId: input.organizationId,
			actorUserId: input.actorUserId,
			verb: input.verb,
			entityType: input.entityType,
			entityId: input.entityId,
			data: input.activityData,
		}),
	]);
}

// ---------------------------------------------------------------------------
// Tasks + dashboard reads (for listMyTasks + getHomeSummary)
// ---------------------------------------------------------------------------

export interface MyTaskRow {
	runStepId: string;
	stepTitle: string;
	stepDescription: string | null;
	status: "pending" | "completed" | "skipped" | "not_applicable";
	dueAt: Date | null;
	runId: string;
	runTitle: string;
	runStatus: "active" | "completed" | "archived";
	workflowId: string;
	workflowTitle: string;
	/** True iff any `step_dependency` for this task's definition step has a runStep on the
	 * same run that isn't `completed`. Cheap up-front computation so My Work can render
	 * the Lock affordance without round-tripping each row through getRun. */
	blocked: boolean;
}

/** All runSteps assigned to a user within this org. Filters by org via the parent run.
 * Direct assignment only (`run_step_assignee` -> `participant.user_id`); role->participant
 * fanout was already materialized at launch time.
 *
 * Per-row `blocked` flag is computed in 2 batched follow-up queries (no N+1):
 *   1. step_dependency rows for the result set's definition stepIds
 *   2. run_step.status for (runId, dependsOnStepId) pairs
 * Total: 3 queries for the whole listing. */
export async function listAssignedTasksForUser(input: {
	organizationId: string;
	userId: string;
	status?: "pending" | "completed";
	dueBefore?: Date;
	limit?: number;
	offset?: number;
}): Promise<MyTaskRow[]> {
	const limit = input.limit ?? 50;
	const offset = input.offset ?? 0;
	const conds = [
		eq(run.organizationId, input.organizationId),
		eq(participant.userId, input.userId),
	];
	if (input.status) conds.push(eq(runStep.status, input.status));
	if (input.dueBefore) conds.push(lte(runStep.dueAt, input.dueBefore));

	// Query 1: tasks (with internal `definitionStepId` for the dependency join).
	const rawRows = await db
		.select({
			runStepId: runStep.id,
			definitionStepId: runStep.stepId,
			stepTitle: runStep.title,
			stepDescription: runStep.description,
			status: runStep.status,
			dueAt: runStep.dueAt,
			runId: run.id,
			runTitle: run.title,
			runStatus: run.status,
			workflowId: workflow.id,
			workflowTitle: workflow.title,
		})
		.from(runStep)
		.innerJoin(run, eq(run.id, runStep.runId))
		.innerJoin(workflow, eq(workflow.id, run.workflowId))
		.innerJoin(runStepAssignee, eq(runStepAssignee.runStepId, runStep.id))
		.innerJoin(participant, eq(participant.id, runStepAssignee.participantId))
		.where(and(...conds))
		.orderBy(runStep.dueAt, runStep.id)
		.limit(limit)
		.offset(offset);

	if (rawRows.length === 0) return [];

	// Query 2: step_dependency rows scoped to our definition stepIds.
	const taskDefStepIds = [
		...new Set(rawRows.map((r) => r.definitionStepId).filter((id): id is string => id !== null)),
	];
	const deps = taskDefStepIds.length
		? await db
				.select({
					stepId: stepDependency.stepId,
					dependsOnStepId: stepDependency.dependsOnStepId,
				})
				.from(stepDependency)
				.where(inArray(stepDependency.stepId, taskDefStepIds))
		: [];
	const depStepIdsByTaskStepId = new Map<string, string[]>();
	const allDependeeStepIds = new Set<string>();
	for (const d of deps) {
		const arr = depStepIdsByTaskStepId.get(d.stepId) ?? [];
		arr.push(d.dependsOnStepId);
		depStepIdsByTaskStepId.set(d.stepId, arr);
		allDependeeStepIds.add(d.dependsOnStepId);
	}

	// Query 3: status of every dependee runStep on the runs we're inspecting.
	const runIds = [...new Set(rawRows.map((r) => r.runId))];
	const dependeeStatuses =
		allDependeeStepIds.size > 0 && runIds.length > 0
			? await db
					.select({
						runId: runStep.runId,
						stepId: runStep.stepId,
						status: runStep.status,
					})
					.from(runStep)
					.where(
						and(
							inArray(runStep.runId, runIds),
							inArray(runStep.stepId, [...allDependeeStepIds]),
						),
					)
			: [];
	const statusByRunAndStep = new Map<string, string>();
	for (const r of dependeeStatuses) {
		if (r.stepId) statusByRunAndStep.set(`${r.runId}::${r.stepId}`, r.status);
	}

	return rawRows.map((r) => {
		const ownDeps = r.definitionStepId ? (depStepIdsByTaskStepId.get(r.definitionStepId) ?? []) : [];
		const blocked = ownDeps.some(
			(dependsOnStepId) =>
				statusByRunAndStep.get(`${r.runId}::${dependsOnStepId}`) !== "completed",
		);
		return {
			runStepId: r.runStepId,
			stepTitle: r.stepTitle,
			stepDescription: r.stepDescription,
			status: r.status,
			dueAt: r.dueAt,
			runId: r.runId,
			runTitle: r.runTitle,
			runStatus: r.runStatus,
			workflowId: r.workflowId,
			workflowTitle: r.workflowTitle,
			blocked,
		};
	});
}

export interface ActiveRunRow {
	id: string;
	title: string;
	status: "active";
	startedAt: Date;
	dueAt: Date | null;
	workflowId: string;
	workflowTitle: string;
	workflowType: "procedure" | "document" | "policy" | "form";
	totalSteps: number;
	completedSteps: number;
}

/** Active runs in this org with per-run progress counts. Single GROUP BY query: one row
 * per active run, with `totalSteps` and `completedSteps` aggregated from `run_step`. Used
 * by the Home dashboard's right-rail "Active runs" column. Ordered by `startedAt` desc
 * (most recent first). */
export async function listActiveRunsWithProgress(input: {
	organizationId: string;
	limit?: number;
	offset?: number;
}): Promise<ActiveRunRow[]> {
	const limit = input.limit ?? 20;
	const offset = input.offset ?? 0;

	const rows = await db
		.select({
			id: run.id,
			title: run.title,
			status: run.status,
			startedAt: run.startedAt,
			dueAt: run.dueAt,
			workflowId: workflow.id,
			workflowTitle: workflow.title,
			workflowType: workflow.type,
			totalSteps: sql<number>`count(${runStep.id})::int`.as("total_steps"),
			completedSteps:
				sql<number>`count(${runStep.id}) filter (where ${runStep.status} = 'completed')::int`.as(
					"completed_steps",
				),
		})
		.from(run)
		.innerJoin(workflow, eq(workflow.id, run.workflowId))
		.leftJoin(runStep, eq(runStep.runId, run.id))
		.where(and(eq(run.organizationId, input.organizationId), eq(run.status, "active")))
		.groupBy(run.id, workflow.id)
		.orderBy(desc(run.startedAt))
		.limit(limit)
		.offset(offset);

	return rows.map((r) => ({
		id: r.id,
		title: r.title,
		status: "active" as const,
		startedAt: r.startedAt,
		dueAt: r.dueAt,
		workflowId: r.workflowId,
		workflowTitle: r.workflowTitle,
		workflowType: r.workflowType,
		totalSteps: r.totalSteps,
		completedSteps: r.completedSteps,
	}));
}

/** Counts for the home dashboard, scoped to the active org + user. */
export async function getHomeCountsForUser(input: {
	organizationId: string;
	userId: string;
	now: Date;
}): Promise<{
	openTasksCount: number;
	dueTodayCount: number;
	overdueCount: number;
	activeRunsCount: number;
}> {
	const startOfDay = new Date(input.now);
	startOfDay.setHours(0, 0, 0, 0);
	const startOfTomorrow = new Date(startOfDay);
	startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);

	// H6: single round-trip with SQL-side aggregation. The previous implementation
	// fetched every pending task row for the user just to count three categories in
	// JS — wasteful at any non-trivial org size. Now: one COUNT(*) FILTER per bucket
	// across a single join, plus a parallel COUNT for active runs.
	const [taskCountsRow, activeRunsRow] = await Promise.all([
		db
			.select({
				openTasks: sql<number>`COUNT(*)::int`,
				dueToday: sql<number>`COUNT(*) FILTER (
					WHERE ${runStep.dueAt} >= ${startOfDay}
					  AND ${runStep.dueAt} < ${startOfTomorrow}
				)::int`,
				overdue: sql<number>`COUNT(*) FILTER (
					WHERE ${runStep.dueAt} < ${startOfDay}
				)::int`,
			})
			.from(runStep)
			.innerJoin(run, eq(run.id, runStep.runId))
			.innerJoin(runStepAssignee, eq(runStepAssignee.runStepId, runStep.id))
			.innerJoin(participant, eq(participant.id, runStepAssignee.participantId))
			.where(
				and(
					eq(run.organizationId, input.organizationId),
					eq(participant.userId, input.userId),
					eq(runStep.status, "pending"),
				),
			)
			.then((rows) => rows[0] ?? { openTasks: 0, dueToday: 0, overdue: 0 }),
		db
			.select({ count: sql<number>`COUNT(*)::int` })
			.from(run)
			.where(and(eq(run.organizationId, input.organizationId), eq(run.status, "active")))
			.then((rows) => rows[0] ?? { count: 0 }),
	]);

	return {
		openTasksCount: Number(taskCountsRow.openTasks),
		dueTodayCount: Number(taskCountsRow.dueToday),
		overdueCount: Number(taskCountsRow.overdue),
		activeRunsCount: Number(activeRunsRow.count),
	};
}

// ---------------------------------------------------------------------------
// Field-value validation (parallels validateSettingValue in queries/config.ts)
// ---------------------------------------------------------------------------

/** Build a Zod schema from a field's fieldType + config, then parse `value`. Throws
 * ZodError on failure. */
export function validateFieldValue(
	fieldRow: { fieldType: FieldType; config: Record<string, unknown> | null; isRequired: boolean },
	value: unknown,
): unknown {
	// If the value is null/undefined, treat as "unset". Caller decides whether absence is
	// allowed (completeStep checks isRequired on its own).
	if (value === null || value === undefined) return value;
	const cfg = fieldRow.config ?? {};
	const schema = buildFieldZod(fieldRow.fieldType, cfg);
	return schema.parse(value);
}

function buildFieldZod(type: FieldType, cfg: Record<string, unknown>): z.ZodTypeAny {
	switch (type) {
		case "text": {
			let s = z.string();
			if (typeof cfg.minLength === "number") s = s.min(cfg.minLength);
			if (typeof cfg.maxLength === "number") s = s.max(cfg.maxLength);
			if (typeof cfg.pattern === "string") s = s.regex(new RegExp(cfg.pattern));
			return s;
		}
		case "textarea": {
			let s = z.string();
			if (typeof cfg.maxLength === "number") s = s.max(cfg.maxLength);
			return s;
		}
		case "number": {
			let n = z.number();
			if (typeof cfg.min === "number") n = n.min(cfg.min);
			if (typeof cfg.max === "number") n = n.max(cfg.max);
			if (cfg.int === true) n = n.int();
			return n;
		}
		case "date":
			// Accept ISO 8601 string; downstream serializes to TIMESTAMPTZ.
			return z.string().refine((v) => !Number.isNaN(new Date(v).getTime()), {
				message: "must be a valid ISO 8601 date string",
			});
		case "select": {
			const options = Array.isArray(cfg.options) ? (cfg.options as string[]) : [];
			return options.length > 0 ? z.enum(options as [string, ...string[]]) : z.string();
		}
		case "multiselect": {
			const options = Array.isArray(cfg.options) ? (cfg.options as string[]) : [];
			return options.length > 0
				? z.array(z.enum(options as [string, ...string[]]))
				: z.array(z.string());
		}
		case "file":
		case "image":
		case "signature":
			// Storage references -- the actual upload pipeline writes the object key here.
			return z.object({
				key: z.string().min(1),
				size: z.number().int().nonnegative().optional(),
				contentType: z.string().optional(),
			});
		case "member":
			// userId reference; existence is validated separately if/when needed.
			return z.string().min(1);
		case "lookup":
			// Reserved -- data_set integration deferred per BUILD_PLAN.md Batch 7.
			return z.unknown();
		default: {
			const exhaustive: never = type;
			throw new Error(`Unknown field type: ${String(exhaustive)}`);
		}
	}
}

