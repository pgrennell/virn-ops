// packages/api/modules/runs/lib/complete-step.ts
//
// Mark a runStep complete, refusing on:
//   - Required field unfilled (any `field.isRequired = true` for this step missing a
//     non-null `field_value` row).
//   - Stop-task blocked (any step_dependency where the dependee step isn't completed
//     for this run).
//
// Access: assignee (via run_step_assignee -> participant.userId) OR org admin/owner.
// Per Phase 3 product decision #1, admins can unblock by completing any step.
//
// Side effects on success:
//   - run_step.status = "completed", completedAt, completedBy
//   - audit_log row (action = "run_step.completed", changes = before/after status)
//   - activity_event row (verb = "completed")
//   - Cascade: if every required runStep in the run is now completed, mark run completed
//     and emit a second audit + activity pair for the run-level transition.

import {
	areAllRequiredRunStepsComplete,
	findIncompleteStopDependencies,
	getFieldValuesForRun,
	getRequiredFieldsForStep,
	getRunStepWithRun,
	markRunCompleted,
	markRunStepCompleted,
	writeAuditAndActivity,
} from "@virn/database";

import { RunEngineError } from "./errors";

export interface CompleteStepContext {
	organizationId: string;
	userId: string;
	/** True when the caller is an admin/owner of the active org; bypasses the assignee
	 * check. (See product decision #1 in the Phase 3 plan.) */
	isAdminOrOwner: boolean;
}

export interface CompleteStepResult {
	runStepId: string;
	runCompleted: boolean;
}

export async function completeRunStep(
	ctx: CompleteStepContext,
	runStepId: string,
): Promise<CompleteStepResult> {
	const rs = await getRunStepWithRun(ctx.organizationId, runStepId);
	if (!rs) {
		throw new RunEngineError("RUN_STEP_NOT_FOUND", "Run step not found in this organization.", {
			runStepId,
		});
	}
	if (rs.status === "completed") {
		throw new RunEngineError(
			"RUN_STEP_ALREADY_COMPLETED",
			"Run step is already marked complete.",
			{ runStepId },
		);
	}

	// Access: assignee OR admin/owner.
	if (!ctx.isAdminOrOwner) {
		const isAssignee = rs.assignees.some(
			(a) => a.participant.userId === ctx.userId,
		);
		if (!isAssignee) {
			throw new RunEngineError(
				"RUN_STEP_ACCESS_DENIED",
				"You are not assigned to this run step.",
				{ runStepId },
			);
		}
	}

	// Refusal #1: required fields. Only step-scoped fields (not kickoff) participate here;
	// kickoff required fields were enforced at launch time.
	if (rs.stepId) {
		const required = await getRequiredFieldsForStep(rs.stepId);
		if (required.length > 0) {
			const requiredIds = required.map((r) => r.id);
			const present = await getFieldValuesForRun(rs.run.id, requiredIds);
			const filledIds = new Set(
				present
					.filter((p) => p.value !== null && p.value !== undefined)
					.map((p) => p.fieldId)
					.filter((id): id is string => id !== null),
			);
			const missing = required.filter((r) => !filledIds.has(r.id));
			if (missing.length > 0) {
				throw new RunEngineError(
					"REQUIRED_FIELD_UNFILLED",
					`Cannot complete: ${missing.length} required field(s) unfilled: ${missing.map((m) => m.key).join(", ")}.`,
					{ runStepId, missingFieldKeys: missing.map((m) => m.key) },
				);
			}
		}

		// Refusal #2: stop-task dependencies.
		const incomplete = await findIncompleteStopDependencies(rs.run.id, rs.stepId);
		if (incomplete.length > 0) {
			throw new RunEngineError(
				"STOP_TASK_BLOCKED",
				`Cannot complete: ${incomplete.length} dependency step(s) not yet completed.`,
				{ runStepId, incompleteDependencyStepIds: incomplete },
			);
		}
	}

	// Mark complete + emit append-only records.
	await markRunStepCompleted({ runStepId, completedBy: ctx.userId });
	await writeAuditAndActivity({
		organizationId: ctx.organizationId,
		actorUserId: ctx.userId,
		action: "run_step.completed",
		verb: "completed",
		entityType: "run_step",
		entityId: runStepId,
		changes: { fromStatus: rs.status, toStatus: "completed" },
		metadata: { runId: rs.run.id, workflowVersionId: rs.run.workflowVersionId },
		activityData: { stepTitle: rs.title },
	});

	// Cascade: if every required runStep is now completed, mark the run completed too.
	let runCompleted = false;
	if (rs.run.status === "active") {
		const allDone = await areAllRequiredRunStepsComplete(rs.run.id);
		if (allDone) {
			await markRunCompleted(rs.run.id);
			await writeAuditAndActivity({
				organizationId: ctx.organizationId,
				actorUserId: ctx.userId,
				action: "run.completed",
				verb: "completed",
				entityType: "run",
				entityId: rs.run.id,
				changes: { fromStatus: "active", toStatus: "completed" },
				metadata: { triggeredByRunStepId: runStepId },
				activityData: { reason: "all required steps complete" },
			});
			runCompleted = true;
		}
	}

	return { runStepId, runCompleted };
}
