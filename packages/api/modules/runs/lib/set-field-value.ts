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
	findFieldByVersionAndKey,
	getRunForOrg,
	getRunStepWithRun,
	upsertRunFieldValue,
	validateFieldValue,
	withTransaction,
	writeAuditAndActivity,
} from "@virn/database";

import { RunEngineError } from "./errors";

export interface SetFieldValueContext {
	organizationId: string;
	/** Better Auth user id; mutually exclusive with `participantId`. */
	userId?: string;
	/** Participant id when called via verified participant_token (guest path). */
	participantId?: string;
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
		if (!ctx.isAdminOrOwner) {
			const isAssignee = rs.assignees.some((a) => {
				if (ctx.participantId && a.participant.id === ctx.participantId) return true;
				if (ctx.userId && a.participant.userId === ctx.userId) return true;
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
		// Kickoff write after launch -- admin/owner only.
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

	// Validate value against the snapshotted field's config.
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

		// Activity (per #6 -- field edits are user-visible). Audit_log skipped here to
		// avoid noise; setFieldValue fires often during a run. If forensic field-edit
		// history becomes needed, add a dedicated audit channel.
		await writeAuditAndActivity(
			{
				organizationId: ctx.organizationId,
				actorUserId: ctx.userId ?? null,
				action: "field_value.set",
				verb: "edited",
				entityType: "field_value",
				entityId: f.id,
				changes: {
					runId,
					runStepId: input.runStepId ?? null,
					fieldKey: input.fieldKey,
					...(ctx.participantId ? { actorParticipantId: ctx.participantId } : {}),
				},
				activityData: { fieldKey: input.fieldKey, fieldLabel: f.label },
			},
			tx,
		);
	});

	return { ok: true as const };
}
