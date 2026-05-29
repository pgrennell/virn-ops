// packages/api/modules/playbooks/lib/step.ts
//
// Step CRUD operations on a playbook's draft version. All writes are guarded by:
//   1. Org-scoping (the step → version → playbook → organizationId chain)
//   2. Version-is-draft (publishedAt IS NULL) -- per D-018 snapshot immutability,
//      published versions are append-only and mutation is forbidden
//   3. Manual-edit provenance flip (D-040) -- any update through this lib
//      sets provenance='manually_edited' to protect against silent overwrite
//      from a future agents.regeneratePlaybookStep call (Phase 18c)
//
// `parentStepId` (branch sub-path) validation is layered:
//   - If non-null, the parent must exist in the SAME version
//   - The parent's type must be 'branch_on_data_set' (only branching steps can have
//     children); other types refuse with STEP_PARENT_NOT_BRANCH
//   - Self-reference (parentStepId === stepId on update) refuses with
//     STEP_PARENT_SELF_REFERENCE -- cycles beyond 1-hop would also be invalid but the
//     branch model only supports 1-hop (branch parent → its children); deeper
//     hierarchies are a Phase 13+ canvas concern, not a v1.5 step shape.

import {
	deletePlaybookStep as deletePlaybookStepQuery,
	getPlaybookForOrg,
	getPlaybookStepForOrg,
	getPlaybookStepsForOrg,
	getPlaybookVersionForOrg,
	insertPlaybookStep,
	listPlaybookStepsForVersion,
	reorderPlaybookSteps as reorderPlaybookStepsQuery,
	updatePlaybookStep as updatePlaybookStepQuery,
	writeAuditAndActivity,
	type PlaybookStepRow,
	type PlaybookStepType,
} from "@virn/database";

import { PlaybookEngineError } from "./errors";
import type { PlaybookContext } from "./playbook";

// ---------------------------------------------------------------------------
// Shared validation -- parent/branch + version-is-draft + version-org-scope.
// Centralized so create/update/delete/reorder all behave identically.
// ---------------------------------------------------------------------------

async function loadDraftVersionForOrgOrThrow(
	ctx: PlaybookContext,
	versionId: string,
): Promise<{ id: string; playbookId: string }> {
	const v = await getPlaybookVersionForOrg({
		organizationId: ctx.organizationId,
		versionId,
	});
	if (!v) {
		throw new PlaybookEngineError(
			"VERSION_NOT_FOUND",
			"Playbook version not found.",
			{ versionId },
		);
	}
	if (v.publishedAt !== null) {
		throw new PlaybookEngineError(
			"VERSION_PUBLISHED_IMMUTABLE",
			"Cannot mutate steps on a published playbook version. Fork a new draft first.",
			{ versionId },
		);
	}
	return { id: v.id, playbookId: v.playbookId };
}

async function validateParentStepInVersion(input: {
	versionId: string;
	parentStepId: string | null | undefined;
	selfStepId?: string;
	organizationId: string;
}): Promise<void> {
	if (!input.parentStepId) return;
	if (input.selfStepId && input.parentStepId === input.selfStepId) {
		throw new PlaybookEngineError(
			"STEP_PARENT_SELF_REFERENCE",
			"A step cannot be its own parent.",
			{ stepId: input.selfStepId },
		);
	}
	const parent = await getPlaybookStepForOrg({
		organizationId: input.organizationId,
		stepId: input.parentStepId,
	});
	if (!parent) {
		throw new PlaybookEngineError(
			"STEP_PARENT_INVALID",
			"Parent step not found.",
			{ parentStepId: input.parentStepId },
		);
	}
	if (parent.playbookVersionId !== input.versionId) {
		throw new PlaybookEngineError(
			"STEP_PARENT_INVALID",
			"Parent step belongs to a different playbook version.",
			{
				parentStepId: input.parentStepId,
				parentVersionId: parent.playbookVersionId,
				stepVersionId: input.versionId,
			},
		);
	}
	if (parent.type !== "branch_on_data_set") {
		throw new PlaybookEngineError(
			"STEP_PARENT_NOT_BRANCH",
			"Parent step must be a branch_on_data_set step. Other step types cannot have branch children.",
			{ parentStepId: input.parentStepId, parentType: parent.type },
		);
	}
}

// ---------------------------------------------------------------------------
// Create / update / delete / reorder
// ---------------------------------------------------------------------------

export interface CreatePlaybookStepInput {
	playbookVersionId: string;
	position: number;
	type: PlaybookStepType;
	config: unknown;
	branchLabel?: string | null;
	parentStepId?: string | null;
}

export async function createPlaybookStepOp(
	ctx: PlaybookContext,
	input: CreatePlaybookStepInput,
): Promise<{ stepId: string }> {
	const v = await loadDraftVersionForOrgOrThrow(ctx, input.playbookVersionId);

	// Validate that the parent step (if any) belongs to the same version and is a
	// branching step. selfStepId is irrelevant for create (the step doesn't exist
	// yet so self-reference is impossible).
	await validateParentStepInVersion({
		versionId: v.id,
		parentStepId: input.parentStepId,
		organizationId: ctx.organizationId,
	});

	const row = await insertPlaybookStep({
		playbookVersionId: v.id,
		position: input.position,
		type: input.type,
		config: input.config,
		branchLabel: input.branchLabel ?? null,
		parentStepId: input.parentStepId ?? null,
		// Manual builder UI inserts -- provenance='manually_edited' (the schema default).
		// AI authoring procedures (Phase 18c) call this same op but the agents lib
		// overrides provenance to 'ai_generated' through a separate helper.
	});

	await writeAuditAndActivity({
		organizationId: ctx.organizationId,
		actorUserId: ctx.userId,
		action: "playbook_step.created",
		verb: "created",
		entityType: "playbook_version",
		entityId: v.id,
		changes: {
			stepId: row.id,
			type: input.type,
			position: input.position,
			parentStepId: input.parentStepId ?? null,
		},
		metadata: { playbookId: v.playbookId },
	});

	return { stepId: row.id };
}

export interface UpdatePlaybookStepInput {
	stepId: string;
	position?: number;
	type?: PlaybookStepType;
	config?: unknown;
	branchLabel?: string | null;
	parentStepId?: string | null;
}

export async function updatePlaybookStepOp(
	ctx: PlaybookContext,
	input: UpdatePlaybookStepInput,
): Promise<void> {
	const existing = await getPlaybookStepForOrg({
		organizationId: ctx.organizationId,
		stepId: input.stepId,
	});
	if (!existing) {
		throw new PlaybookEngineError("STEP_NOT_FOUND", "Playbook step not found.", {
			stepId: input.stepId,
		});
	}
	// Confirm the parent version is still a draft (covers the race where a publish
	// happens between the step load and this update).
	await loadDraftVersionForOrgOrThrow(ctx, existing.playbookVersionId);

	if (input.parentStepId !== undefined) {
		await validateParentStepInVersion({
			versionId: existing.playbookVersionId,
			parentStepId: input.parentStepId,
			selfStepId: input.stepId,
			organizationId: ctx.organizationId,
		});
	}

	const changes: Record<string, unknown> = {};
	if (input.position !== undefined && input.position !== existing.position) {
		changes.position = { from: existing.position, to: input.position };
	}
	if (input.type !== undefined && input.type !== existing.type) {
		changes.type = { from: existing.type, to: input.type };
	}
	if (input.config !== undefined) {
		// Config is jsonb -- assume any provided value is a change. (Deep equality
		// would be expensive and rarely useful; the audit row just records that an
		// update happened.)
		changes.config = "updated";
	}
	if (
		input.branchLabel !== undefined &&
		input.branchLabel !== existing.branchLabel
	) {
		changes.branchLabel = { from: existing.branchLabel, to: input.branchLabel };
	}
	if (
		input.parentStepId !== undefined &&
		input.parentStepId !== existing.parentStepId
	) {
		changes.parentStepId = {
			from: existing.parentStepId,
			to: input.parentStepId,
		};
	}
	if (Object.keys(changes).length === 0) return; // No-op.

	await updatePlaybookStepQuery({
		stepId: input.stepId,
		position: input.position,
		type: input.type,
		config: input.config,
		branchLabel: input.branchLabel,
		parentStepId: input.parentStepId,
		// D-040: any manual edit flips provenance to 'manually_edited' (irreversible
		// in v1). This is the protection that prevents agents.regeneratePlaybookStep
		// (Phase 18c) from silently overwriting hand-edited content.
		provenance: "manually_edited",
	});

	await writeAuditAndActivity({
		organizationId: ctx.organizationId,
		actorUserId: ctx.userId,
		action: "playbook_step.updated",
		verb: "updated",
		entityType: "playbook_version",
		entityId: existing.playbookVersionId,
		changes: { stepId: input.stepId, ...changes },
		metadata: {},
	});
}

export async function deletePlaybookStepOp(
	ctx: PlaybookContext,
	input: { stepId: string },
): Promise<void> {
	const existing = await getPlaybookStepForOrg({
		organizationId: ctx.organizationId,
		stepId: input.stepId,
	});
	if (!existing) {
		throw new PlaybookEngineError("STEP_NOT_FOUND", "Playbook step not found.", {
			stepId: input.stepId,
		});
	}
	await loadDraftVersionForOrgOrThrow(ctx, existing.playbookVersionId);

	// Branch children: deleting a parent step cascades to its children via the
	// playbook_step.parent_step_id FK SET NULL behavior. We don't auto-delete the
	// children -- they become orphaned and the builder surfaces them for the author
	// to re-parent or delete. (Workflows' delete-step has similar dependency-aware
	// semantics; for v1 simplicity we just SET NULL the children.)

	await deletePlaybookStepQuery({ stepId: input.stepId });

	await writeAuditAndActivity({
		organizationId: ctx.organizationId,
		actorUserId: ctx.userId,
		action: "playbook_step.deleted",
		verb: "deleted",
		entityType: "playbook_version",
		entityId: existing.playbookVersionId,
		changes: { stepId: input.stepId, type: existing.type },
		metadata: { hadParent: existing.parentStepId !== null },
	});
}

export interface ReorderPlaybookStepsInput {
	playbookVersionId: string;
	items: ReadonlyArray<{ stepId: string; position: number }>;
}

/** Bulk reorder. The caller passes the full intended (stepId, position) ordering for
 * the version. We validate:
 *   1. Every step id belongs to the org + the same target version (no cross-version
 *      or cross-org reorder writes)
 *   2. Every existing step in the version is included in the reorder set
 *      (silent omission would orphan a step at its old position, which surfaces as a
 *      mysterious gap to the author)
 *
 * The actual position writes happen in a single transaction so concurrent reorders
 * either both succeed in independent transactions (LWW based on transaction commit
 * order -- the loser's writes are simply overwritten) or both fail cleanly. */
export async function reorderPlaybookStepsOp(
	ctx: PlaybookContext,
	input: ReorderPlaybookStepsInput,
): Promise<void> {
	const v = await loadDraftVersionForOrgOrThrow(ctx, input.playbookVersionId);

	if (input.items.length === 0) return; // Empty reorder is a no-op.

	const stepIds = input.items.map((i) => i.stepId);
	const seenStepIds = await getPlaybookStepsForOrg({
		organizationId: ctx.organizationId,
		stepIds,
	});

	// Every passed stepId must resolve + belong to the target version.
	for (const id of stepIds) {
		const row = seenStepIds.get(id);
		if (!row) {
			throw new PlaybookEngineError(
				"STEP_NOT_FOUND",
				"Reorder includes a step not in this org.",
				{ stepId: id },
			);
		}
		if (row.playbookVersionId !== v.id) {
			throw new PlaybookEngineError(
				"REORDER_STEPS_VERSION_MISMATCH",
				"Reorder includes a step from a different playbook version.",
				{
					stepId: id,
					stepVersionId: row.playbookVersionId,
					targetVersionId: v.id,
				},
			);
		}
	}

	// Verify completeness: every step in the version must be in the reorder set.
	// Without this, an author could silently drop a step out of the ordering.
	const allStepsInVersion = await listPlaybookStepsForVersion(v.id);
	const allIds = new Set(allStepsInVersion.map((s) => s.id));
	const passedIds = new Set(stepIds);
	for (const id of allIds) {
		if (!passedIds.has(id)) {
			throw new PlaybookEngineError(
				"REORDER_STEPS_INCOMPLETE",
				"Reorder must include every step in the playbook version.",
				{
					missingStepId: id,
					expectedCount: allIds.size,
					providedCount: passedIds.size,
				},
			);
		}
	}

	await reorderPlaybookStepsQuery({ items: input.items });

	await writeAuditAndActivity({
		organizationId: ctx.organizationId,
		actorUserId: ctx.userId,
		action: "playbook_step.reordered",
		verb: "reordered",
		entityType: "playbook_version",
		entityId: v.id,
		changes: { stepCount: input.items.length },
		metadata: { playbookId: v.playbookId },
	});
}

// Suppress unused-import lint by referencing the symbols we import but only use for
// types/relations (some compiler configs flag these without a use).
void getPlaybookForOrg;

export type { PlaybookStepRow, PlaybookStepType };
