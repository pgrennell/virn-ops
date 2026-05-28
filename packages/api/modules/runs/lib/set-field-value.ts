// packages/api/modules/runs/lib/set-field-value.ts
//
// Set a single field value on a run, scoped to either a run step (step-scoped field) or
// the run itself (kickoff field; runStepId null). Validates the value against the
// snapshotted field's type + config (validateFieldValue, parallels validateSettingValue
// in queries/config.ts).
//
// Access: same rule as completeStep -- assignee OR org admin/owner. Kickoff field writes
// after launch are admin/owner only (no assignee concept for launch-level fields).
//
// Fields are referenced by stable `key` (Invariant #5), never by label, never by id from
// the client.

import {
	findAgentParticipantForRun,
	findFieldByVersionAndKey,
	getRunForOrg,
	getRunStepWithRun,
	upsertRunFieldValue,
	validateFieldValue,
	validateLookupReferenceByKey,
	withTransaction,
	writeAuditAndActivity,
} from "@virn/database";

import { RunEngineError } from "./errors";
import { recomputeDueAtAfterFieldValueChange } from "./launch-run";

export interface SetFieldValueContext {
	organizationId: string;
	/** Better Auth user id; mutually exclusive with `participantId` and `agentId`. */
	userId?: string;
	/** Participant id when called via verified participant_token (guest path). Mutually
	 * exclusive with `userId` and `agentId`. */
	participantId?: string;
	/** Agent id when called via verified bearer credential (Phase 11a action surface,
	 * ADR-006). Mutually exclusive with `userId` and `participantId`. Agents are never
	 * admin/owner, must be a pre-existing participant on the run (bound at launch). */
	agentId?: string;
	/** Cross-product origin (D-027). Populated when the calling agent's
	 * `agent.originProduct` is set (e.g. `'virn-pm'`). Threaded into the audit/activity row
	 * so downstream consumers can distinguish PM-driven from in-house writes. */
	crossProductOrigin?: string | null;
	isAdminOrOwner: boolean;
}

export interface SetFieldValueInput {
	/** Null = kickoff (launch-level) field. Non-null = step-scoped field on this run step. */
	runStepId: string | null;
	/** The run this value belongs to. Required when runStepId is null (kickoff write);
	 * for runStepId-scoped writes, the run is resolved from the step. */
	runId?: string;
	/** Stable field key (Invariant #5). */
	fieldKey: string;
	value: unknown;
}

export async function setRunFieldValue(
	ctx: SetFieldValueContext,
	input: SetFieldValueInput,
): Promise<{ ok: true }> {
	let runId: string;
	let workflowVersionId: string;
	// Agent caller: we resolve the agent's participant row lazily once we know runId, then
	// reuse it for both the assignee check and the audit attribution. `null` for non-agent
	// callers.
	let agentParticipantId: string | null = null;

	if (input.runStepId) {
		// Step-scoped write -- look up the runStep, derive run + version, enforce assignee/admin.
		const rs = await getRunStepWithRun(ctx.organizationId, input.runStepId);
		if (!rs) {
			throw new RunEngineError("RUN_STEP_NOT_FOUND", "Run step not found in this organization.", {
				runStepId: input.runStepId,
			});
		}
		if (rs.status === "completed") {
			throw new RunEngineError(
				"RUN_STEP_ALREADY_COMPLETED",
				"Cannot edit field values on a completed run step.",
				{ runStepId: input.runStepId },
			);
		}
		// Defense-in-depth (matches completeRunStep): a non-active run locks field edits.
		if (rs.run.status !== "active") {
			throw new RunEngineError(
				"RUN_NOT_ACTIVE",
				`Cannot edit field values on a ${rs.run.status} run.`,
				{ runStepId: input.runStepId, runId: rs.run.id, runStatus: rs.run.status },
			);
		}
		// Agent path: resolve the agent's participant row for this run BEFORE the assignee
		// check, so the same `participantId` flows into both the access decision and the
		// audit row. An agent that wasn't bound to this run at launch can't act on it --
		// Phase 11a.1 has no "create on demand" pathway (matches user-side semantics).
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
					{ runStepId: input.runStepId, agentId: ctx.agentId },
				);
			}
			agentParticipantId = part.id;
		}
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
					{ runStepId: input.runStepId },
				);
			}
		}
		runId = rs.run.id;
		workflowVersionId = rs.run.workflowVersionId;
	} else {
		// Kickoff write after launch -- admin/owner only. Agents are never admin/owner;
		// kickoff edits are an admin-only escape hatch and don't make sense for the
		// machine principal flow.
		if (ctx.agentId) {
			throw new RunEngineError(
				"RUN_STEP_ACCESS_DENIED",
				"Agents cannot edit kickoff field values.",
			);
		}
		if (!ctx.isAdminOrOwner) {
			throw new RunEngineError(
				"RUN_STEP_ACCESS_DENIED",
				"Only admins/owners can edit kickoff field values after launch.",
			);
		}
		if (!input.runId) {
			throw new RunEngineError(
				"RUN_NOT_FOUND",
				"runId is required when writing kickoff (runStepId-null) values.",
			);
		}
		const r = await getRunForOrg(ctx.organizationId, input.runId);
		if (!r) {
			throw new RunEngineError("RUN_NOT_FOUND", "Run not found in this organization.", {
				runId: input.runId,
			});
		}
		if (r.status !== "active") {
			throw new RunEngineError(
				"RUN_NOT_ACTIVE",
				`Cannot edit kickoff field values on a ${r.status} run.`,
				{ runId: r.id, runStatus: r.status },
			);
		}
		runId = r.id;
		workflowVersionId = r.workflowVersionId;
	}

	// Resolve field by version + key (Invariant #5).
	const f = await findFieldByVersionAndKey(workflowVersionId, input.fieldKey);
	if (!f) {
		throw new RunEngineError(
			"UNKNOWN_FIELD_KEY",
			`No field with key "${input.fieldKey}" in this workflow version.`,
			{ fieldKey: input.fieldKey, workflowVersionId },
		);
	}

	// Validate value against the snapshotted field's config (shape only -- buildFieldZod
	// returns z.unknown() for the lookup type; cross-row validation happens below).
	let validated: unknown;
	try {
		validated = validateFieldValue(
			{ fieldType: f.fieldType, config: f.config as Record<string, unknown> | null, isRequired: f.isRequired },
			input.value,
		);
	} catch (err) {
		throw new RunEngineError(
			"FIELD_VALUE_INVALID",
			`Field value for "${input.fieldKey}" failed validation: ${err instanceof Error ? err.message : String(err)}`,
			{ fieldKey: input.fieldKey },
		);
	}

	// Phase 9b: lookup-field cross-row validation. The shape validator can't check that
	// the value resolves to a real data_set_record id -- that needs a DB roundtrip. We
	// only run this when the value is non-null (clearing a lookup is fine).
	if (f.fieldType === "lookup" && validated !== null && validated !== undefined) {
		const cfg = (f.config ?? {}) as { dataSetKey?: unknown };
		const dataSetKey = typeof cfg.dataSetKey === "string" ? cfg.dataSetKey : null;
		if (!dataSetKey) {
			throw new RunEngineError(
				"FIELD_VALUE_INVALID",
				`Lookup field "${input.fieldKey}" has no data set configured. Set field.config.dataSetKey in the Builder.`,
				{ fieldKey: input.fieldKey },
			);
		}
		if (typeof validated !== "string" || validated.length === 0) {
			throw new RunEngineError(
				"FIELD_VALUE_INVALID",
				`Lookup field "${input.fieldKey}" expects a record id (string); got ${typeof validated}.`,
				{ fieldKey: input.fieldKey },
			);
		}
		const result = await validateLookupReferenceByKey({
			organizationId: ctx.organizationId,
			dataSetKey,
			recordId: validated,
		});
		if (!result.ok) {
			throw new RunEngineError(
				"FIELD_VALUE_INVALID",
				result.reason === "dataset_missing"
					? `Lookup field "${input.fieldKey}" references data set "${dataSetKey}" which doesn't exist in this organization (or is archived).`
					: `Lookup field "${input.fieldKey}" value isn't a valid record of data set "${dataSetKey}".`,
				{ fieldKey: input.fieldKey, dataSetKey, recordId: validated, reason: result.reason },
			);
		}
	}

	// Atomic write: field-value upsert + activity must succeed or fail together.
	// A crash between them would leave a stored field value with no activity trail.
	await withTransaction(async (tx) => {
		await upsertRunFieldValue(
			{
				runId,
				runStepId: input.runStepId,
				fieldId: f.id,
				value: validated,
			},
			tx,
		);

		// Phase 12.2 -- recompute dueAt for any from_date_field dependents that
		// source this field. Catches the two flows the step-completion hook
		// misses: admin-edits-kickoff-date-after-launch and step-field-filled-
		// before-step-completes. No-op when the field isn't a date type (the
		// resolver short-circuits inside the helper).
		await recomputeDueAtAfterFieldValueChange(
			{
				runId,
				fieldId: f.id,
				fieldType: f.fieldType,
				newValue: validated,
			},
			tx,
		);

		// Activity (per #6 -- field edits are user-visible). Audit_log skipped here to
		// avoid noise; setFieldValue fires often during a run. If forensic field-edit
		// history becomes needed, add a dedicated audit channel.
		const actorKind: "user" | "guest" | "agent" = ctx.agentId
			? "agent"
			: ctx.participantId
				? "guest"
				: "user";
		const actorParticipantId = ctx.participantId ?? agentParticipantId ?? null;
		await writeAuditAndActivity(
			{
				organizationId: ctx.organizationId,
				actorUserId: ctx.userId ?? null,
				actorKind,
				actorParticipantId,
				crossProductOrigin: ctx.crossProductOrigin ?? null,
				action: "field_value.set",
				verb: "edited",
				entityType: "field_value",
				entityId: f.id,
				changes: {
					runId,
					runStepId: input.runStepId ?? null,
					fieldKey: input.fieldKey,
					...(ctx.participantId ? { actorParticipantId: ctx.participantId } : {}),
					...(ctx.agentId ? { actorAgentId: ctx.agentId } : {}),
				},
				activityData: { fieldKey: input.fieldKey, fieldLabel: f.label },
			},
			tx,
		);
	});

	return { ok: true as const };
}
