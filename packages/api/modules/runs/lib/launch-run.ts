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
	type DbExecutor,
	findDueRecomputeTargets,
	getAgentForOrg,
	getDateFieldValuesForStepInRun,
	getLatestPublishedWorkflowVersion,
	getVendorContactForLaunch,
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
	updateRunStepDueAt,
	validateFieldValue,
	writeAuditAndActivity,
} from "@virn/database";

import { RunEngineError } from "./errors";

/** Launch mode (Phase 8 step 3 -- the S-07 wedge). One authored procedure runs three ways:
 *   - `human`        : existing role-based assignment everywhere (no agent)
 *   - `ai_assisted`  : agent assigned to steps where step.type='ai'; humans elsewhere
 *   - `automated`    : agent assigned to all steps regardless of type
 *
 * Agent execution itself lands in Phase 11 (agent-safe action surface). This pass just
 * shapes the assignment graph -- in `automated` mode today, every step has an agent
 * assignee but the agent can't actually act until Phase 11, so steps sit pending until
 * a human marks them complete (which is fine; the wedge UX is the headline). */
export type LaunchMode = "human" | "ai_assisted" | "automated";

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
	/** Launch mode (Phase 8 step 3). Default: 'human' for backward compatibility -- any
	 * existing caller that doesn't pass mode keeps the old role-based-only assignment. */
	mode?: LaunchMode;
	/** Required when mode is 'ai_assisted' or 'automated'. The agent that handles the
	 * AI-shaped (or all) steps for this run. Validated server-side: must exist in the org,
	 * be active, and not soft-deleted. */
	agentId?: string | null;
}

export interface LaunchRunContext {
	organizationId: string;
	/** Better Auth user id when a logged-in human launches the run. Mutually exclusive
	 * with `launcherAgentId`. */
	userId?: string;
	/** Agent id when an agent launches the run via the action surface (Phase 11a.2,
	 * ADR-006). The launching agent is unconditionally added as a `participant` row on the
	 * new run so 11a.1's "must be a pre-existing participant" check passes for subsequent
	 * setFieldValue / completeStep calls by the same agent. Mutually exclusive with
	 * `userId`. */
	launcherAgentId?: string;
	/** Cross-product origin (D-027). Populated when the launching agent's
	 * `agent.originProduct` is set (e.g. `'virn-pm'`). Threaded into the `run.launched`
	 * audit row. */
	crossProductOrigin?: string | null;
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

	// 4. Validate role assignments: each must be EXACTLY ONE of user / guest / vendor.
	// For vendor: both vendorId AND vendorContactId required. For all kinds: the chosen
	// identity FK(s) must resolve in this org and pass status/active checks before any
	// snapshot rows are written.
	const validatedVendorByRoleId = new Map<
		string,
		{ vendorId: string; vendorContactId: string; vendorName: string; contactName: string }
	>();
	for (const ra of input.roleAssignments) {
		const hasUser = !!ra.userId;
		const hasGuest = !!ra.guestEmail;
		const hasVendor = !!ra.vendorId || !!ra.vendorContactId;
		const kindCount = (hasUser ? 1 : 0) + (hasGuest ? 1 : 0) + (hasVendor ? 1 : 0);
		if (kindCount !== 1) {
			throw new RunEngineError(
				"INVALID_ROLE_ASSIGNMENT",
				`Role assignment must specify exactly one of userId, guestEmail, or (vendorId + vendorContactId) (roleId: ${ra.roleId}).`,
				{ roleId: ra.roleId },
			);
		}
		if (hasVendor) {
			// vendorId AND vendorContactId both required when assigning via vendor.
			if (!ra.vendorId || !ra.vendorContactId) {
				throw new RunEngineError(
					"INVALID_ROLE_ASSIGNMENT",
					`Vendor role assignment requires both vendorId and vendorContactId (roleId: ${ra.roleId}).`,
					{ roleId: ra.roleId },
				);
			}
			const validation = await getVendorContactForLaunch(
				ctx.organizationId,
				ra.vendorId,
				ra.vendorContactId,
			);
			if (!validation) {
				// Either the vendor isn't in this org, or the contact doesn't belong to it.
				// Distinguish for the UI's error messaging.
				throw new RunEngineError(
					"VENDOR_CONTACT_NOT_FOUND",
					"Vendor or contact not found in this organization.",
					{ vendorId: ra.vendorId, vendorContactId: ra.vendorContactId, roleId: ra.roleId },
				);
			}
			if (!validation.vendorIsActive) {
				throw new RunEngineError(
					"VENDOR_INACTIVE",
					`Vendor "${validation.vendorName}" is disabled. Enable it or pick a different vendor.`,
					{ vendorId: ra.vendorId, roleId: ra.roleId },
				);
			}
			if (validation.vendorStatus === "blacklisted") {
				throw new RunEngineError(
					"VENDOR_BLACKLISTED",
					`Vendor "${validation.vendorName}" is blacklisted and cannot be assigned to a run.`,
					{ vendorId: ra.vendorId, roleId: ra.roleId },
				);
			}
			if (!validation.contactIsActive) {
				throw new RunEngineError(
					"VENDOR_CONTACT_INACTIVE",
					`Contact "${validation.contactName}" at "${validation.vendorName}" is disabled. Enable them or pick a different contact.`,
					{
						vendorId: ra.vendorId,
						vendorContactId: ra.vendorContactId,
						roleId: ra.roleId,
					},
				);
			}
			validatedVendorByRoleId.set(ra.roleId, {
				vendorId: validation.vendorId,
				vendorContactId: validation.contactId,
				vendorName: validation.vendorName,
				contactName: validation.contactName,
			});
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
	// Build the date-field map from validated kickoff values. Only `date` fields
	// participate -- the resolver pulls by field id (not key) so this scoping is the
	// only thing keeping a malformed step-field write from poisoning a downstream
	// dependent at launch time. (Step fields aren't filled at launch.)
	const launchDateFieldValues = collectDateFieldValues(
		kickoffValuesNorm.map((kv) => {
			const f = kickoffFields.find((kf) => kf.id === kv.fieldId);
			return { fieldId: kv.fieldId, fieldType: f?.fieldType ?? "", value: kv.value };
		}),
	);
	const dueContext: ComputeStepDueAtContext = {
		dateFieldValues: launchDateFieldValues,
		anchorCompletedAt: null,
	};
	const snapshotSteps: SnapshotStepRow[] = steps.map((s) => ({
		stepId: s.id,
		title: s.title,
		description: s.description,
		position: s.position,
		assignedRoleId: s.assignedRoleId,
		dueAt: computeStepDueAt(
			startedAt,
			{
				dueType: s.dueType,
				dueOffsetDays: s.dueOffsetDays,
				dueAnchorStepId: s.dueAnchorStepId,
				dueSourceFieldId: s.dueSourceFieldId,
			},
			dueContext,
		),
	}));

	// 6.5. Mode-aware agent validation (Phase 8 step 3).
	// Compute which steps (if any) the agent will handle for this launch. The role-based
	// step assignment below SKIPS any step in agentHandledStepIds -- the agent assignee
	// replaces the human role assignment for that step rather than coexisting (multi-
	// assignee is supported by the schema, but the semantic is one-handler-per-step in v1
	// to avoid "who owns this" ambiguity in the run view).
	const mode: LaunchMode = input.mode ?? "human";
	let agentParticipantTempKey: string | null = null;
	const agentHandledStepIds = new Set<string>();
	if (mode !== "human") {
		if (!input.agentId) {
			throw new RunEngineError(
				"MODE_REQUIRES_AGENT",
				`Launch mode "${mode}" requires an agentId; none provided.`,
				{ mode },
			);
		}
		const agentRow = await getAgentForOrg(ctx.organizationId, input.agentId);
		if (!agentRow) {
			throw new RunEngineError(
				"AGENT_NOT_IN_ORG",
				"Agent not found in this organization.",
				{ agentId: input.agentId },
			);
		}
		if (!agentRow.isActive) {
			throw new RunEngineError(
				"AGENT_INACTIVE",
				`Agent "${agentRow.name}" is disabled. Re-enable it or pick another.`,
				{ agentId: input.agentId },
			);
		}
		// Compute step set per mode.
		if (mode === "ai_assisted") {
			for (const s of steps) {
				if (s.type === "ai") agentHandledStepIds.add(s.id);
			}
		} else {
			// automated -- all steps.
			for (const s of steps) agentHandledStepIds.add(s.id);
		}
		// Only spawn the agent participant row if it'll actually own at least one step. In
		// ai_assisted mode with zero AI-typed steps the agent has nothing to do -- creating
		// a dead participant row just to satisfy the picked mode is noise (and would still
		// audit-attribute the launch as agent-mode, which the UI prevents preemptively but
		// the server is defensive against here too).
		if (agentHandledStepIds.size > 0) {
			agentParticipantTempKey = "p_agent";
		}
	}

	// 7. Build participant + role-assignment + step-assignee plans. Per-role assignment
	// can be a user, guest, or vendor (ADR-007 + D-023). The participant kind discriminator
	// + the corresponding identity FK(s) are populated based on which one the caller chose;
	// the participant CHECK constraint enforces lockstep at the DB layer.
	const participants: SnapshotParticipantRow[] = input.roleAssignments.map((ra, i) => {
		if (ra.vendorId && ra.vendorContactId) {
			return {
				tempKey: `p_${i}`,
				kind: "vendor",
				userId: null,
				guestEmail: null,
				guestName: null,
				agentId: null,
				vendorId: ra.vendorId,
				vendorContactId: ra.vendorContactId,
			};
		}
		return {
			tempKey: `p_${i}`,
			kind: ra.userId ? "user" : "guest",
			userId: ra.userId ?? null,
			guestEmail: ra.guestEmail ?? null,
			guestName: ra.guestName ?? null,
			agentId: null,
			vendorId: null,
			vendorContactId: null,
		};
	});
	if (agentParticipantTempKey && input.agentId) {
		participants.push({
			tempKey: agentParticipantTempKey,
			kind: "agent",
			userId: null,
			guestEmail: null,
			guestName: null,
			agentId: input.agentId,
			vendorId: null,
			vendorContactId: null,
		});
	}
	// Launcher-agent participant (Phase 11a.2). When an agent launches the run via the
	// action surface, we unconditionally add the launching agent as a participant on the
	// new run -- this is the "bind at launch" hook that 11a.1's findAgentParticipantForRun
	// check relies on for subsequent setFieldValue / completeStep calls by the same agent.
	// If the launcher is ALSO the mode-assigned agent (ctx.launcherAgentId === input.agentId
	// and a step-handling participant was just added above), skip the second row -- one
	// participant per agent per run is the model.
	let launcherAgentParticipantTempKey: string | null = null;
	if (ctx.launcherAgentId) {
		const alreadyAdded =
			agentParticipantTempKey !== null && input.agentId === ctx.launcherAgentId;
		if (alreadyAdded) {
			launcherAgentParticipantTempKey = agentParticipantTempKey;
		} else {
			launcherAgentParticipantTempKey = "p_launcher_agent";
			participants.push({
				tempKey: launcherAgentParticipantTempKey,
				kind: "agent",
				userId: null,
				guestEmail: null,
				guestName: null,
				agentId: ctx.launcherAgentId,
				vendorId: null,
				vendorContactId: null,
			});
		}
	}
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
		if (agentHandledStepIds.has(s.id) && agentParticipantTempKey) {
			// Agent owns this step in the chosen mode; skip any role-based assignment
			// (one-handler-per-step semantic for v1).
			stepAssignmentRows.push({
				stepId: s.id,
				participantTempKey: agentParticipantTempKey,
			});
			continue;
		}
		if (s.assignedRoleId && tempKeyByRoleId.has(s.assignedRoleId)) {
			stepAssignmentRows.push({
				stepId: s.id,
				participantTempKey: tempKeyByRoleId.get(s.assignedRoleId) ?? "",
			});
		}
	}

	// 8. Snapshot insert (transactional).
	const { runId, participantIdByTempKey } = await insertRunSnapshot({
		organizationId: ctx.organizationId,
		workflowId: workflow.id,
		workflowVersionId: version.id,
		title: input.title ?? workflow.title,
		// createdBy is null for agent-launched runs (Phase 11a.2) -- the launching agent
		// identity is in the audit row, not in run.createdBy.
		createdBy: ctx.userId ?? null,
		startedAt,
		runDueAt: null, // top-level run due is currently not modeled; per-step due is the source
		steps: snapshotSteps,
		kickoffValues: kickoffValuesNorm,
		participants,
		roleAssignments: roleAssignmentRows,
		stepAssignments: stepAssignmentRows,
	});

	// 9. Append-only writes (Invariant #6).
	// Agent-aware attribution (Phase 11a.2): when ctx.launcherAgentId is set, resolve the
	// just-inserted launcher participant id and record it on the audit row alongside
	// actor_kind='agent'. The launching agent's agentId also goes into `changes` for
	// forensic queries that filter on it directly.
	const launcherParticipantId =
		launcherAgentParticipantTempKey !== null
			? (participantIdByTempKey.get(launcherAgentParticipantTempKey) ?? null)
			: null;
	const actorKind: "user" | "agent" = ctx.launcherAgentId ? "agent" : "user";
	await writeAuditAndActivity({
		organizationId: ctx.organizationId,
		actorUserId: ctx.userId ?? null,
		actorKind,
		actorParticipantId: launcherParticipantId,
		crossProductOrigin: ctx.crossProductOrigin ?? null,
		action: "run.launched",
		verb: "launched",
		entityType: "run",
		entityId: runId,
		changes: {
			workflowId: workflow.id,
			workflowVersionId: version.id,
			stepCount: snapshotSteps.length,
			kickoffValueCount: kickoffValuesNorm.length,
			// Mode-aware launch (Phase 8 step 3). Recorded for forensics + the future
			// monitor view ("which runs went automated vs. human").
			mode,
			agentId: input.agentId ?? null,
			agentHandledStepCount: agentHandledStepIds.size,
			// Phase 11a.2: launcher-agent id for forensics ("which runs were kicked off by
			// PM-as-agent vs. by a human"). Distinct from input.agentId which is the
			// mode-handler agent -- the two can match or differ.
			launcherAgentId: ctx.launcherAgentId ?? null,
			// Vendor assignments (Phase 8 vendor picker, ADR-007 + D-023). The count goes
			// into changes for forensics; the vendor identities live on participant rows
			// (queryable via the audit_log -> participant -> vendor join chain).
			vendorAssignedRoleCount: validatedVendorByRoleId.size,
		},
		metadata: {
			source: ctx.launcherAgentId ? "agent" : "manual",
			...(ctx.launcherAgentId ? { actorAgentId: ctx.launcherAgentId } : {}),
		},
		activityData: { runTitle: input.title ?? workflow.title, workflowTitle: workflow.title },
	});

	return { runId };
}

/** A step's deadline configuration as understood by the resolver. Mirrors the
 * relevant subset of `step.$inferSelect`; callers commonly destructure the four
 * fields from a wider row. */
export interface ComputeStepDueAtInput {
	dueType: "none" | "offset_from_start" | "offset_from_step" | "from_date_field";
	dueOffsetDays: number | null;
	dueAnchorStepId: string | null;
	dueSourceFieldId: string | null;
}

/** Resolver-time context that closes over the two non-step inputs the new dueTypes
 * need. Either entry can be empty; the resolver returns `null` ("deferred") rather
 * than throwing when the data isn't yet available.
 *
 * - `dateFieldValues`: field-id -> Date for fields that are currently resolved.
 *   At LAUNCH this is populated only from kickoff `date` fields (which are known
 *   at that moment). At RECOMPUTE (post step completion) the caller also adds
 *   any newly-filled step date fields whose key matches a downstream
 *   `dueSourceFieldId`.
 * - `anchorCompletedAt`: the `completedAt` timestamp of the step a `offset_from_step`
 *   step depends on. Null at launch (anchor hasn't run); populated by the
 *   recompute path when the anchor transitions to completed. */
export interface ComputeStepDueAtContext {
	dateFieldValues: Map<string, Date>;
	anchorCompletedAt?: Date | null;
}

/** Pure resolver for a step's runtime due timestamp.
 *
 *   `none`              -> always null
 *   `offset_from_start` -> runStartedAt + dueOffsetDays
 *   `offset_from_step`  -> anchor.completedAt + dueOffsetDays   (null until anchor completes)
 *   `from_date_field`   -> sourceField.value   + dueOffsetDays   (null until source field has a date)
 *
 * Returning `null` means "deferred — not enough information at this resolution
 * moment." The recompute hook in complete-step.ts patches dueAt for dependents of
 * a step whose completion (or whose newly-filled date field) just provided the
 * missing input. */
export function computeStepDueAt(
	runStartedAt: Date,
	step: ComputeStepDueAtInput,
	context: ComputeStepDueAtContext,
): Date | null {
	const offset = step.dueOffsetDays;
	switch (step.dueType) {
		case "none":
			return null;
		case "offset_from_start":
			if (typeof offset !== "number") return null;
			return addDays(runStartedAt, offset);
		case "offset_from_step": {
			if (typeof offset !== "number") return null;
			if (!step.dueAnchorStepId) return null;
			const anchor = context.anchorCompletedAt ?? null;
			if (!anchor) return null;
			return addDays(anchor, offset);
		}
		case "from_date_field": {
			if (typeof offset !== "number") return null;
			if (!step.dueSourceFieldId) return null;
			const baseDate = context.dateFieldValues.get(step.dueSourceFieldId);
			if (!baseDate) return null;
			return addDays(baseDate, offset);
		}
	}
}

/** Add `days` calendar days to `base`, working in UTC. Using local-time
 * `setDate`/`getDate` would silently shift the result by ±1 hour around DST
 * transitions when the server timezone is not UTC, and would land on the wrong
 * calendar day for date-only ISO inputs ('2026-06-15' parses as UTC midnight,
 * which getDate() in a UTC-offset timezone reports as the previous day). UTC
 * math is deterministic regardless of the server's TZ env. */
function addDays(base: Date, days: number): Date {
	const d = new Date(base);
	d.setUTCDate(d.getUTCDate() + days);
	return d;
}

/** Helper used by both the launch path and the recompute path: collect `date`
 * field values into a Map<fieldId, Date>. Tolerates the validator's storage
 * format -- ISO strings (the database `field_value` column stores TIMESTAMPTZ
 * normalized via `new Date(v)`), Date instances (in-memory), or null/undefined
 * (skipped). Invalid date strings are skipped (NOT thrown) -- the run is
 * already mid-flight at recompute time and we'd rather leave the deadline
 * deferred than blow up the completion call. */
export function collectDateFieldValues(
	pairs: ReadonlyArray<{ fieldId: string; fieldType: string; value: unknown }>,
): Map<string, Date> {
	const out = new Map<string, Date>();
	for (const p of pairs) {
		if (p.fieldType !== "date") continue;
		if (p.value === null || p.value === undefined) continue;
		const d = p.value instanceof Date ? p.value : new Date(String(p.value));
		if (Number.isNaN(d.getTime())) continue;
		out.set(p.fieldId, d);
	}
	return out;
}

// ---------------------------------------------------------------------------
// dueAt recompute on step completion
// ---------------------------------------------------------------------------

export interface RecomputeDueAtArgs {
	runId: string;
	/** Definition step id of the run-step that just completed. Drives the
	 * offset_from_step branch (find dependents whose dueAnchorStepId points here). */
	completedStepId: string;
	/** Wall-clock time the completion was recorded. Threaded so the recompute
	 * uses the SAME timestamp the audit row records (markRunStepCompleted returns
	 * this for that reason). */
	completedAt: Date;
}

export interface RecomputeDueAtResult {
	/** runStep ids that had their dueAt patched. Length 0 = no dependents
	 * resolved (either no dependents in the run, or their inputs still aren't
	 * available). */
	patchedRunStepIds: string[];
}

/** Patch dueAt for any unresolved dependents of the just-completed step. Two
 * branches handled together so the dependent set is materialized once:
 *
 *   1. offset_from_step where dueAnchorStepId === completedStepId
 *      Resolution: completedAt + dueOffsetDays.
 *   2. from_date_field where dueSourceFieldId points at a date field on the
 *      completed step that now has a value.
 *      Resolution: sourceFieldValue + dueOffsetDays.
 *
 * Called inside completeRunStep's transaction (same `tx`), so a recompute
 * failure rolls back the step completion too -- preferable to a half-applied
 * state where the audit shows "completed" but downstream deadlines stay
 * deferred forever.
 *
 * Important invariants the recompute maintains:
 *   - Only patches dueAt when previously NULL (findDueRecomputeTargets filters
 *     on that). A resolved deadline is sticky.
 *   - Only resolves into non-null new values. A target whose resolver returns
 *     null is skipped (e.g. anchor completedAt missing -- shouldn't happen in
 *     this path, but defensive).
 *   - Skips already-completed runSteps (findDueRecomputeTargets filters them
 *     out). Setting a deadline on a completed step would be misleading. */
export async function recomputeDueAtAfterStepCompletion(
	args: RecomputeDueAtArgs,
	executor: DbExecutor,
): Promise<RecomputeDueAtResult> {
	// 1. Pull date-field values for the completed step (so from_date_field
	// dependents whose source lives here can resolve).
	const stepDateFields = await getDateFieldValuesForStepInRun(
		args.runId,
		args.completedStepId,
		executor,
	);
	const dateFieldValues = collectDateFieldValues(stepDateFields);
	const filledSourceFieldIds = Array.from(dateFieldValues.keys());

	// 2. Find unresolved targets matching EITHER branch.
	const targets = await findDueRecomputeTargets(
		{
			runId: args.runId,
			completedStepId: args.completedStepId,
			sourceFieldIds: filledSourceFieldIds,
		},
		executor,
	);

	if (targets.length === 0) return { patchedRunStepIds: [] };

	// 3. Resolve each target with the right context branch and patch.
	// We don't have the run's startedAt here, but the only branches we resolve
	// in the recompute path are offset_from_step + from_date_field -- neither
	// uses runStartedAt. Pass the completedAt as a defensible placeholder; it's
	// ignored by the relevant branches.
	const ctx = {
		dateFieldValues,
		anchorCompletedAt: args.completedAt,
	};

	const patchedRunStepIds: string[] = [];
	for (const t of targets) {
		const due = computeStepDueAt(
			args.completedAt,
			{
				dueType: t.dueType,
				dueOffsetDays: t.dueOffsetDays,
				dueAnchorStepId: t.dueAnchorStepId,
				dueSourceFieldId: t.dueSourceFieldId,
			},
			ctx,
		);
		if (due === null) continue;
		await updateRunStepDueAt({ runStepId: t.runStepId, dueAt: due }, executor);
		patchedRunStepIds.push(t.runStepId);
	}
	return { patchedRunStepIds };
}

export interface RecomputeAfterFieldValueChangeArgs {
	runId: string;
	fieldId: string;
	fieldType: string;
	/** The newly-written value (already validated by validateFieldValue). For a
	 * 'date' field this is an ISO string; for non-date fieldTypes the recompute
	 * short-circuits to a no-op since only 'date' fields are valid
	 * dueSourceFieldId targets. */
	newValue: unknown;
}

/** Field-value-change variant of the recompute hook. Called from setRunFieldValue
 * after a successful upsert, INSIDE the same transaction so dependents whose
 * dueSourceFieldId points at the just-updated field can resolve against the
 * uncommitted value. Two flows this catches that the step-completion hook
 * misses:
 *
 *   1. Admin edits a kickoff date field post-launch -- no step completion
 *      event fires, but downstream from_date_field dependents need to re-
 *      resolve against the new value.
 *   2. A step-scoped date field is filled BEFORE the step completes (the
 *      assignee fills the date, then someone else completes the step later).
 *      Step-completion hook only runs at the completion event, so the value
 *      would otherwise stay deferred until completion -- which is fine for
 *      that one event, but if the dependent's step had already completed by
 *      then the completion hook filters it out (status != 'completed' gate).
 *      This hook fires at the moment the value lands so the dependent's
 *      dueAt is set before any completion sequence reorders the picture. */
export async function recomputeDueAtAfterFieldValueChange(
	args: RecomputeAfterFieldValueChangeArgs,
	executor: DbExecutor,
): Promise<RecomputeDueAtResult> {
	// Non-date fields can't legally be a dueSourceFieldId (assertDueRefs
	// rejects, AI validator rejects). Bail fast so the rest of setFieldValue's
	// hot path doesn't pay the query cost.
	if (args.fieldType !== "date") return { patchedRunStepIds: [] };

	const dateFieldValues = collectDateFieldValues([
		{ fieldId: args.fieldId, fieldType: args.fieldType, value: args.newValue },
	]);
	if (dateFieldValues.size === 0) {
		// Value is null/undefined or unparseable -- nothing to resolve against.
		return { patchedRunStepIds: [] };
	}

	const targets = await findDueRecomputeTargets(
		{
			runId: args.runId,
			completedStepId: null,
			sourceFieldIds: [args.fieldId],
		},
		executor,
	);
	if (targets.length === 0) return { patchedRunStepIds: [] };

	// from_date_field's resolver doesn't read runStartedAt; passing the current
	// wall-clock time is safe (any value would be, since the resolver short-
	// circuits to the dateFieldValues map for this branch).
	const placeholderRunStart = new Date();
	const ctx: ComputeStepDueAtContext = {
		dateFieldValues,
		anchorCompletedAt: null,
	};

	const patchedRunStepIds: string[] = [];
	for (const t of targets) {
		const due = computeStepDueAt(
			placeholderRunStart,
			{
				dueType: t.dueType,
				dueOffsetDays: t.dueOffsetDays,
				dueAnchorStepId: t.dueAnchorStepId,
				dueSourceFieldId: t.dueSourceFieldId,
			},
			ctx,
		);
		if (due === null) continue;
		await updateRunStepDueAt({ runStepId: t.runStepId, dueAt: due }, executor);
		patchedRunStepIds.push(t.runStepId);
	}
	return { patchedRunStepIds };
}
