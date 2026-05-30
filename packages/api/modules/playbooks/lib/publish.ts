// packages/api/modules/playbooks/lib/publish.ts
//
// Phase 18a -- Playbook publish dance. Mirrors workflows/lib/publish.ts but
// simpler:
//   - No sections (Playbooks are a flat vertical step list)
//   - No fields (Playbooks don't collect kickoff data; triggers carry payload)
//   - No version-level archive enum (a version is "draft" iff publishedAt IS
//     NULL; "published" iff publishedAt IS NOT NULL)
//
// Three operations:
//   1. publishVersion(versionId)  -- atomic draft -> published transition.
//      Refuses on PUBLISH_RACE / VERSION_NOT_DRAFT / VERSION_HAS_NO_STEPS.
//   2. editPublished(playbookId)  -- resume the open draft, or fork a fresh
//      draft from the latest published version (deep-copies the steps).
//      Enforces the "at most one open draft per playbook" invariant.
//   3. discardDraft(playbookId)   -- delete the open draft (CASCADE drops
//      its steps). Refuses on PLAYBOOK_HAS_NO_DRAFT.
//
// Audit + activity rows fire on each transition. Step deep-copy in editPublished
// uses the same transaction as the version insert so a failure mid-copy rolls
// the new draft back rather than leaving an empty version.

import {
	countStepsInPlaybookVersion,
	db,
	deletePlaybookVersion,
	getCurrentDraftPlaybookVersion,
	getLatestPublishedPlaybookVersion,
	getPlaybookForOrg,
	getPlaybookVersionForOrg,
	insertPlaybookDraftVersionFrom,
	insertPlaybookStep,
	listPlaybookStepsForVersion,
	nextPlaybookVersionNumber,
	publishPlaybookVersionRow,
	updatePlaybookStep,
	writeAuditAndActivity,
} from "@virn/database";

import { PlaybookEngineError } from "./errors";

export interface PublishContext {
	organizationId: string;
	userId: string;
}

// ---------------------------------------------------------------------------
// publishVersion
// ---------------------------------------------------------------------------

export interface PublishPlaybookVersionResult {
	versionId: string;
	versionNumber: number;
}

/** Promote a playbook draft version to published. Refuses on:
 *   - VERSION_NOT_FOUND        version isn't in this org
 *   - VERSION_NOT_DRAFT        version is already published
 *   - VERSION_HAS_NO_STEPS     publishing an empty playbook is almost certainly
 *                              a mistake; the dispatcher would no-op anyway
 *   - PUBLISH_RACE             another publisher won the WHERE-null guard
 */
export async function publishPlaybookVersion(
	ctx: PublishContext,
	input: { versionId: string },
): Promise<PublishPlaybookVersionResult> {
	const v = await getPlaybookVersionForOrg({
		organizationId: ctx.organizationId,
		versionId: input.versionId,
	});
	if (!v) {
		throw new PlaybookEngineError(
			"VERSION_NOT_FOUND",
			"Playbook version not found.",
			{ versionId: input.versionId },
		);
	}
	if (v.publishedAt !== null) {
		throw new PlaybookEngineError(
			"VERSION_NOT_DRAFT",
			"Cannot publish a version that's already published.",
			{ versionId: v.id, publishedAt: v.publishedAt.toISOString() },
		);
	}

	const stepCount = await countStepsInPlaybookVersion(v.id);
	if (stepCount === 0) {
		throw new PlaybookEngineError(
			"VERSION_HAS_NO_STEPS",
			"Cannot publish a playbook with no steps. Add at least one step first.",
			{ versionId: v.id },
		);
	}

	const result = await db.transaction(async (tx) => {
		const didPublish = await publishPlaybookVersionRow(
			{ versionId: v.id, publishedByUserId: ctx.userId },
			tx,
		);
		if (!didPublish) {
			throw new PlaybookEngineError(
				"PUBLISH_RACE",
				"This version was already published by another writer. Refetch to see the latest state.",
				{ versionId: v.id },
			);
		}
		await writeAuditAndActivity(
			{
				organizationId: ctx.organizationId,
				actorUserId: ctx.userId,
				action: "playbook_version.published",
				verb: "published",
				entityType: "playbook_version",
				entityId: v.id,
				changes: { publishedAt: { from: null, to: "now" } },
				metadata: {
					playbookId: v.playbookId,
					versionNumber: v.versionNumber,
					stepCount,
				},
				activityData: { versionNumber: v.versionNumber },
			},
			tx,
		);
		return { versionId: v.id, versionNumber: v.versionNumber };
	});

	return result;
}

// ---------------------------------------------------------------------------
// editPublished
// ---------------------------------------------------------------------------

export interface EditPublishedPlaybookResult {
	draftVersionId: string;
	draftVersionNumber: number;
	/** True iff this call FORKED a new draft from the latest published version.
	 * False if it resumed an existing open draft. Drives the toast copy in
	 * the Builder UI. */
	forked: boolean;
}

/** Resume the playbook's open draft, or fork a new one from the latest
 * published version. At most ONE open draft per playbook -- enforced here
 * via the getCurrentDraftPlaybookVersion check before the fork. */
export async function editPublishedPlaybook(
	ctx: PublishContext,
	input: { playbookId: string },
): Promise<EditPublishedPlaybookResult> {
	const pb = await getPlaybookForOrg({
		organizationId: ctx.organizationId,
		playbookId: input.playbookId,
	});
	if (!pb) {
		throw new PlaybookEngineError("PLAYBOOK_NOT_FOUND", "Playbook not found.", {
			playbookId: input.playbookId,
		});
	}
	if (pb.deletedAt !== null) {
		throw new PlaybookEngineError(
			"PLAYBOOK_ARCHIVED",
			"Playbook is archived. Restore it before editing.",
			{ playbookId: input.playbookId },
		);
	}

	// 1. Resume path: an open draft already exists.
	const existingDraft = await getCurrentDraftPlaybookVersion(input.playbookId);
	if (existingDraft) {
		return {
			draftVersionId: existingDraft.id,
			draftVersionNumber: existingDraft.versionNumber,
			forked: false,
		};
	}

	// 2. Fork path: no draft -> deep-copy the latest published into a new draft.
	const published = await getLatestPublishedPlaybookVersion(input.playbookId);
	if (!published) {
		// Mirrors workflows' shape: when there's no published version AND no
		// draft, the playbook is in a broken state (the create path always
		// lands an initial draft). Treat as "no draft to resume".
		throw new PlaybookEngineError(
			"PLAYBOOK_HAS_NO_DRAFT",
			"Playbook has no draft to resume and no published version to fork from.",
			{ playbookId: input.playbookId },
		);
	}

	const sourceSteps = await listPlaybookStepsForVersion(published.id);

	const forkResult = await db.transaction(async (tx) => {
		const versionNumber = await nextPlaybookVersionNumber(input.playbookId, tx);
		const draft = await insertPlaybookDraftVersionFrom(
			{
				playbookId: input.playbookId,
				versionNumber,
				source: {
					triggerType: published.triggerType,
					triggerEvent: published.triggerEvent,
					triggerConfig: published.triggerConfig,
					dedupWindowHours: published.dedupWindowHours,
				},
			},
			tx,
		);

		// Deep-copy steps preserving order + branch_label + parent_step_id
		// remapping. Two-pass: insert all steps with parent_step_id=null,
		// then UPDATE the parent links once the new ids are known.
		const stepIdMap = new Map<string, string>();
		for (const s of sourceSteps) {
			const inserted = await insertPlaybookStep(
				{
					playbookVersionId: draft.id,
					position: s.position,
					type: s.type,
					config: s.config,
					branchLabel: s.branchLabel,
					// parent_step_id intentionally null on first pass.
					parentStepId: null,
					provenance: s.provenance,
				},
				tx,
			);
			stepIdMap.set(s.id, inserted.id);
		}
		// Second pass: remap parent_step_id for steps that had one. updatePlaybookStep
		// preserves provenance unless we explicitly pass it; we don't pass it here
		// so the deep-copied 'ai_generated' / 'manually_edited' values flow through
		// unchanged.
		for (const s of sourceSteps) {
			if (s.parentStepId === null) continue;
			const newId = stepIdMap.get(s.id);
			const newParentId = stepIdMap.get(s.parentStepId);
			if (!newId || !newParentId) continue;
			await updatePlaybookStep(
				{ stepId: newId, parentStepId: newParentId },
				tx,
			);
		}

		await writeAuditAndActivity(
			{
				organizationId: ctx.organizationId,
				actorUserId: ctx.userId,
				action: "playbook_version.forked",
				verb: "forked",
				entityType: "playbook_version",
				entityId: draft.id,
				changes: {
					forkedFromVersionId: published.id,
					forkedFromVersionNumber: published.versionNumber,
					newVersionNumber: versionNumber,
					stepCount: sourceSteps.length,
				},
				metadata: { playbookId: input.playbookId },
				activityData: { versionNumber },
			},
			tx,
		);

		return { draftVersionId: draft.id, draftVersionNumber: versionNumber };
	});

	return {
		draftVersionId: forkResult.draftVersionId,
		draftVersionNumber: forkResult.draftVersionNumber,
		forked: true,
	};
}

// ---------------------------------------------------------------------------
// discardDraft
// ---------------------------------------------------------------------------

/** Delete the playbook's open draft version. CASCADE drops its steps. Refuses
 * with PLAYBOOK_HAS_NO_DRAFT when no draft exists (the operator likely
 * navigated stale state -- the UI should reload). */
export async function discardPlaybookDraft(
	ctx: PublishContext,
	input: { playbookId: string },
): Promise<{ discardedVersionId: string; discardedVersionNumber: number }> {
	const pb = await getPlaybookForOrg({
		organizationId: ctx.organizationId,
		playbookId: input.playbookId,
	});
	if (!pb) {
		throw new PlaybookEngineError("PLAYBOOK_NOT_FOUND", "Playbook not found.", {
			playbookId: input.playbookId,
		});
	}
	const draft = await getCurrentDraftPlaybookVersion(input.playbookId);
	if (!draft) {
		throw new PlaybookEngineError(
			"PLAYBOOK_HAS_NO_DRAFT",
			"No open draft to discard.",
			{ playbookId: input.playbookId },
		);
	}

	await db.transaction(async (tx) => {
		await deletePlaybookVersion({ versionId: draft.id }, tx);
		await writeAuditAndActivity(
			{
				organizationId: ctx.organizationId,
				actorUserId: ctx.userId,
				action: "playbook_version.discarded",
				verb: "discarded draft",
				entityType: "playbook_version",
				entityId: draft.id,
				metadata: {
					playbookId: input.playbookId,
					versionNumber: draft.versionNumber,
				},
				activityData: { versionNumber: draft.versionNumber },
			},
			tx,
		);
	});

	return {
		discardedVersionId: draft.id,
		discardedVersionNumber: draft.versionNumber,
	};
}
