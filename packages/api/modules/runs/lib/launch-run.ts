// packages/api/modules/runs/lib/launch-run.ts
//
// The cornerstone of Phase 3: SNAPSHOT a published workflow_version into self-contained
// run + run_step + field_value rows. Per Invariants #3/#4, the run is fully runnable
// without reading back into the mutable template -- runStep.title/.description are
// copied by value; field_value.fieldId FKs the pinned version's field rows (immutable
// post-publish by convention).
//
// Side effects:
//   - One insert per row group (runs in a transaction; see queries/runs.ts insertRunSnapshot)
//   - One audit_log row (action="run.launched") + one activity_event (verb="launched")
//
// Deferred (per BUILD_PLAN.md Phase 3 defer list):
//   - due_type = "offset_from_step" / "from_date_field" -> dueAt resolves to null
//   - conditional visibility -> all steps materialize as runStep rows
//   - approval-typed steps -> treated like task for completion semantics
//   - automation rule firing -> Phase 6

import {
	getLatestPublishedWorkflowVersion,
	getVersionLaunchBundle,
	getWorkflowForOrg,
	getWorkflowVersionById,
	insertRunSnapshot,
	type RoleAssignmentInput,
	type SnapshotKickoffValue,
	type SnapshotParticipantRow,
	type SnapshotRoleAssignmentRow,
	type SnapshotStepAssignmentRow,
	type SnapshotStepRow,
	validateFieldValue,
	writeAuditAndActivity,
} from "@virn/database";

import { RunEngineError } from "./errors";

export interface LaunchRunInput {
	workflowId: string;
	/** Optional pinned version. Defaults to the latest published version of the workflow. */
	workflowVersionId?: string;
	/** Map of `field.key` -> value for launch-level (stepId IS NULL) fields. Values are
	 * validated against the field's config via validateFieldValue; required kickoff fields
	 * without a value cause a REQUIRED_KICKOFF_FIELD_MISSING error. */
	kickoffValues: Record<string, unknown>;
	/** Resolves each workflow_role to a participant (user OR guest). May omit roles not
	 * yet known; matching steps simply launch unassigned. */
	roleAssignments: RoleAssignmentInput[];
	/** Optional override for the run's display title. Defaults to the workflow's title. */
	title?: string;
}

export interface LaunchRunContext {
	organizationId: string;
	userId: string;
}

export interface LaunchRunResult {
	runId: string;
}

export async function launchRun(
	ctx: LaunchRunContext,
	input: LaunchRunInput,
): Promise<LaunchRunResult> {
	// 1. Workflow scoped to org (Invariant #1).
	const workflow = await getWorkflowForOrg(ctx.organizationId, input.workflowId);
	if (!workflow) {
		throw new RunEngineError("WORKFLOW_NOT_FOUND", "Workflow not found in this organization.", {
			workflowId: input.workflowId,
		});
	}

	// 2. Resolve version: explicit (must be published + belong to this workflow) or latest published.
	let version;
	if (input.workflowVersionId) {
		version = await getWorkflowVersionById(input.workflowVersionId);
		if (!version || version.workflowId !== workflow.id) {
			throw new RunEngineError("VERSION_NOT_FOUND", "Workflow version not found.", {
				workflowVersionId: input.workflowVersionId,
			});
		}
		if (version.status !== "published") {
			throw new RunEngineError(
				"VERSION_NOT_PUBLISHED",
				`Cannot launch from a ${version.status} version.`,
				{ workflowVersionId: version.id, status: version.status },
			);
		}
	} else {
		version = await getLatestPublishedWorkflowVersion(workflow.id);
		if (!version) {
			throw new RunEngineError(
				"NO_PUBLISHED_VERSION",
				"Workflow has no published versions to launch.",
				{ workflowId: workflow.id },
			);
		}
	}

	// 3. Pull bundle (steps, fields, deps).
	const { steps, fields } = await getVersionLaunchBundle(version.id);

	// 4. Validate role assignments: each must be user-only OR guest-only.
	for (const ra of input.roleAssignments) {
		const hasUser = !!ra.userId;
		const hasGuest = !!ra.guestEmail;
		if (hasUser === hasGuest) {
			throw new RunEngineError(
				"INVALID_ROLE_ASSIGNMENT",
				`Role assignment must specify exactly one of userId or guestEmail (roleId: ${ra.roleId}).`,
				{ roleId: ra.roleId },
			);
		}
	}

	// 5. Kickoff fields: validate each provided value; refuse if a required kickoff field is missing.
	const kickoffFields = fields.filter((f) => f.stepId === null);
	const kickoffByKey = new Map(kickoffFields.map((f) => [f.key, f] as const));
	const kickoffValuesNorm: SnapshotKickoffValue[] = [];
	for (const [key, raw] of Object.entries(input.kickoffValues)) {
		const f = kickoffByKey.get(key);
		if (!f) {
			throw new RunEngineError(
				"UNKNOWN_FIELD_KEY",
				`Kickoff value references unknown field key "${key}".`,
				{ key },
			);
		}
		let validated: unknown;
		try {
			validated = validateFieldValue(
				{ fieldType: f.fieldType, config: f.config as Record<string, unknown> | null, isRequired: f.isRequired },
				raw,
			);
		} catch (err) {
			throw new RunEngineError(
				"FIELD_VALUE_INVALID",
				`Kickoff value for "${key}" failed validation: ${err instanceof Error ? err.message : String(err)}`,
				{ key },
			);
		}
		kickoffValuesNorm.push({ fieldId: f.id, value: validated });
	}
	// Required-kickoff defense (server-side parity with UI form validation).
	const providedKeys = new Set(Object.keys(input.kickoffValues));
	for (const f of kickoffFields) {
		if (f.isRequired && !providedKeys.has(f.key)) {
			throw new RunEngineError(
				"REQUIRED_KICKOFF_FIELD_MISSING",
				`Required kickoff field "${f.key}" was not provided.`,
				{ key: f.key, fieldId: f.id },
			);
		}
	}

	// 6. Compute run.startedAt and per-step dueAt.
	const startedAt = new Date();
	const snapshotSteps: SnapshotStepRow[] = steps.map((s) => ({
		stepId: s.id,
		title: s.title,
		description: s.description,
		position: s.position,
		assignedRoleId: s.assignedRoleId,
		dueAt: computeStepDueAt(startedAt, s.dueType, s.dueOffsetDays),
	}));

	// 7. Build participant + role-assignment + step-assignee plans.
	const participants: SnapshotParticipantRow[] = input.roleAssignments.map((ra, i) => ({
		tempKey: `p_${i}`,
		userId: ra.userId ?? null,
		guestEmail: ra.guestEmail ?? null,
		guestName: ra.guestName ?? null,
	}));
	const tempKeyByRoleId = new Map<string, string>();
	for (let i = 0; i < input.roleAssignments.length; i++) {
		tempKeyByRoleId.set(input.roleAssignments[i].roleId, `p_${i}`);
	}
	const roleAssignmentRows: SnapshotRoleAssignmentRow[] = input.roleAssignments.map((ra) => ({
		roleId: ra.roleId,
		participantTempKey: tempKeyByRoleId.get(ra.roleId) ?? "",
	}));
	const stepAssignmentRows: SnapshotStepAssignmentRow[] = [];
	for (const s of steps) {
		if (s.assignedRoleId && tempKeyByRoleId.has(s.assignedRoleId)) {
			stepAssignmentRows.push({
				stepId: s.id,
				participantTempKey: tempKeyByRoleId.get(s.assignedRoleId) ?? "",
			});
		}
	}

	// 8. Snapshot insert (transactional).
	const { runId } = await insertRunSnapshot({
		organizationId: ctx.organizationId,
		workflowId: workflow.id,
		workflowVersionId: version.id,
		title: input.title ?? workflow.title,
		createdBy: ctx.userId,
		startedAt,
		runDueAt: null, // top-level run due is currently not modeled; per-step due is the source
		steps: snapshotSteps,
		kickoffValues: kickoffValuesNorm,
		participants,
		roleAssignments: roleAssignmentRows,
		stepAssignments: stepAssignmentRows,
	});

	// 9. Append-only writes (Invariant #6).
	await writeAuditAndActivity({
		organizationId: ctx.organizationId,
		actorUserId: ctx.userId,
		action: "run.launched",
		verb: "launched",
		entityType: "run",
		entityId: runId,
		changes: {
			workflowId: workflow.id,
			workflowVersionId: version.id,
			stepCount: snapshotSteps.length,
			kickoffValueCount: kickoffValuesNorm.length,
		},
		metadata: { source: "manual" },
		activityData: { runTitle: input.title ?? workflow.title, workflowTitle: workflow.title },
	});

	return { runId };
}

/** Compute per-step due timestamp from a step's due-config. Only `none` and
 * `offset_from_start` are honored; `offset_from_step` and `from_date_field` resolve to null
 * (TODO Phase 3.x: implement once the dependee step's dueAt is known and date-field reads
 * are wired). */
export function computeStepDueAt(
	runStartedAt: Date,
	dueType: "none" | "offset_from_start" | "offset_from_step" | "from_date_field",
	dueOffsetDays: number | null,
): Date | null {
	if (dueType === "offset_from_start" && typeof dueOffsetDays === "number") {
		const d = new Date(runStartedAt);
		d.setDate(d.getDate() + dueOffsetDays);
		return d;
	}
	return null;
}
