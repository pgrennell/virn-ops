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

import { and, asc, eq, isNull } from "drizzle-orm";

import { db } from "../client";
import { playbook } from "../schema/postgres";

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
