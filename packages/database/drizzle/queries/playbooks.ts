// packages/database/drizzle/queries/playbooks.ts
//
// Phase 9.6 -- Playbook definition-layer DB helpers (PRD_PLAYBOOKS.md §8.1). Mirrors
// the entitysets/listings/vendors/agents CRUD shape: org-scoped, null-on-cross-org
// (prevents existence probing), soft delete on the playbook table.
//
// Scope of this file: CRUD for the top-level `playbook` row only. Version / step /
// run / run-step authoring + execution queries land in Phase 18a/b alongside the
// procedures that drive them -- writing them ahead of the procedure surface would be
// dead code, and the shape will inevitably shift once the actual builder UI exists.
//
// Conventions inherited from the existing query modules:
//   - Always scope reads by organizationId at the WHERE-clause level. Cross-org reads
//     return null, never throw -- prevents callers from learning whether an id exists
//     in another org by error-message probing.
//   - Updates patch only the fields explicitly provided; never blanket-overwrite.
//   - Soft delete sets `deletedAt = now()`; queries that should hide soft-deleted
//     rows include the `deletedAt IS NULL` predicate (the list helper here does).
//   - `is_active` is treated like any other patchable field, with one shortcut
//     procedure (`setPlaybookActive`) for the common toggle case -- this is the gate
//     the Inngest dispatcher reads on every trigger fire (PRD §6.4), so giving the
//     toggle its own helper keeps the call sites explicit.

import { and, asc, count, eq, inArray, isNull, sql } from "drizzle-orm";

import { db, type DbExecutor } from "../client";
import {
	playbook,
	playbookStep,
	playbookVersion,
} from "../schema/postgres";

export interface PlaybookRow {
	id: string;
	organizationId: string;
	name: string;
	description: string | null;
	entitySetIds: string[];
	reviewState: "draft" | "in_review" | "published" | "archived";
	isActive: boolean;
	aiAuthoringPromptId: string | null;
	createdBy: string | null;
	createdAt: Date;
	updatedAt: Date;
	deletedAt: Date | null;
}

function rowToPlaybook(row: typeof playbook.$inferSelect): PlaybookRow {
	return {
		id: row.id,
		organizationId: row.organizationId,
		name: row.name,
		description: row.description,
		entitySetIds: row.entitySetIds,
		reviewState: row.reviewState,
		isActive: row.isActive,
		aiAuthoringPromptId: row.aiAuthoringPromptId,
		createdBy: row.createdBy,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		deletedAt: row.deletedAt,
	};
}

/** List the org's playbooks, excluding soft-deleted rows. Ordered by name. The
 * builder UI calls this for the Playbooks tab in the Library; the Inngest dispatcher
 * (Phase 18b) uses a separate query that ALSO filters by `is_active = true`. */
export async function listPlaybooksForOrg(input: {
	organizationId: string;
}): Promise<PlaybookRow[]> {
	const rows = await db
		.select()
		.from(playbook)
		.where(
			and(
				eq(playbook.organizationId, input.organizationId),
				isNull(playbook.deletedAt),
			),
		)
		.orderBy(asc(playbook.name));
	return rows.map(rowToPlaybook);
}

/** Fetch a single playbook scoped to the org. Returns null if missing, cross-org,
 * or soft-deleted -- prevents existence probing across orgs. */
export async function getPlaybookForOrg(input: {
	organizationId: string;
	playbookId: string;
}): Promise<PlaybookRow | null> {
	const [row] = await db
		.select()
		.from(playbook)
		.where(
			and(
				eq(playbook.id, input.playbookId),
				eq(playbook.organizationId, input.organizationId),
				isNull(playbook.deletedAt),
			),
		);
	return row ? rowToPlaybook(row) : null;
}

export interface CreatePlaybookInput {
	organizationId: string;
	name: string;
	description?: string | null;
	entitySetIds?: string[];
	createdByUserId?: string | null;
}

/** Insert a new playbook. Defaults `isActive=false` (per PRD §6.1 -- newly authored
 * Playbooks must be explicitly enabled before the dispatcher will fire them) and
 * `reviewState='draft'`. Throws on (org, name) collision per `uq_playbook_org_name`;
 * callers should catch and map to a CONFLICT response. */
export async function createPlaybook(
	input: CreatePlaybookInput,
): Promise<PlaybookRow> {
	const [row] = await db
		.insert(playbook)
		.values({
			organizationId: input.organizationId,
			name: input.name,
			description: input.description ?? null,
			entitySetIds: input.entitySetIds ?? [],
			createdBy: input.createdByUserId ?? null,
			// reviewState + isActive use their schema defaults ('draft' / false).
		})
		.returning();
	return rowToPlaybook(row);
}

export interface UpdatePlaybookInput {
	organizationId: string;
	playbookId: string;
	name?: string;
	description?: string | null;
	entitySetIds?: string[];
	// reviewState transitions go through a dedicated state-machine helper that
	// lands in Phase 18a (alongside the publish + submit-for-review procedures);
	// the raw column setter is deliberately NOT exposed here to prevent bypassing
	// the audit-row writes that the state-machine helper performs.
}

/** Patch mutable fields. organizationId / id are never patchable. Returns null if
 * missing or cross-org. */
export async function updatePlaybook(
	input: UpdatePlaybookInput,
): Promise<PlaybookRow | null> {
	const patch: Record<string, unknown> = { updatedAt: new Date() };
	if (input.name !== undefined) patch.name = input.name;
	if (input.description !== undefined) patch.description = input.description;
	if (input.entitySetIds !== undefined) patch.entitySetIds = input.entitySetIds;

	const result = await db
		.update(playbook)
		.set(patch)
		.where(
			and(
				eq(playbook.id, input.playbookId),
				eq(playbook.organizationId, input.organizationId),
				isNull(playbook.deletedAt),
			),
		)
		.returning({ id: playbook.id });
	if (result.length === 0) return null;
	return getPlaybookForOrg(input);
}

/** Flip the dispatcher gate (PRD §6.4). The Inngest dispatcher (Phase 18b) reads
 * `is_active` on every trigger fire; disabled playbooks are skipped. Splitting this
 * out as its own helper keeps "I want to enable/disable a playbook" call sites
 * explicit and grep-able (vs a generic field patch). Returns null if missing or
 * cross-org. */
export async function setPlaybookActive(input: {
	organizationId: string;
	playbookId: string;
	isActive: boolean;
}): Promise<PlaybookRow | null> {
	const result = await db
		.update(playbook)
		.set({ isActive: input.isActive, updatedAt: new Date() })
		.where(
			and(
				eq(playbook.id, input.playbookId),
				eq(playbook.organizationId, input.organizationId),
				isNull(playbook.deletedAt),
			),
		)
		.returning({ id: playbook.id });
	if (result.length === 0) return null;
	return getPlaybookForOrg(input);
}

/** Soft delete (sets deletedAt; rows stay for audit / history reads). The dispatcher
 * (Phase 18b) won't fire deleted playbooks because the trigger lookup joins through
 * `listPlaybooksForOrg`-equivalent filters that exclude soft-deleted rows. In-flight
 * `playbook_run`s are NOT cancelled by this delete -- they finish their orchestration
 * naturally (preserve the audit trail). Returns whether anything was deleted. */
export async function softDeletePlaybook(input: {
	organizationId: string;
	playbookId: string;
}): Promise<{ deleted: boolean }> {
	const result = await db
		.update(playbook)
		.set({ deletedAt: new Date(), updatedAt: new Date() })
		.where(
			and(
				eq(playbook.id, input.playbookId),
				eq(playbook.organizationId, input.organizationId),
				isNull(playbook.deletedAt),
			),
		)
		.returning({ id: playbook.id });
	return { deleted: result.length > 0 };
}

// ---------------------------------------------------------------------------
// Playbook + initial draft version (mirrors insertWorkflowWithDraft from
// queries/workflows.ts). A playbook is meaningless without a version to point
// at, so the two land together transactionally. Default trigger_type='manual'
// + null trigger_event -- the v1 builder UI will let the operator change these
// before publish. Default is_active=false (per playbook.is_active schema default).
// ---------------------------------------------------------------------------

export interface InsertPlaybookWithDraftInput {
	organizationId: string;
	name: string;
	description: string | null;
	createdByUserId: string;
	aiAuthoringPromptId?: string | null;
}

export async function insertPlaybookWithDraft(
	input: InsertPlaybookWithDraftInput,
	executor: DbExecutor = db,
): Promise<{ playbookId: string; versionId: string }> {
	return executor.transaction(async (tx) => {
		const [pb] = await tx
			.insert(playbook)
			.values({
				organizationId: input.organizationId,
				name: input.name,
				description: input.description,
				createdBy: input.createdByUserId,
				aiAuthoringPromptId: input.aiAuthoringPromptId ?? null,
				// isActive + reviewState use schema defaults (false, 'draft').
			})
			.returning({ id: playbook.id });

		const [v] = await tx
			.insert(playbookVersion)
			.values({
				playbookId: pb.id,
				versionNumber: 1,
				triggerType: "manual",
				// triggerEvent null + triggerConfig '{}' use defaults.
			})
			.returning({ id: playbookVersion.id });

		return { playbookId: pb.id, versionId: v.id };
	});
}

// ---------------------------------------------------------------------------
// Version lookups -- "current draft" is the unpublished version with the
// highest versionNumber; "current published" is the published version with the
// highest versionNumber. Mirrors the workflow/workflow_version relationship.
// ---------------------------------------------------------------------------

export interface PlaybookVersionRow {
	id: string;
	playbookId: string;
	versionNumber: number;
	triggerType: "manual" | "lifecycle_event";
	triggerEvent:
		| "run.completed"
		| "run.state_changed"
		| "listing.entity_set_added"
		| "vendor.upserted"
		| null;
	triggerConfig: unknown;
	dedupWindowHours: number | null;
	publishedAt: Date | null;
	publishedBy: string | null;
	createdAt: Date;
	updatedAt: Date;
}

function rowToPlaybookVersion(
	row: typeof playbookVersion.$inferSelect,
): PlaybookVersionRow {
	return {
		id: row.id,
		playbookId: row.playbookId,
		versionNumber: row.versionNumber,
		triggerType: row.triggerType,
		triggerEvent: row.triggerEvent,
		triggerConfig: row.triggerConfig,
		dedupWindowHours: row.dedupWindowHours,
		publishedAt: row.publishedAt,
		publishedBy: row.publishedBy,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

/** The most recent un-published version for a playbook (status flag for playbook_version
 * isn't an enum -- a row is "draft" if publishedAt IS NULL). Returns null when the
 * playbook has no open draft (i.e. its latest version was published; future Phase 18a
 * editPublished work will fork a new draft). */
export async function getCurrentDraftPlaybookVersion(
	playbookId: string,
	executor: DbExecutor = db,
): Promise<PlaybookVersionRow | null> {
	const [row] = await executor
		.select()
		.from(playbookVersion)
		.where(
			and(
				eq(playbookVersion.playbookId, playbookId),
				isNull(playbookVersion.publishedAt),
			),
		)
		.orderBy(sql`${playbookVersion.versionNumber} desc`)
		.limit(1);
	return row ? rowToPlaybookVersion(row) : null;
}

/** Org-scoped lookup of a playbook version. Returns null on cross-org access (joins
 * through the playbook row to honor the organizationId on the parent). */
export async function getPlaybookVersionForOrg(input: {
	organizationId: string;
	versionId: string;
}): Promise<PlaybookVersionRow | null> {
	const [row] = await db
		.select({ v: playbookVersion })
		.from(playbookVersion)
		.innerJoin(playbook, eq(playbook.id, playbookVersion.playbookId))
		.where(
			and(
				eq(playbookVersion.id, input.versionId),
				eq(playbook.organizationId, input.organizationId),
				isNull(playbook.deletedAt),
			),
		);
	return row ? rowToPlaybookVersion(row.v) : null;
}

/** Count steps in a playbook version. Used by Phase 18a draft-state guards
 * ("can't publish empty playbook") and the dispatcher's pre-flight check
 * once Phase 18b ships. */
export async function countStepsInPlaybookVersion(
	versionId: string,
): Promise<number> {
	const rows = await db
		.select({ count: count() })
		.from(playbookStep)
		.where(eq(playbookStep.playbookVersionId, versionId));
	return Number(rows[0]?.count ?? 0);
}

// ---------------------------------------------------------------------------
// Playbook step CRUD (operates on a specific playbook_version_id; the caller
// is responsible for resolving the right version via the version-lookup
// helpers above). Mirrors workflow step CRUD (queries/workflows.ts) -- the
// difference is the type-specific `config` jsonb + the branch_label /
// parent_step_id self-reference for `branch_on_data_set` sub-paths.
// ---------------------------------------------------------------------------

export type PlaybookStepType =
	| "wait_for_duration"
	| "wait_for_event"
	| "launch_workflow"
	| "send_notification"
	| "branch_on_data_set"
	| "write_to_data_set";

export type PlaybookStepProvenance = "ai_generated" | "manually_edited";

export interface PlaybookStepRow {
	id: string;
	playbookVersionId: string;
	position: number;
	type: PlaybookStepType;
	config: unknown;
	branchLabel: string | null;
	parentStepId: string | null;
	provenance: PlaybookStepProvenance;
	createdAt: Date;
	updatedAt: Date;
}

function rowToPlaybookStep(row: typeof playbookStep.$inferSelect): PlaybookStepRow {
	return {
		id: row.id,
		playbookVersionId: row.playbookVersionId,
		position: row.position,
		type: row.type,
		config: row.config,
		branchLabel: row.branchLabel,
		parentStepId: row.parentStepId,
		provenance: row.provenance,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

/** List all steps in a playbook version, ordered by (position asc). Branch children
 * are interleaved with their parent's position; the caller is responsible for nesting
 * them visually using `parentStepId`. */
export async function listPlaybookStepsForVersion(
	versionId: string,
	executor: DbExecutor = db,
): Promise<PlaybookStepRow[]> {
	const rows = await executor
		.select()
		.from(playbookStep)
		.where(eq(playbookStep.playbookVersionId, versionId))
		.orderBy(asc(playbookStep.position));
	return rows.map(rowToPlaybookStep);
}

/** Fetch a single playbook step, joined to its version + parent playbook for
 * org-scoping. Returns null on cross-org access. */
export async function getPlaybookStepForOrg(input: {
	organizationId: string;
	stepId: string;
}): Promise<PlaybookStepRow | null> {
	const [row] = await db
		.select({ s: playbookStep })
		.from(playbookStep)
		.innerJoin(
			playbookVersion,
			eq(playbookVersion.id, playbookStep.playbookVersionId),
		)
		.innerJoin(playbook, eq(playbook.id, playbookVersion.playbookId))
		.where(
			and(
				eq(playbookStep.id, input.stepId),
				eq(playbook.organizationId, input.organizationId),
				isNull(playbook.deletedAt),
			),
		);
	return row ? rowToPlaybookStep(row.s) : null;
}

export interface InsertPlaybookStepInput {
	playbookVersionId: string;
	position: number;
	type: PlaybookStepType;
	config: unknown;
	branchLabel?: string | null;
	parentStepId?: string | null;
	provenance?: PlaybookStepProvenance;
}

/** Insert a step into a playbook version. `provenance` defaults to 'manually_edited'
 * (matches the schema default) -- AI authoring procedures (Phase 18c) opt in to
 * 'ai_generated' explicitly. */
export async function insertPlaybookStep(
	input: InsertPlaybookStepInput,
	executor: DbExecutor = db,
): Promise<PlaybookStepRow> {
	const [row] = await executor
		.insert(playbookStep)
		.values({
			playbookVersionId: input.playbookVersionId,
			position: input.position,
			type: input.type,
			config: input.config as Record<string, unknown>,
			branchLabel: input.branchLabel ?? null,
			parentStepId: input.parentStepId ?? null,
			provenance: input.provenance ?? "manually_edited",
		})
		.returning();
	return rowToPlaybookStep(row);
}

export interface UpdatePlaybookStepInput {
	stepId: string;
	position?: number;
	type?: PlaybookStepType;
	config?: unknown;
	branchLabel?: string | null;
	parentStepId?: string | null;
	/** D-040: any manual edit through the builder UI flips provenance back to
	 * 'manually_edited'. The lib layer is responsible for setting this -- the
	 * helper just propagates whatever it's given. */
	provenance?: PlaybookStepProvenance;
}

export async function updatePlaybookStep(
	input: UpdatePlaybookStepInput,
	executor: DbExecutor = db,
): Promise<void> {
	const patch: Record<string, unknown> = { updatedAt: new Date() };
	if (input.position !== undefined) patch.position = input.position;
	if (input.type !== undefined) patch.type = input.type;
	if (input.config !== undefined) patch.config = input.config;
	if (input.branchLabel !== undefined) patch.branchLabel = input.branchLabel;
	if (input.parentStepId !== undefined) patch.parentStepId = input.parentStepId;
	if (input.provenance !== undefined) patch.provenance = input.provenance;

	await executor
		.update(playbookStep)
		.set(patch)
		.where(eq(playbookStep.id, input.stepId));
}

export async function deletePlaybookStep(
	input: { stepId: string },
	executor: DbExecutor = db,
): Promise<void> {
	await executor.delete(playbookStep).where(eq(playbookStep.id, input.stepId));
}

/** Bulk reorder: set `position` for a list of (stepId, newPosition) pairs in one
 * transaction. Callers are responsible for passing a complete, gap-free order for
 * the version (this helper trusts the input -- it doesn't validate that every step
 * in the version is included or that positions are unique). */
export async function reorderPlaybookSteps(
	input: { items: ReadonlyArray<{ stepId: string; position: number }> },
	executor: DbExecutor = db,
): Promise<void> {
	if (input.items.length === 0) return;
	await executor.transaction(async (tx) => {
		for (const { stepId, position } of input.items) {
			await tx
				.update(playbookStep)
				.set({ position, updatedAt: new Date() })
				.where(eq(playbookStep.id, stepId));
		}
	});
}

/** Bulk fetch steps by id, scoped to org (joins through version + playbook). Returns
 * a Map for cheap O(1) lookup; missing ids simply aren't in the map. Used by the lib
 * layer when validating that a set of step ids all belong to the caller's org +
 * playbook before applying a multi-step operation (e.g. reorder). */
export async function getPlaybookStepsForOrg(input: {
	organizationId: string;
	stepIds: ReadonlyArray<string>;
}): Promise<Map<string, PlaybookStepRow>> {
	if (input.stepIds.length === 0) return new Map();
	const rows = await db
		.select({ s: playbookStep })
		.from(playbookStep)
		.innerJoin(
			playbookVersion,
			eq(playbookVersion.id, playbookStep.playbookVersionId),
		)
		.innerJoin(playbook, eq(playbook.id, playbookVersion.playbookId))
		.where(
			and(
				inArray(playbookStep.id, [...input.stepIds]),
				eq(playbook.organizationId, input.organizationId),
				isNull(playbook.deletedAt),
			),
		);
	const map = new Map<string, PlaybookStepRow>();
	for (const row of rows) map.set(row.s.id, rowToPlaybookStep(row.s));
	return map;
}
