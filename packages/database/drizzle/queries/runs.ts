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
	step,
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
	/** Vendor role assignment (ADR-007 + D-023). When set, both vendorId AND
	 * vendorContactId must be populated together — the participant CHECK refuses a
	 * vendor row missing either. launchRun validates the vendor+contact exist in
	 * the org before snapshotting. Mutually exclusive with userId / guestEmail per
	 * the launchRun validator. */
	vendorId?: string | null;
	vendorContactId?: string | null;
}

// Definition reads -- moved to queries/workflows.ts (getWorkflowForOrg,
// getLatestPublishedWorkflowVersion, getWorkflowVersionById, getVersionLaunchBundle).
// Re-exported through queries/index.ts so launchRun's import path is unchanged.

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
	/** Discriminator (ADR-006 + D-022 agent; ADR-007 + D-023 vendor). The corresponding
	 * identity FK(s) below must match -- the participant CHECK constraint enforces this
	 * at the DB level. For kind='vendor' BOTH vendorId AND vendorContactId are required;
	 * for other kinds they're null. */
	kind: "user" | "guest" | "agent" | "vendor";
	userId: string | null;
	guestEmail: string | null;
	guestName: string | null;
	agentId: string | null;
	vendorId: string | null;
	vendorContactId: string | null;
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
 * assignees in a single transaction. Returns the new runId, the inserted runStep ids keyed
 * by definition stepId, AND the inserted participant ids keyed by caller-assigned tempKey
 * (Phase 11a.2 -- launchRun uses the latter to attribute the launch-audit row to the
 * launching agent's participant when an agent calls the action surface). */
export async function insertRunSnapshot(input: {
	organizationId: string;
	workflowId: string;
	workflowVersionId: string;
	title: string;
	/** Nullable so agent-launched runs (Phase 11a.2) can carry `null` -- the agent
	 * identity is recorded in the audit row, not in run.createdBy. */
	createdBy: string | null;
	startedAt: Date;
	runDueAt: Date | null;
	steps: SnapshotStepRow[];
	kickoffValues: SnapshotKickoffValue[];
	participants: SnapshotParticipantRow[];
	roleAssignments: SnapshotRoleAssignmentRow[];
	stepAssignments: SnapshotStepAssignmentRow[];
}): Promise<{
	runId: string;
	runStepIdByStepId: Map<string, string>;
	participantIdByTempKey: Map<string, string>;
}> {
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
						kind: p.kind,
						userId: p.userId,
						guestEmail: p.guestEmail,
						guestName: p.guestName,
						agentId: p.agentId,
						vendorId: p.vendorId,
						vendorContactId: p.vendorContactId,
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

		return { runId, runStepIdByStepId, participantIdByTempKey };
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
								participant: {
									with: {
										agent: true,
										vendor: true,
										vendorContact: true,
									},
								},
							},
						},
					},
				},
				values: true,
				participants: {
					with: {
						agent: true,
						vendor: true,
						vendorContact: true,
					},
				},
				roleAssignments: true,
			},
		})) ?? null
	);
}

// ---------------------------------------------------------------------------
// SLA sweep — find overdue active runs that haven't been escalated yet
// (Phase 8 step 5, the property-ops pack's overdue-escalation use case).
//
// Idempotency is enforced via the audit_log: a run is "already escalated" iff it has
// an audit row with action='run.escalated' + entityType='run' + entityId=<run.id>.
// No new schema needed; the audit_log indexes (idx_audit_log_entity on entity_type +
// entity_id, idx_audit_log_org) make the antijoin cheap.
// ---------------------------------------------------------------------------

export interface OverdueRunRow {
	id: string;
	organizationId: string;
	title: string;
	workflowId: string;
	dueAt: Date;
	startedAt: Date;
	createdBy: string | null;
}

/** Find active runs whose `dueAt` has passed and which DO NOT yet have a
 * `run.escalated` audit event. Antijoin against audit_log keys idempotency: callers
 * can run this every hour without re-firing escalation for runs already escalated.
 *
 * Scope:
 *   - `organizationId === null` -> platform-wide sweep (Vercel Cron variant)
 *   - `organizationId` set       -> single-org sweep (admin "Run sweep now" button)
 *
 * Returns the rows the caller should escalate. The caller is responsible for writing
 * the escalation audit row + side effects (notifications, automation actions); those
 * writes flip the antijoin so the next sweep skips the same runs.
 *
 * Note (Phase 18 successor): once the full automation_action executor lands, this
 * sweep migrates to an Inngest scheduled function that emits an SLA-breach event;
 * automation_rule.triggerType='sla_breach' rules then handle the escalation actions
 * through the catalog. For v1 the sweep + thin escalation is sufficient. */
export async function findOverdueRunsToEscalate(
	organizationId: string | null,
	now: Date = new Date(),
): Promise<OverdueRunRow[]> {
	// Subquery: run ids that already have a run.escalated audit row. We use a NOT IN
	// (sub-select) against audit_log scoped to action='run.escalated' + entity_type='run'.
	// The audit_log entity index makes this fast; the result set is small (overdue
	// runs only, then narrowed to the not-already-escalated ones).
	const escalatedSubquery = sql<string>`(
		select ${auditLog.entityId}
		from ${auditLog}
		where ${auditLog.action} = 'run.escalated'
		  and ${auditLog.entityType} = 'run'
	)`;

	const baseWhere = and(
		eq(run.status, "active"),
		lte(run.dueAt, now),
		sql`${run.id} NOT IN ${escalatedSubquery}`,
	);
	const where = organizationId
		? and(baseWhere, eq(run.organizationId, organizationId))
		: baseWhere;

	const rows = await db
		.select({
			id: run.id,
			organizationId: run.organizationId,
			title: run.title,
			workflowId: run.workflowId,
			dueAt: run.dueAt,
			startedAt: run.startedAt,
			createdBy: run.createdBy,
		})
		.from(run)
		.where(where)
		.orderBy(run.dueAt);

	// Type narrowing: dueAt is filtered to non-null via the lte() clause but the
	// schema declares it nullable. Cast away the null type here -- safe because the
	// WHERE filtered it.
	return rows.map((r) => ({
		id: r.id,
		organizationId: r.organizationId,
		title: r.title,
		workflowId: r.workflowId,
		dueAt: r.dueAt as Date,
		startedAt: r.startedAt,
		createdBy: r.createdBy,
	}));
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

// ---------------------------------------------------------------------------
// dueAt recompute (post step completion -- offset_from_step + from_date_field)
// ---------------------------------------------------------------------------

/** Shape returned by `findDueRecomputeTargets`. The four `due*` columns mirror the
 * shape `computeStepDueAt` expects so callers can hand them straight through. */
export interface DueRecomputeTarget {
	runStepId: string;
	stepId: string;
	dueType: "offset_from_step" | "from_date_field";
	dueOffsetDays: number | null;
	dueAnchorStepId: string | null;
	dueSourceFieldId: string | null;
}

/** Find unresolved runSteps in `runId` whose definition step depends on EITHER
 * `completedStepId` (via `dueType='offset_from_step'`) OR any field in
 * `sourceFieldIds` (via `dueType='from_date_field'`). "Unresolved" = `runStep.dueAt
 * IS NULL` AND `status != 'completed'` -- we only patch deadlines that were
 * deferred at launch, never overwrite a resolved one (preserves the invariant
 * that a non-null dueAt is sticky once set). */
export async function findDueRecomputeTargets(
	args: {
		runId: string;
		completedStepId: string | null;
		sourceFieldIds: string[];
	},
	executor: DbExecutor = db,
): Promise<DueRecomputeTarget[]> {
	const orParts: ReturnType<typeof and>[] = [];
	if (args.completedStepId) {
		orParts.push(
			and(
				eq(step.dueType, "offset_from_step"),
				eq(step.dueAnchorStepId, args.completedStepId),
			),
		);
	}
	if (args.sourceFieldIds.length > 0) {
		orParts.push(
			and(
				eq(step.dueType, "from_date_field"),
				inArray(step.dueSourceFieldId, args.sourceFieldIds),
			),
		);
	}
	if (orParts.length === 0) return [];
	const rows = await executor
		.select({
			runStepId: runStep.id,
			stepId: step.id,
			dueType: step.dueType,
			dueOffsetDays: step.dueOffsetDays,
			dueAnchorStepId: step.dueAnchorStepId,
			dueSourceFieldId: step.dueSourceFieldId,
		})
		.from(runStep)
		.innerJoin(step, eq(step.id, runStep.stepId))
		.where(
			and(
				eq(runStep.runId, args.runId),
				sql`${runStep.dueAt} IS NULL`,
				sql`${runStep.status} != 'completed'`,
				orParts.length === 1 ? orParts[0]! : sql`(${orParts[0]} OR ${orParts[1]})`,
			),
		);
	return rows
		.filter(
			(r): r is DueRecomputeTarget =>
				r.dueType === "offset_from_step" || r.dueType === "from_date_field",
		)
		.map((r) => ({
			runStepId: r.runStepId,
			stepId: r.stepId,
			dueType: r.dueType,
			dueOffsetDays: r.dueOffsetDays,
			dueAnchorStepId: r.dueAnchorStepId,
			dueSourceFieldId: r.dueSourceFieldId,
		}));
}

/** Return all date fields belonging to definition step `stepId` with their current
 * values from `field_value` for the given run. Used by the recompute path to seed
 * `dateFieldValues` for from_date_field dependents whose source lives on the
 * just-completed step. Fields with no value (not yet filled) are still returned
 * with `value: null` so the caller can distinguish "no field of that id" from
 * "field exists but unfilled" -- the resolver treats both as "defer." */
export async function getDateFieldValuesForStepInRun(
	runId: string,
	stepId: string,
	executor: DbExecutor = db,
): Promise<Array<{ fieldId: string; fieldType: string; value: unknown }>> {
	const rows = await executor
		.select({
			fieldId: field.id,
			fieldType: field.fieldType,
			value: fieldValue.value,
		})
		.from(field)
		.leftJoin(
			fieldValue,
			and(eq(fieldValue.fieldId, field.id), eq(fieldValue.runId, runId)),
		)
		.where(and(eq(field.stepId, stepId), eq(field.fieldType, "date")));
	return rows.map((r) => ({
		fieldId: r.fieldId,
		fieldType: r.fieldType,
		value: r.value,
	}));
}

/** Patch a runStep's `dueAt`. Idempotent -- callers should only invoke when they
 * have a resolved (non-null) value; the recompute path skips no-op writes. */
export async function updateRunStepDueAt(
	args: { runStepId: string; dueAt: Date },
	executor: DbExecutor = db,
): Promise<void> {
	await executor
		.update(runStep)
		.set({ dueAt: args.dueAt })
		.where(eq(runStep.id, args.runStepId));
}

/** Mark a runStep completed. `completedBy` is nullable -- a guest participant has no
 * Better Auth user id; the actor's identity for guests is captured in audit/activity
 * metadata (participantId) instead. No-op if already completed (caller should check
 * first to avoid duplicate audit/activity writes).
 *
 * Returns the `completedAt` timestamp the row was set to -- the caller may need it
 * to seed the dueAt recompute for downstream offset_from_step dependents (so the
 * recompute uses the SAME timestamp the audit row records). */
export async function markRunStepCompleted(
	input: {
		runStepId: string;
		completedBy: string | null;
	},
	executor: DbExecutor = db,
): Promise<{ completedAt: Date }> {
	const completedAt = new Date();
	await executor
		.update(runStep)
		.set({
			status: "completed",
			completedAt,
			completedBy: input.completedBy,
		})
		.where(eq(runStep.id, input.runStepId));
	return { completedAt };
}

/** Count runSteps grouped by status for cascade-to-run-complete. Returns whether every
 * REQUIRED step (i.e. step.isRequired = true) is `completed`. Heading/optional steps don't
 * block run completion.
 *
 * Accepts an executor so callers inside a transaction can see their own uncommitted
 * writes -- before this took an executor, completeRunStep's cascade check ran on the
 * package-level `db` connection and could not observe the just-applied
 * `markRunStepCompleted(tx)` UPDATE, so the LAST step's completion never triggered the
 * cascade and the run silently stayed `active`. */
export async function areAllRequiredRunStepsComplete(
	runId: string,
	executor: DbExecutor = db,
): Promise<boolean> {
	const rows = await executor
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

/** Find the `participant` row for an agent on a specific run. Returns null if the agent
 * was never made a participant of this run (i.e. wasn't bound at launch). Phase 11a.1 uses
 * this to enforce that agents can only act on runs where they were explicitly assigned at
 * launch -- there is no "create on demand" pathway in 11a.1, matching the user-side
 * assignment model (you can't act on a run you aren't on). */
export async function findAgentParticipantForRun(input: {
	organizationId: string;
	runId: string;
	agentId: string;
}): Promise<{ id: string } | null> {
	const row = await db.query.participant.findFirst({
		where: (p, { and: andOp, eq: eqOp }) =>
			andOp(
				eqOp(p.organizationId, input.organizationId),
				eqOp(p.runId, input.runId),
				eqOp(p.agentId, input.agentId),
			),
		columns: { id: true },
	});
	return row ? { id: row.id } : null;
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
		/** Principal kind for audit/activity attribution. ADR-006 + D-022 (agent),
		 * ADR-007 + D-023 (vendor). Defaults to `'user'` so pre-Phase-11 call sites are
		 * unchanged; agent-aware / vendor-aware writers (Phase 11 action surface, mode-aware
		 * launcher, vendor portal) pass the explicit kind. */
		actorKind?: "user" | "guest" | "agent" | "vendor";
		/** Participant.id for `'guest'` / `'agent'` / `'vendor'` actors whose identity isn't
		 * in `user`. Nullable; populated by Phase 11 writers. */
		actorParticipantId?: string | null;
		/** Cross-product attribution (D-027, 2026-05-27 cross-repo). Free text — `'virn-pm'`,
		 * `'virn-ops'`, or a future third-party identifier. Populated when the write
		 * originated from an inbound cross-product webhook or sibling-product call through
		 * the action surface; `null` for local writes. */
		crossProductOrigin?: string | null;
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
			| "role"
			| "agent"
			| "vendor"
			| "vendor_contact"
			| "listing";
		entityId: string;
		changes?: Record<string, unknown>;
		metadata?: Record<string, unknown>;
		activityData?: Record<string, unknown>;
	},
	executor: DbExecutor = db,
): Promise<void> {
	const actorKind = input.actorKind ?? "user";
	const actorParticipantId = input.actorParticipantId ?? null;
	const crossProductOrigin = input.crossProductOrigin ?? null;
	await Promise.all([
		executor.insert(auditLog).values({
			organizationId: input.organizationId,
			actorKind,
			actorUserId: input.actorUserId,
			actorParticipantId,
			crossProductOrigin,
			action: input.action,
			entityType: input.entityType,
			entityId: input.entityId,
			changes: input.changes,
			metadata: input.metadata,
		}),
		executor.insert(activityEvent).values({
			organizationId: input.organizationId,
			actorKind,
			actorUserId: input.actorUserId,
			actorParticipantId,
			crossProductOrigin,
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

/** All runSteps assigned to a principal (user or agent) within this org. Filters by org
 * via the parent run. Direct assignment only (`run_step_assignee` -> `participant.userId`
 * or `participant.agentId`); role->participant fanout was already materialized at launch
 * time.
 *
 * Per-row `blocked` flag is computed in 2 batched follow-up queries (no N+1):
 *   1. step_dependency rows for the result set's definition stepIds
 *   2. run_step.status for (runId, dependsOnStepId) pairs
 * Total: 3 queries for the whole listing.
 *
 * Phase 11a.2: the principal discriminator gates whether the inner join filters on
 * `participant.userId` (user path) or `participant.agentId` (agent introspection -- the
 * Phase 11a action surface's `runs.listMyTasks` for an agent caller). Same row shape, same
 * indexes, same dep batching -- one column swap. */
export async function listAssignedTasksForPrincipal(input: {
	organizationId: string;
	principal: { kind: "user"; userId: string } | { kind: "agent"; agentId: string };
	status?: "pending" | "completed";
	dueBefore?: Date;
	limit?: number;
	offset?: number;
}): Promise<MyTaskRow[]> {
	const limit = input.limit ?? 50;
	const offset = input.offset ?? 0;
	const principalCond =
		input.principal.kind === "user"
			? eq(participant.userId, input.principal.userId)
			: eq(participant.agentId, input.principal.agentId);
	const conds = [eq(run.organizationId, input.organizationId), principalCond];
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

/** Back-compat thin wrapper over `listAssignedTasksForPrincipal` (user path). */
export async function listAssignedTasksForUser(input: {
	organizationId: string;
	userId: string;
	status?: "pending" | "completed";
	dueBefore?: Date;
	limit?: number;
	offset?: number;
}): Promise<MyTaskRow[]> {
	return listAssignedTasksForPrincipal({
		organizationId: input.organizationId,
		principal: { kind: "user", userId: input.userId },
		status: input.status,
		dueBefore: input.dueBefore,
		limit: input.limit,
		offset: input.offset,
	});
}

/** Phase 11a.2 -- agent introspection. The agent action surface calls this through the
 * dual-auth `runs.listMyTasks` procedure to see its own assignments. Returns the same row
 * shape as the user path so the same procedure can serve both principals. */
export async function listAssignedTasksForAgent(input: {
	organizationId: string;
	agentId: string;
	status?: "pending" | "completed";
	dueBefore?: Date;
	limit?: number;
	offset?: number;
}): Promise<MyTaskRow[]> {
	return listAssignedTasksForPrincipal({
		organizationId: input.organizationId,
		principal: { kind: "agent", agentId: input.agentId },
		status: input.status,
		dueBefore: input.dueBefore,
		limit: input.limit,
		offset: input.offset,
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

