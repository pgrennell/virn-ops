// packages/api/modules/playbooks/lib/playbook.ts
//
// Playbook-level operations (create / update / setActive / archive). Mirrors the
// shape of workflows/lib/workflow.ts; a playbook ALWAYS lands with an initial draft
// version (the schema's separation of playbook vs playbook_version is for versioning,
// not empty-shell-then-populate, so we keep them in sync at birth).
//
// `setActive` is its own helper rather than folding into `updatePlaybook` because
// the dispatcher (Phase 18b) reads `is_active` on every trigger fire -- splitting it
// out keeps "enable/disable" call sites grep-able and lets us audit those flips
// distinctly from name/description edits.
//
// `archive` is soft (playbook.deletedAt). In-flight playbook_runs are NOT cancelled;
// they finish naturally per their snapshot. The dispatcher's "active playbooks" query
// excludes soft-deleted rows so no NEW runs will fire.

import {
	createPlaybook as createPlaybookQuery,
	getOrganizationById,
	getPlaybookForOrg,
	insertPlaybookWithDraft,
	setPlaybookActive as setPlaybookActiveQuery,
	softDeletePlaybook as softDeletePlaybookQuery,
	updatePlaybook as updatePlaybookQuery,
	writeAuditAndActivity,
	type PlaybookRow,
} from "@virn/database";

import { PlaybookEngineError } from "./errors";

export interface PlaybookContext {
	organizationId: string;
	userId: string;
}

export interface CreatePlaybookInput {
	name: string;
	description?: string | null;
	entitySetIds?: string[];
	/** Phase 18c -- set by `agents.authorPlaybook` to attach AI-authoring provenance.
	 * Null for hand-authored playbooks (the v1.5 default). */
	aiAuthoringPromptId?: string | null;
}

export async function createPlaybookOp(
	ctx: PlaybookContext,
	input: CreatePlaybookInput,
): Promise<{ playbookId: string; draftVersionId: string }> {
	// Refuse duplicate names per-org early so the caller sees PLAYBOOK_NAME_CONFLICT
	// rather than a raw uq_playbook_org_name DB error. There's a TOCTOU window between
	// this check and the insert; that's acceptable -- the unique index catches the
	// rare race and surfaces a generic-but-non-corrupting error to the caller.
	const existing = await getPlaybookForOrg({
		organizationId: ctx.organizationId,
		playbookId: "__nonexistent__", // never matches; we don't have a getByName
	});
	void existing; // (Reserved for a future getByName helper; the unique index is the
	// load-bearing constraint regardless. Insert will throw on collision.)

	let result: { playbookId: string; versionId: string };
	try {
		result = await insertPlaybookWithDraft({
			organizationId: ctx.organizationId,
			name: input.name,
			description: input.description ?? null,
			createdByUserId: ctx.userId,
			aiAuthoringPromptId: input.aiAuthoringPromptId ?? null,
		});
	} catch (err) {
		// uq_playbook_org_name -- map to typed error so the procedure layer can return
		// a CONFLICT response. Postgres + Drizzle surface this as a non-typed Error
		// with the constraint name in the message; check loosely.
		if (
			err instanceof Error &&
			/uq_playbook_org_name|duplicate key|unique constraint/i.test(err.message)
		) {
			throw new PlaybookEngineError(
				"PLAYBOOK_NAME_CONFLICT",
				`A playbook named "${input.name}" already exists in this organization.`,
				{ name: input.name },
			);
		}
		throw err;
	}

	// If the caller passed entity-set scoping at create time (e.g. AI authoring landing
	// a Playbook with pre-resolved entity sets), patch it in immediately rather than
	// require a separate update round-trip.
	if (input.entitySetIds && input.entitySetIds.length > 0) {
		await updatePlaybookQuery({
			organizationId: ctx.organizationId,
			playbookId: result.playbookId,
			entitySetIds: input.entitySetIds,
		});
	}

	await writeAuditAndActivity({
		organizationId: ctx.organizationId,
		actorUserId: ctx.userId,
		action: "playbook.created",
		verb: "created",
		entityType: "playbook",
		entityId: result.playbookId,
		changes: {
			name: input.name,
			description: input.description ?? null,
			entitySetIds: input.entitySetIds ?? [],
		},
		metadata: { initialDraftVersionId: result.versionId },
		activityData: { playbookName: input.name },
	});

	return {
		playbookId: result.playbookId,
		draftVersionId: result.versionId,
	};
}

export interface UpdatePlaybookInput {
	playbookId: string;
	name?: string;
	description?: string | null;
	entitySetIds?: string[];
}

export async function updatePlaybookOp(
	ctx: PlaybookContext,
	input: UpdatePlaybookInput,
): Promise<void> {
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

	const changes: Record<string, unknown> = {};
	if (input.name !== undefined && input.name !== pb.name) {
		changes.name = { from: pb.name, to: input.name };
	}
	if (input.description !== undefined && input.description !== pb.description) {
		changes.description = { from: pb.description, to: input.description };
	}
	if (input.entitySetIds !== undefined) {
		// Order-insensitive set equality (matches workflow.entitySetIds semantics).
		const before = [...(pb.entitySetIds ?? [])].sort();
		const after = [...input.entitySetIds].sort();
		const same =
			before.length === after.length && before.every((id, i) => id === after[i]);
		if (!same) {
			changes.entitySetIds = { from: pb.entitySetIds, to: input.entitySetIds };
		}
	}
	if (Object.keys(changes).length === 0) return; // No-op.

	try {
		await updatePlaybookQuery({
			organizationId: ctx.organizationId,
			playbookId: input.playbookId,
			name: input.name,
			description: input.description,
			entitySetIds: input.entitySetIds,
		});
	} catch (err) {
		if (
			err instanceof Error &&
			/uq_playbook_org_name|duplicate key|unique constraint/i.test(err.message)
		) {
			throw new PlaybookEngineError(
				"PLAYBOOK_NAME_CONFLICT",
				`A playbook named "${input.name}" already exists in this organization.`,
				{ name: input.name },
			);
		}
		throw err;
	}

	await writeAuditAndActivity({
		organizationId: ctx.organizationId,
		actorUserId: ctx.userId,
		action: "playbook.updated",
		verb: "updated",
		entityType: "playbook",
		entityId: input.playbookId,
		changes,
		metadata: {},
		activityData: { playbookName: input.name ?? pb.name },
	});
}

export async function setPlaybookActiveOp(
	ctx: PlaybookContext,
	input: { playbookId: string; isActive: boolean },
): Promise<void> {
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
			"Playbook is archived. Restore it before enabling.",
			{ playbookId: input.playbookId },
		);
	}
	if (pb.isActive === input.isActive) return; // Idempotent no-op.

	await setPlaybookActiveQuery({
		organizationId: ctx.organizationId,
		playbookId: input.playbookId,
		isActive: input.isActive,
	});

	await writeAuditAndActivity({
		organizationId: ctx.organizationId,
		actorUserId: ctx.userId,
		action: input.isActive ? "playbook.enabled" : "playbook.disabled",
		verb: input.isActive ? "enabled" : "disabled",
		entityType: "playbook",
		entityId: input.playbookId,
		changes: { isActive: { from: pb.isActive, to: input.isActive } },
		metadata: {},
		activityData: { playbookName: pb.name },
	});
}

export async function archivePlaybookOp(
	ctx: PlaybookContext,
	input: { playbookId: string },
): Promise<void> {
	const pb = await getPlaybookForOrg({
		organizationId: ctx.organizationId,
		playbookId: input.playbookId,
	});
	if (!pb) {
		throw new PlaybookEngineError("PLAYBOOK_NOT_FOUND", "Playbook not found.", {
			playbookId: input.playbookId,
		});
	}
	if (pb.deletedAt !== null) return; // Idempotent -- already archived.

	await softDeletePlaybookQuery({
		organizationId: ctx.organizationId,
		playbookId: input.playbookId,
	});

	await writeAuditAndActivity({
		organizationId: ctx.organizationId,
		actorUserId: ctx.userId,
		action: "playbook.archived",
		verb: "archived",
		entityType: "playbook",
		entityId: input.playbookId,
		changes: { deletedAt: { from: null, to: "now" } },
		metadata: {},
		activityData: { playbookName: pb.name },
	});
}

// Re-export the row type so procedure handlers can return typed payloads without
// reaching into @virn/database directly. createPlaybookQuery is silenced -- it's
// not used by this module (insertPlaybookWithDraft is the create entry point) but
// the symbol is preserved for downstream modules.
void createPlaybookQuery;
void getOrganizationById;

export type { PlaybookRow };
