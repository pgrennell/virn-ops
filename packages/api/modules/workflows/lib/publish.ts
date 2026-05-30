// packages/api/modules/workflows/lib/publish.ts
//
// The two operations that define the workflow versioning model (D-018):
//   1. `publishVersion`  -- atomic draft -> published transition. After this, the
//      workflow_version is the immutable snapshot launchRun reads.
//   2. `editPublished`   -- RESUME the current open draft if one exists, otherwise FORK
//      a new draft by deep-copying the latest published version. At most one open draft
//      per workflow is enforced server-side, here -- not assumed in the UI.
//
// Plus `discardDraft`, the inverse of editPublished's fork branch.
//
// Why resume-vs-fork matters: the naive implementation "always fork" produces orphan
// drafts -- click Edit, navigate away without publishing, click Edit again -> v2 and v3
// both open. The product invariant is "one open draft", so the server enforces it.
//
// Fork semantics: deep-copy sections + steps + fields + step_dependencies; preserve
// field.key VERBATIM (Invariant #5 -- keys are the stable identity, IDs are per-version);
// remap IDs so the new draft is fully independent; remap step.dueAnchorStepId and
// step.dueSourceFieldId references from the source ids to the freshly-copied ids
// (anchor refs that point at things inside this version follow the copy; refs that
// somehow point outside -- shouldn't happen with the current schema, but we're defensive
// -- get cleared). Published v1 is NEVER mutated. In-flight runs hold their own
// snapshot per Invariant #4 and are untouched.

import {
	countStepsInVersion,
	db,
	deleteVersion,
	getLatestPublishedWorkflowVersion,
	getVersionLaunchBundle,
	getWorkflowForOrg,
	getWorkflowWithVersions,
	hasApprovedApprovalForVersion,
	insertDraftVersion,
	insertField,
	insertSection,
	insertStep,
	insertStepDependency,
	isCapabilityEnabledForOrg,
	nextVersionNumber,
	publishVersionRow,
	transitionWorkflowReviewState,
	updateStep,
	writeAuditAndActivity,
} from "@virn/database";

import { WorkflowEngineError } from "./errors";

export interface PublishContext {
	organizationId: string;
	userId: string;
}

export interface PublishVersionResult {
	versionId: string;
	versionNumber: number;
}

/** Promote a draft version to published. Refuses on:
 *   - VERSION_NOT_FOUND        version isn't in this org
 *   - VERSION_NOT_DRAFT        version is already published / archived
 *   - VERSION_HAS_NO_STEPS     publishing an empty workflow is almost certainly a mistake;
 *                              the constraint matches the run engine's expectation that a
 *                              run snapshot has at least one step.
 *
 * The UPDATE matches `status = 'draft'` so two concurrent publishers can't both
 * "succeed" -- the second observes the race and gets PUBLISH_RACE. */
export async function publishVersion(
	ctx: PublishContext,
	input: { versionId: string },
): Promise<PublishVersionResult> {
	// Load the version + its parent workflow, scoped to org. We do the org/draft check
	// outside the transaction so the failure modes return fast without holding a row lock.
	const v = await db.query.workflowVersion.findFirst({
		where: (vv, { eq: e }) => e(vv.id, input.versionId),
		with: {
			workflow: { columns: { id: true, organizationId: true } },
			steps: { columns: { id: true } },
		},
	});
	if (!v || v.workflow.organizationId !== ctx.organizationId) {
		throw new WorkflowEngineError("VERSION_NOT_FOUND", "Workflow version not found.", {
			versionId: input.versionId,
		});
	}
	if (v.status !== "draft") {
		throw new WorkflowEngineError(
			"VERSION_NOT_DRAFT",
			`Cannot publish a ${v.status} version.`,
			{ versionId: v.id, status: v.status },
		);
	}
	if (v.steps.length === 0) {
		throw new WorkflowEngineError(
			"VERSION_HAS_NO_STEPS",
			"Cannot publish a workflow with no steps. Add at least one step first.",
			{ versionId: v.id },
		);
	}

	// Phase 16 -- approvals gate. When governance.approvals is ON for the org,
	// publishing requires an `approved` version_approval row for this version
	// (admin override deliberately NOT supported: the whole point of the gate
	// is that no one bypasses approvals -- relax later if customer pull asks).
	const approvalsCapEnabled = await isCapabilityEnabledForOrg(
		ctx.organizationId,
		"governance.approvals",
	);
	if (approvalsCapEnabled) {
		const isApproved = await hasApprovedApprovalForVersion(v.id);
		if (!isApproved) {
			throw new WorkflowEngineError(
				"APPROVAL_REQUIRED",
				"Approvals are required for this org and no approved request exists for this version. Request approval first.",
				{ versionId: v.id, capability: "governance.approvals" },
			);
		}
	}

	// Atomic publish + audit pair. The publishVersionRow helper's WHERE-clause closes the
	// double-publish race (D-018 §race).
	const result = await db.transaction(async (tx) => {
		const didTransition = await publishVersionRow(
			{ versionId: v.id, publishedByUserId: ctx.userId },
			tx,
		);
		if (!didTransition) {
			// Someone else won the race. Surface a distinct code so the UI can refetch.
			throw new WorkflowEngineError(
				"PUBLISH_RACE",
				"This version was already published by another writer. Refetch to see the latest state.",
				{ versionId: v.id },
			);
		}
		await writeAuditAndActivity(
			{
				organizationId: ctx.organizationId,
				actorUserId: ctx.userId,
				action: "workflow_version.published",
				verb: "published",
				entityType: "workflow_version",
				entityId: v.id,
				changes: { fromStatus: "draft", toStatus: "published" },
				metadata: {
					workflowId: v.workflow.id,
					versionNumber: v.versionNumber,
					stepCount: v.steps.length,
				},
				activityData: { versionNumber: v.versionNumber },
			},
			tx,
		);
		return { versionId: v.id, versionNumber: v.versionNumber };
	});

	return result;
}

/** Phase 9.5g (PRD §6.6) -- approve a workflow currently in review and publish its
 * current draft.
 *
 * Failure-mode containment (revised 2026-05-27 after dogfooding caught state/version
 * desync):
 *
 *   1. PRE-FLIGHT: validate the draft has ≥1 step BEFORE any write. This catches the
 *      only realistic publish failure (VERSION_HAS_NO_STEPS) without touching state.
 *   2. PUBLISH the draft via the existing publishVersion path. Its publishVersionRow
 *      WHERE-on-status='draft' guard closes the two-admin race (the loser gets
 *      PUBLISH_RACE and bails before the transition step ever runs).
 *   3. TRANSITION review_state in_review → published. WHERE-on-from-state guard catches
 *      the extreme race where someone send-back'd between our publish and our
 *      transition (sub-100ms window; recovery is admin re-approves).
 *   4. AUDIT the approval.
 *
 * Why this ordering: the original (transition first) could leave reviewState=published
 * with the version still draft if publish failed downstream. By publishing FIRST and
 * only transitioning state if publish succeeded, the failure modes are:
 *   - Pre-flight fails (no steps): no writes, clean error
 *   - Publish fails: reviewState stays in_review, version stays draft, fully consistent
 *   - Transition fails (admin send-back race): version published, reviewState stays draft.
 *     Recovery: admin re-approves to flip state. Strict atomicity here would require
 *     wrapping publishVersion's logic into the same transaction (~80-line refactor);
 *     deferred as a v1.5 polish item since the race window is sub-100ms. */
export async function approveReview(
	ctx: PublishContext,
	input: { workflowId: string },
): Promise<PublishVersionResult> {
	const wf = await getWorkflowForOrg(ctx.organizationId, input.workflowId);
	if (!wf) {
		throw new WorkflowEngineError("WORKFLOW_NOT_FOUND", "Workflow not found.", {
			workflowId: input.workflowId,
		});
	}
	if (wf.reviewState !== "in_review") {
		throw new WorkflowEngineError(
			"REVIEW_STATE_INVALID",
			`Cannot approve from state "${wf.reviewState}". Workflow must be 'in_review'.`,
			{ workflowId: input.workflowId, currentState: wf.reviewState },
		);
	}

	const wfWithVersions = await getWorkflowWithVersions(
		ctx.organizationId,
		input.workflowId,
	);
	if (!wfWithVersions?.currentDraft) {
		throw new WorkflowEngineError(
			"WORKFLOW_HAS_NO_DRAFT",
			"Cannot approve: workflow has no draft version. The draft may have been discarded.",
			{ workflowId: input.workflowId },
		);
	}
	const draftVersionId = wfWithVersions.currentDraft.id;

	// 1. PRE-FLIGHT: validate the draft has ≥1 step (the only realistic publish-fail
	// mode). Done BEFORE any write so a no-steps approve refuses cleanly with no state
	// change. publishVersion re-validates inside its own transaction anyway (defense in
	// depth), but failing fast here is cheaper than the rollback path.
	const stepCount = await countStepsInVersion(draftVersionId);
	if (stepCount === 0) {
		throw new WorkflowEngineError(
			"VERSION_HAS_NO_STEPS",
			"Cannot approve a workflow with no steps. Send back to draft, add at least one step, and resubmit.",
			{ workflowId: input.workflowId, versionId: draftVersionId },
		);
	}

	// 2. PUBLISH first. publishVersion writes its own audit row + closes the two-admin
	// race via publishVersionRow's WHERE-on-status='draft' guard. Loser gets PUBLISH_RACE.
	const result = await publishVersion(ctx, { versionId: draftVersionId });

	// 3. TRANSITION review_state. Sub-100ms send-back race would land us here with
	// transition.ok=false; version is already published so we surface an error the admin
	// can resolve by re-clicking Approve (the next attempt sees state=draft and refuses
	// at the reviewState !== 'in_review' check above; the admin uses editPublished to
	// resync).
	const transition = await transitionWorkflowReviewState({
		organizationId: ctx.organizationId,
		workflowId: input.workflowId,
		fromState: "in_review",
		toState: "published",
	});
	if (!transition.ok) {
		throw new WorkflowEngineError(
			"REVIEW_STATE_INVALID",
			"Workflow state changed during approval (likely sent back by another admin). The version published successfully; refresh to see the latest state.",
			{ workflowId: input.workflowId, versionId: draftVersionId },
		);
	}

	// 4. AUDIT the approval.
	await writeAuditAndActivity({
		organizationId: ctx.organizationId,
		actorUserId: ctx.userId,
		action: "workflow.review_approved",
		verb: "approved",
		entityType: "workflow",
		entityId: input.workflowId,
		changes: { reviewState: { from: "in_review", to: "published" } },
		metadata: { draftVersionId },
		activityData: { workflowTitle: wf.title },
	});

	return result;
}

export interface EditPublishedResult {
	draftVersionId: string;
	draftVersionNumber: number;
	/** True iff this call FORKED a new draft. False if it returned an existing draft. The
	 * UI uses this to decide whether to show "you're editing v3 (draft)" vs. a fresh
	 * "draft forked from v2" toast. */
	forked: boolean;
}

/** Resume the workflow's open draft, or fork a new one from the latest published version.
 * At most ONE open draft per workflow -- enforced here, not in the UI. */
export async function editPublished(
	ctx: PublishContext,
	input: { workflowId: string },
): Promise<EditPublishedResult> {
	const bundle = await getWorkflowWithVersions(ctx.organizationId, input.workflowId);
	if (!bundle) {
		throw new WorkflowEngineError("WORKFLOW_NOT_FOUND", "Workflow not found.", {
			workflowId: input.workflowId,
		});
	}
	if (bundle.workflow.deletedAt !== null) {
		throw new WorkflowEngineError(
			"WORKFLOW_ARCHIVED",
			"Workflow is archived. Restore it before editing.",
			{ workflowId: input.workflowId },
		);
	}

	// 1. Resume path: an open draft already exists.
	if (bundle.currentDraft) {
		return {
			draftVersionId: bundle.currentDraft.id,
			draftVersionNumber: bundle.currentDraft.versionNumber,
			forked: false,
		};
	}

	// 2. Fork path: no draft -> deep-copy the latest published into a new draft.
	const published = await getLatestPublishedWorkflowVersion(input.workflowId);
	if (!published) {
		throw new WorkflowEngineError(
			"VERSION_NOT_PUBLISHED",
			"Workflow has no published version to fork from.",
			{ workflowId: input.workflowId },
		);
	}

	const forkResult = await db.transaction(async (tx) => {
		const versionNumber = await nextVersionNumber(input.workflowId, tx);
		const draft = await insertDraftVersion(
			{ workflowId: input.workflowId, versionNumber },
			tx,
		);

		// Pull the published version's full content. We use getVersionLaunchBundle (which
		// the run engine already trusts) for steps + fields + deps, and pull sections
		// separately since launchRun doesn't need them.
		const [{ steps, fields, deps }, sections] = await Promise.all([
			getVersionLaunchBundle(published.id),
			tx.query.section.findMany({
				where: (s, { eq: e }) => e(s.workflowVersionId, published.id),
				orderBy: (s, { asc }) => [asc(s.position)],
			}),
		]);

		// 2a. Copy sections; build oldId -> newId map.
		const sectionIdMap = new Map<string, string>();
		for (const s of sections) {
			const newSec = await insertSection(
				{
					workflowVersionId: draft.id,
					title: s.title,
					position: s.position,
				},
				tx,
			);
			sectionIdMap.set(s.id, newSec.id);
		}

		// 2b. Copy steps; build oldId -> newId map. dueAnchorStepId is intra-version,
		// so we remap; if it points at a step we haven't yet copied (shouldn't happen
		// with the schema as it stands, but defensive), we leave the anchor null for now
		// and patch it after all steps are copied. Same posture for dueSourceFieldId
		// (patched after fields).
		const stepIdMap = new Map<string, string>();
		for (const s of steps) {
			const newSt = await insertStep(
				{
					workflowVersionId: draft.id,
					sectionId: s.sectionId ? sectionIdMap.get(s.sectionId) ?? null : null,
					assignedRoleId: s.assignedRoleId,
					type: s.type,
					title: s.title,
					description: s.description,
					position: s.position,
					isRequired: s.isRequired,
					isStopTask: s.isStopTask,
					dueType: s.dueType,
					dueOffsetDays: s.dueOffsetDays,
					// Patched in the second pass once the full map is built.
					dueAnchorStepId: null,
					dueSourceFieldId: null,
				},
				tx,
			);
			stepIdMap.set(s.id, newSt.id);
		}

		// 2c. Copy fields; preserve `key` verbatim (D-018: keys are the stable identity
		// across the fork). Build oldId -> newId map for step.dueSourceFieldId remap.
		const fieldIdMap = new Map<string, string>();
		for (const f of fields) {
			const newF = await insertField(
				{
					workflowVersionId: draft.id,
					stepId: f.stepId ? stepIdMap.get(f.stepId) ?? null : null,
					key: f.key,
					label: f.label,
					fieldType: f.fieldType,
					config: f.config as Record<string, unknown> | null,
					isRequired: f.isRequired,
					position: f.position,
				},
				tx,
			);
			fieldIdMap.set(f.id, newF.id);
		}

		// 2d. Now that step + field maps are complete, patch any step rows that had
		// dueAnchorStepId / dueSourceFieldId in the source. updateStep is selective --
		// only the explicit fields below get written. In practice the patch list is
		// short (few steps use the deferred due-types).
		for (const s of steps) {
			const newStepId = stepIdMap.get(s.id);
			if (!newStepId) continue;
			const hasAnchor = s.dueAnchorStepId !== null;
			const hasSource = s.dueSourceFieldId !== null;
			if (!hasAnchor && !hasSource) continue;
			await updateStep(
				{
					stepId: newStepId,
					dueAnchorStepId: hasAnchor ? stepIdMap.get(s.dueAnchorStepId!) ?? null : undefined,
					dueSourceFieldId: hasSource ? fieldIdMap.get(s.dueSourceFieldId!) ?? null : undefined,
				},
				tx,
			);
		}

		// 2e. Copy step_dependency rows; remap both stepId and dependsOnStepId.
		for (const d of deps) {
			const newStep = stepIdMap.get(d.stepId);
			const newDep = stepIdMap.get(d.dependsOnStepId);
			if (!newStep || !newDep) continue; // Defensive: dep referenced an out-of-version step.
			await insertStepDependency(
				{ stepId: newStep, dependsOnStepId: newDep },
				tx,
			);
		}

		// 2f. Audit (Invariant #6).
		await writeAuditAndActivity(
			{
				organizationId: ctx.organizationId,
				actorUserId: ctx.userId,
				action: "workflow_version.fork_started",
				verb: "forked",
				entityType: "workflow_version",
				entityId: draft.id,
				changes: { fromVersionId: published.id, fromVersionNumber: published.versionNumber },
				metadata: {
					workflowId: input.workflowId,
					newVersionNumber: versionNumber,
					stepCount: steps.length,
					fieldCount: fields.length,
				},
				activityData: {
					newVersionNumber: versionNumber,
					sourceVersionNumber: published.versionNumber,
				},
			},
			tx,
		);

		return { draftVersionId: draft.id, draftVersionNumber: versionNumber };
	});

	return { ...forkResult, forked: true };
}

/** Delete a draft version. Refuses if it's the only version of the workflow (would orphan
 * the workflow row). Refuses if the version isn't draft. */
export async function discardDraft(
	ctx: PublishContext,
	input: { versionId: string },
): Promise<void> {
	const bundle = await db.query.workflowVersion.findFirst({
		where: (v, { eq: e }) => e(v.id, input.versionId),
		with: {
			workflow: {
				columns: { id: true, organizationId: true },
				with: { versions: { columns: { id: true, status: true } } },
			},
		},
	});
	if (!bundle || bundle.workflow.organizationId !== ctx.organizationId) {
		throw new WorkflowEngineError("VERSION_NOT_FOUND", "Workflow version not found.", {
			versionId: input.versionId,
		});
	}
	if (bundle.status !== "draft") {
		throw new WorkflowEngineError(
			"VERSION_NOT_DRAFT",
			`Cannot discard a ${bundle.status} version.`,
			{ versionId: bundle.id, status: bundle.status },
		);
	}
	const otherVersions = bundle.workflow.versions.filter((v) => v.id !== bundle.id);
	if (otherVersions.length === 0) {
		throw new WorkflowEngineError(
			"VERSION_NOT_DRAFT",
			"Cannot discard the only version of a workflow. Archive the workflow instead.",
			{ versionId: bundle.id, workflowId: bundle.workflow.id },
		);
	}

	await db.transaction(async (tx) => {
		await deleteVersion({ versionId: bundle.id }, tx);
		await writeAuditAndActivity(
			{
				organizationId: ctx.organizationId,
				actorUserId: ctx.userId,
				action: "workflow_version.draft_discarded",
				verb: "discarded",
				entityType: "workflow_version",
				entityId: bundle.id,
				changes: { fromStatus: "draft", toStatus: null },
				metadata: { workflowId: bundle.workflow.id },
				activityData: {},
			},
			tx,
		);
	});
}
