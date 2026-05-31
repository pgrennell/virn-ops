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
	enqueueCrossProductEventForRun,
	findAgentParticipantForRun,
	findIncompleteStopDependencies,
	getFieldValuesForRun,
	getRequiredFieldsForStep,
	getRunStepWithRun,
	markRunCompleted,
	markRunStepCompleted,
	withTransaction,
	writeAuditAndActivity,
} from "@virn/database";

import { inngest } from "../../../inngest/client";
import { PLAYBOOK_LIFECYCLE_EVENTS } from "../../../inngest/events";
import { RunEngineError } from "./errors";
import { recomputeDueAtAfterStepCompletion } from "./launch-run";

export interface CompleteStepContext {
	organizationId: string;
	/** Better Auth user id of the calling user, when the call is internal. Mutually
	 * exclusive with `participantId` and `agentId`. Set to `undefined` for guest calls. */
	userId?: string;
	/** Participant id of the calling guest, when the call is via a verified
	 * participant_token. Mutually exclusive with `userId` and `agentId`. Guests are never
	 * admin/owner. */
	participantId?: string;
	/** Agent id when called via verified bearer credential (Phase 11a, ADR-006). Mutually
	 * exclusive with `userId` / `participantId`. Agents are never admin/owner and must be a
	 * pre-existing participant on the run (bound at launch). */
	agentId?: string;
	/** Cross-product origin (D-027). Populated when the calling agent's
	 * `agent.originProduct` is set (e.g. `'virn-pm'`). Threaded into both the step-complete
	 * audit row and any cascade run-complete audit row. */
	crossProductOrigin?: string | null;
	/** True when the caller is an admin/owner of the active org; bypasses the assignee
	 * check. (D-014.) Always `false` for guest and agent contexts. */
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
	// Defense-in-depth: once the run cascades to completed (or is archived), no further
	// step completions are accepted -- even on optional steps the cascade left behind. The
	// UI hides the Complete button in this case (RunStepPanel); the API enforces it too so
	// a direct curl can't bypass.
	if (rs.run.status !== "active") {
		throw new RunEngineError(
			"RUN_NOT_ACTIVE",
			`Cannot complete steps on a ${rs.run.status} run.`,
			{ runStepId, runId: rs.run.id, runStatus: rs.run.status },
		);
	}

	// Agent path: resolve the agent's participant row for this run BEFORE the assignee
	// check, so the same `participantId` flows into both the access decision and the
	// audit row. An agent that wasn't bound to this run at launch can't act on it --
	// Phase 11a.1 has no "create on demand" pathway (matches user-side semantics).
	let agentParticipantId: string | null = null;
	if (ctx.agentId) {
		const part = await findAgentParticipantForRun({
			organizationId: ctx.organizationId,
			runId: rs.run.id,
			agentId: ctx.agentId,
		});
		if (!part) {
			throw new RunEngineError(
				"RUN_STEP_ACCESS_DENIED",
				"This agent is not a participant of this run.",
				{ runStepId, agentId: ctx.agentId },
			);
		}
		agentParticipantId = part.id;
	}

	// Access: assignee OR admin/owner. Assignee can be matched by the calling user's
	// Better Auth id (internal), by participant id (guest via verified token), or by the
	// agent's participant row (Phase 11a action surface). Guests + agents never have
	// isAdminOrOwner = true.
	if (!ctx.isAdminOrOwner) {
		const isAssignee = rs.assignees.some((a) => {
			if (ctx.participantId && a.participant.id === ctx.participantId) return true;
			if (ctx.userId && a.participant.userId === ctx.userId) return true;
			if (agentParticipantId && a.participant.id === agentParticipantId) return true;
			return false;
		});
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
	// Refusal #2: stop-task dependencies.
	//
	// `getRequiredFieldsForStep` and `findIncompleteStopDependencies` are independent —
	// run them in parallel. `getFieldValuesForRun` depends on the required-field IDs and
	// is only needed when there are required fields, so it stays sequential.
	if (rs.stepId) {
		const [required, incomplete] = await Promise.all([
			getRequiredFieldsForStep(rs.stepId),
			findIncompleteStopDependencies(rs.run.id, rs.stepId),
		]);

		if (incomplete.length > 0) {
			throw new RunEngineError(
				"STOP_TASK_BLOCKED",
				`Cannot complete: ${incomplete.length} dependency step(s) not yet completed.`,
				{ runStepId, incompleteDependencyStepIds: incomplete },
			);
		}

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
	}

	// Actor attribution shared by both the step-complete write and the cascade write.
	const actorKind: "user" | "guest" | "agent" = ctx.agentId
		? "agent"
		: ctx.participantId
			? "guest"
			: "user";
	const actorParticipantId = ctx.participantId ?? agentParticipantId ?? null;

	// Atomic write: step-complete update + audit + activity must succeed or fail together.
	// The cascade (run-level completion) runs in the same transaction; `markRunCompleted`'s
	// `WHERE status = 'active'` clause + boolean return prevents duplicate cascade audits
	// when two concurrent calls both observe `areAllRequiredRunStepsComplete === true`.
	const runCompleted = await withTransaction(async (tx) => {
		const { completedAt } = await markRunStepCompleted(
			{ runStepId, completedBy: ctx.userId ?? null },
			tx,
		);

		// Phase 12.2 -- recompute dueAt for downstream dependents. Runs INSIDE the
		// step-complete transaction so a failure rolls back the whole completion
		// (preferable to "step recorded as done but its dependents still deferred
		// forever"). No-op when rs.stepId is null (orphan steps from a deleted
		// definition step, defensive). Safe to call before any cascade check: it
		// only touches unresolved dependents in this run, never the just-completed
		// row itself.
		if (rs.stepId) {
			await recomputeDueAtAfterStepCompletion(
				{ runId: rs.run.id, completedStepId: rs.stepId, completedAt },
				tx,
			);
		}

		await writeAuditAndActivity(
			{
				organizationId: ctx.organizationId,
				actorUserId: ctx.userId ?? null,
				actorKind,
				actorParticipantId,
				crossProductOrigin: ctx.crossProductOrigin ?? null,
				action: "run_step.completed",
				verb: "completed",
				entityType: "run_step",
				entityId: runStepId,
				changes: { fromStatus: rs.status, toStatus: "completed" },
				metadata: {
					runId: rs.run.id,
					workflowVersionId: rs.run.workflowVersionId,
					...(ctx.participantId ? { actorParticipantId: ctx.participantId } : {}),
					...(ctx.agentId ? { actorAgentId: ctx.agentId } : {}),
				},
				activityData: { stepTitle: rs.title },
			},
			tx,
		);

		// Cascade: only attempt if the run is still active at the time we entered.
		// `markRunCompleted` is the authoritative race-resolver — it only writes when
		// the row is still `active`, so the cascade audit fires at most once per run.
		if (rs.run.status !== "active") {
			return false;
		}
		const allDone = await areAllRequiredRunStepsComplete(rs.run.id, tx);
		if (!allDone) {
			return false;
		}
		const didTransition = await markRunCompleted(rs.run.id, tx);
		if (!didTransition) {
			return false;
		}
		await writeAuditAndActivity(
			{
				organizationId: ctx.organizationId,
				actorUserId: ctx.userId ?? null,
				actorKind,
				actorParticipantId,
				crossProductOrigin: ctx.crossProductOrigin ?? null,
				action: "run.completed",
				verb: "completed",
				entityType: "run",
				entityId: rs.run.id,
				changes: { fromStatus: "active", toStatus: "completed" },
				metadata: {
					triggeredByRunStepId: runStepId,
					...(ctx.participantId ? { actorParticipantId: ctx.participantId } : {}),
					...(ctx.agentId ? { actorAgentId: ctx.agentId } : {}),
				},
				activityData: { reason: "all required steps complete" },
			},
			tx,
		);

		// Phase 11a step 3c part 2 -- transactional outbox enqueue for the
		// run-level state transition. Both events fire at the same moment
		// (active -> completed); PM's webhookEvents filter narrows which it
		// receives. Both calls are no-ops when the run carries no cross-product
		// callback (uncostly query + early return), so non-cross-product runs
		// don't pay a write penalty here.
		const occurredAt = new Date();
		await enqueueCrossProductEventForRun(
			{
				runId: rs.run.id,
				eventType: "run.state_changed",
				occurredAt,
				previousStatus: "active",
				currentStatus: "completed",
				crossProductOrigin: ctx.crossProductOrigin ?? null,
			},
			tx,
		);
		await enqueueCrossProductEventForRun(
			{
				runId: rs.run.id,
				eventType: "run.completed",
				occurredAt,
				previousStatus: "active",
				currentStatus: "completed",
				crossProductOrigin: ctx.crossProductOrigin ?? null,
			},
			tx,
		);
		return true;
	});

	// Phase 18b-2 -- fan the run-completion out to the Playbook dispatcher via
	// Inngest. Post-commit + gated on the actual transition, so a rolled-back tx
	// never emits and the event fires at most once per run. The run's subject
	// entity (D-043) scopes entity-narrowed playbooks; resolved best-effort off
	// the loaded run row (null -> only match-any playbooks fire).
	if (runCompleted) {
		const runEntity = rs.run as {
			entityType?: string | null;
			entityId?: string | null;
		};
		const lifecycleData = {
			organizationId: ctx.organizationId,
			entityType: runEntity.entityType ?? null,
			entityId: runEntity.entityId ?? null,
			crossProductOrigin: ctx.crossProductOrigin ?? null,
			payload: { runId: rs.run.id, fromStatus: "active", toStatus: "completed" },
		};
		await inngest.send([
			{ name: PLAYBOOK_LIFECYCLE_EVENTS.RUN_STATE_CHANGED, data: lifecycleData },
			{ name: PLAYBOOK_LIFECYCLE_EVENTS.RUN_COMPLETED, data: lifecycleData },
		]);
	}

	return { runStepId, runCompleted };
}
