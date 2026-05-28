// packages/database/drizzle/queries/workflows.ts
//
// Definition-layer DB helpers for the Workflow Builder (UX_SPEC §4.3) and the run engine
// snapshot reads. Lives in @virn/database so that:
//   - launchRun (api/modules/runs/lib) keeps its single import surface,
//   - the new Workflow Builder API module reads/writes only via these helpers (no direct
//     drizzle in api/lib code),
//   - the Library API module (Pass-4-onwards) can consume the same listing helpers.
//
// Snapshot semantics (Invariants #3 / #4): a `workflow_version` of status="published" is
// immutable -- the run engine snapshots it. The builder mutates ONLY drafts. The lib layer
// holds a single `assertVersionIsDraft` chokepoint; this file only enumerates the data and
// trusts the caller has guarded.
//
// Field-key lifecycle (Invariant #5): each `field.key` is unique within its version,
// auto-slugged from the label on create, editable while UNREFERENCED, locked the moment a
// schema reference exists. Today the locking surfaces are:
//   - automation_condition.sourceFieldId  -- show-when condition references the field
//   - step.dueSourceFieldId               -- due-rule pulls a date from the field
// (Merge variables in description text, e.g. `{{customer_name}}`, are NOT scanned here --
// the feature isn't shipped yet. When it ships, extend `findFieldReferencers` to scan
// text; see D-017.)
//
// Step references: `step.dueAnchorStepId` points at another step for `offset_from_step`
// due-rules (deferred). Step deletion enumerates referencers via the same pattern.

import { and, asc, count, desc, eq, inArray, isNull, max, ne, sql } from "drizzle-orm";

import { db, type DbExecutor } from "../client";
import {
	automationCondition,
	field,
	section,
	step,
	stepDependency,
	workflow,
	workflowRole,
	workflowVersion,
} from "../schema/postgres";

// ---------------------------------------------------------------------------
// Workflow-level reads
// ---------------------------------------------------------------------------

/** Fetch a workflow scoped to the org. Returns null if not found or not in this org. */
export async function getWorkflowForOrg(organizationId: string, workflowId: string) {
	return (
		(await db.query.workflow.findFirst({
			where: (w, { and: a, eq: e }) => a(e(w.id, workflowId), e(w.organizationId, organizationId)),
		})) ?? null
	);
}

export interface WorkflowListRow {
	id: string;
	type: "procedure" | "document" | "policy" | "form";
	title: string;
	description: string | null;
	isActive: boolean;
	createdAt: Date;
	updatedAt: Date;
	hasDraft: boolean;
	latestPublishedVersionNumber: number | null;
	/** The workflow_version.id of the latest published version. Pinned in the payload
	 * so the Launcher can pass an EXPLICIT versionId to runs.launch -- closes the
	 * publish-during-fill-window race (form rendered from v3, a v4 publish lands
	 * while user fills, server-resolve would snapshot v4 with v3's filled fields).
	 * D-018: published versions are immutable, so a pinned id is always launch-safe;
	 * launchRun already validates an explicit versionId is published. */
	latestPublishedVersionId: string | null;
	latestPublishedAt: Date | null;
	/** Phase 12.1 -- true when the workflow originated from agents.authorWorkflow
	 * (workflow.aiAuthoringPromptId IS NOT NULL). The Library row renders a
	 * Sparkles chip so admins can see at a glance which workflows came from AI.
	 * Derived in the query rather than fetched on the row read so a stale
	 * provenance row (FK is `on delete set null`) flips this to false. */
	aiAuthored: boolean;
}

/** List workflows in an org (Library consumer + Builder index). Excludes soft-deleted rows
 * by default. Surfaces "has open draft" + "latest published version" because they drive
 * the row-action choice in the Library (Run published vs. Edit draft). */
export async function listWorkflowsForOrg(input: {
	organizationId: string;
	includeArchived?: boolean;
	limit?: number;
	offset?: number;
}): Promise<WorkflowListRow[]> {
	const limit = input.limit ?? 100;
	const offset = input.offset ?? 0;

	const rows = await db
		.select({
			id: workflow.id,
			type: workflow.type,
			title: workflow.title,
			description: workflow.description,
			isActive: workflow.isActive,
			createdAt: workflow.createdAt,
			updatedAt: workflow.updatedAt,
			deletedAt: workflow.deletedAt,
			aiAuthoringPromptId: workflow.aiAuthoringPromptId,
		})
		.from(workflow)
		.where(eq(workflow.organizationId, input.organizationId))
		.orderBy(desc(workflow.updatedAt))
		.limit(limit)
		.offset(offset);

	const visible = input.includeArchived ? rows : rows.filter((r) => r.deletedAt === null);
	if (visible.length === 0) return [];

	const ids = visible.map((r) => r.id);
	const versions = await db
		.select({
			id: workflowVersion.id,
			workflowId: workflowVersion.workflowId,
			status: workflowVersion.status,
			versionNumber: workflowVersion.versionNumber,
			publishedAt: workflowVersion.publishedAt,
		})
		.from(workflowVersion)
		.where(inArray(workflowVersion.workflowId, ids));

	const draftSet = new Set<string>();
	const latestPub = new Map<
		string,
		{ id: string; versionNumber: number; publishedAt: Date | null }
	>();
	for (const v of versions) {
		if (v.status === "draft") {
			draftSet.add(v.workflowId);
		} else if (v.status === "published") {
			const cur = latestPub.get(v.workflowId);
			if (!cur || v.versionNumber > cur.versionNumber) {
				latestPub.set(v.workflowId, {
					id: v.id,
					versionNumber: v.versionNumber,
					publishedAt: v.publishedAt,
				});
			}
		}
	}

	return visible.map((r) => {
		const pub = latestPub.get(r.id);
		return {
			id: r.id,
			type: r.type,
			title: r.title,
			description: r.description,
			isActive: r.isActive,
			createdAt: r.createdAt,
			updatedAt: r.updatedAt,
			hasDraft: draftSet.has(r.id),
			latestPublishedVersionNumber: pub?.versionNumber ?? null,
			latestPublishedVersionId: pub?.id ?? null,
			latestPublishedAt: pub?.publishedAt ?? null,
			aiAuthored: r.aiAuthoringPromptId !== null,
		};
	});
}

// ---------------------------------------------------------------------------
// Entity-context workflow listing (Phase 9.5e / PRD §6.2)
// ---------------------------------------------------------------------------

export interface EntityContextWorkflowRow {
	id: string;
	type: "procedure" | "document" | "policy" | "form";
	title: string;
	description: string | null;
	isActive: boolean;
	latestPublishedVersionId: string | null;
	latestPublishedVersionNumber: number | null;
	latestPublishedAt: Date | null;
	/** The workflow's declared scope. Empty array = "applies to any entity". Surfaced
	 * to the launcher so it can render "scoped to: STR penthouses" badges next to
	 * filtered results. */
	entitySetIds: string[];
}

/** List workflows that apply to a specific entity, per the PRD §6.2 set-intersection
 * filter: `workflow.entity_set_ids = '{}' OR workflow.entity_set_ids ∩ entity_sets ≠ ∅`.
 * An entity with no set memberships only sees unscoped workflows (a workflow scoped to
 * "STR penthouses" rightly does NOT surface for an uncategorized listing).
 *
 * Implementation: single query using Postgres array operators. The COALESCE on the
 * subquery handles "entity has zero memberships" — `array_agg` returns NULL over an
 * empty set, and `&&` against NULL yields NULL (falsey), so without COALESCE the
 * empty-set case would also reject unscoped workflows. We want unscoped workflows
 * always.
 *
 * Returns published-only by default (no draft workflows surface to the launcher).
 * Includes latestPublishedVersionId so the launcher can pin the version into
 * runs.launch and close the publish-during-fill-window race (D-018). */
export async function listWorkflowsForEntity(input: {
	organizationId: string;
	entityType: "listing";
	entityId: string;
	limit?: number;
	offset?: number;
}): Promise<EntityContextWorkflowRow[]> {
	const limit = input.limit ?? 100;
	const offset = input.offset ?? 0;

	// Postgres-specific: array overlap (`&&`) + cardinality + COALESCE on subquery.
	// Kept inline as raw SQL because Drizzle's typed query builder doesn't model the
	// array operators ergonomically.
	const rows = await db.execute(sql`
		SELECT
			w.id,
			w.type,
			w.title,
			w.description,
			w.is_active AS "isActive",
			w.entity_set_ids AS "entitySetIds"
		FROM workflow w
		WHERE w.organization_id = ${input.organizationId}
			AND w.deleted_at IS NULL
			AND w.is_active = true
			AND (
				cardinality(w.entity_set_ids) = 0
				OR w.entity_set_ids && COALESCE(
					(
						SELECT array_agg(esm.entity_set_id)
						FROM entity_set_member esm
						WHERE esm.entity_type = ${input.entityType}
							AND esm.entity_id = ${input.entityId}
					),
					'{}'::text[]
				)
			)
		ORDER BY w.updated_at DESC
		LIMIT ${limit}
		OFFSET ${offset}
	`);

	const wfRows = (rows as unknown as { rows: Array<Record<string, unknown>> }).rows;
	if (wfRows.length === 0) return [];

	// Second pass: latest-published version per workflow. Same shape as
	// listWorkflowsForOrg's pub-version reduction.
	const ids = wfRows.map((r) => r.id as string);
	const versions = await db
		.select({
			id: workflowVersion.id,
			workflowId: workflowVersion.workflowId,
			status: workflowVersion.status,
			versionNumber: workflowVersion.versionNumber,
			publishedAt: workflowVersion.publishedAt,
		})
		.from(workflowVersion)
		.where(inArray(workflowVersion.workflowId, ids));

	const latestPub = new Map<
		string,
		{ id: string; versionNumber: number; publishedAt: Date | null }
	>();
	for (const v of versions) {
		if (v.status !== "published") continue;
		const cur = latestPub.get(v.workflowId);
		if (!cur || v.versionNumber > cur.versionNumber) {
			latestPub.set(v.workflowId, {
				id: v.id,
				versionNumber: v.versionNumber,
				publishedAt: v.publishedAt,
			});
		}
	}

	// Filter out workflows with no published version -- the launcher should never
	// surface "you can run this" for a workflow that has no runnable version.
	return wfRows
		.filter((r) => latestPub.has(r.id as string))
		.map((r) => {
			const pub = latestPub.get(r.id as string)!;
			return {
				id: r.id as string,
				type: r.type as "procedure" | "document" | "policy" | "form",
				title: r.title as string,
				description: (r.description as string | null) ?? null,
				isActive: r.isActive as boolean,
				entitySetIds: ((r.entitySetIds as string[] | null) ?? []) as string[],
				latestPublishedVersionId: pub.id,
				latestPublishedVersionNumber: pub.versionNumber,
				latestPublishedAt: pub.publishedAt,
			};
		});
}

export interface WorkflowWithVersionsRow {
	workflow: typeof workflow.$inferSelect;
	currentDraft: typeof workflowVersion.$inferSelect | null;
	latestPublished: typeof workflowVersion.$inferSelect | null;
	allVersions: Array<typeof workflowVersion.$inferSelect>;
	/** Phase 12.1 -- AI authoring provenance summary. Populated only when
	 * `workflow.aiAuthoringPromptId` is non-null AND the prompt row still exists
	 * (the FK is `on delete set null`, so a pruned provenance row leaves the column
	 * null and this stays null). Surfaces the model id + when the prompt was
	 * captured for the Builder's "authored with AI" indicator -- the rest of the
	 * prompt body lives on `ai_authoring_prompt` and isn't loaded here. */
	aiAuthoring: { promptId: string; model: string; createdAt: Date } | null;
}

/** Hydrated workflow record + every version in newest-first order, plus shortcuts to the
 * current draft (at most one — enforced by editPublished/createWorkflow) and the latest
 * published. Used by the Builder index + by `editPublished` to decide resume-vs-fork. */
export async function getWorkflowWithVersions(
	organizationId: string,
	workflowId: string,
): Promise<WorkflowWithVersionsRow | null> {
	const wf = await getWorkflowForOrg(organizationId, workflowId);
	if (!wf) return null;

	const allVersions = await db
		.select()
		.from(workflowVersion)
		.where(eq(workflowVersion.workflowId, wf.id))
		.orderBy(desc(workflowVersion.versionNumber));

	const drafts = allVersions.filter((v) => v.status === "draft");
	if (drafts.length > 1) {
		// Defense-in-depth: the publish/fork transactions enforce at-most-one draft.
		// Logging instead of throwing lets readers still see something useful; tests
		// will catch the underlying drift.
		console.warn(
			`getWorkflowWithVersions: workflow ${wf.id} has ${drafts.length} drafts; using newest.`,
		);
	}
	const currentDraft = drafts[0] ?? null;
	const latestPublished = allVersions.find((v) => v.status === "published") ?? null;

	// Phase 12.1 -- enrich with AI authoring provenance when present. Single small
	// findFirst on the indexed PK; skip entirely when the FK is null (the common
	// case: hand-authored or pack-installed workflows).
	let aiAuthoring: WorkflowWithVersionsRow["aiAuthoring"] = null;
	if (wf.aiAuthoringPromptId !== null) {
		const ap = await db.query.aiAuthoringPrompt.findFirst({
			where: (a, { eq: e }) => e(a.id, wf.aiAuthoringPromptId as string),
			columns: { id: true, model: true, createdAt: true },
		});
		if (ap) {
			aiAuthoring = { promptId: ap.id, model: ap.model, createdAt: ap.createdAt };
		}
	}

	return { workflow: wf, currentDraft, latestPublished, allVersions, aiAuthoring };
}

// ---------------------------------------------------------------------------
// Version reads — published path (run-engine snapshot consumer)
// ---------------------------------------------------------------------------

/** Find the most recent published version of a workflow. Returns null if none is published. */
export async function getLatestPublishedWorkflowVersion(workflowId: string) {
	return (
		(await db.query.workflowVersion.findFirst({
			where: (v, { and: a, eq: e }) => a(e(v.workflowId, workflowId), e(v.status, "published")),
			orderBy: (v, { desc }) => [desc(v.versionNumber)],
		})) ?? null
	);
}

/** Fetch a specific version. Caller verifies status before launching/editing. */
export async function getWorkflowVersionById(versionId: string) {
	return (
		(await db.query.workflowVersion.findFirst({
			where: (v, { eq: e }) => e(v.id, versionId),
		})) ?? null
	);
}

/** Pull everything needed to snapshot a launch: all steps (with due-config), all fields
 * (kickoff + step-scoped), and all step_dependency rows for the version. Single-object
 * shape consumed by launchRun -- do NOT change without updating that consumer. */
export async function getVersionLaunchBundle(workflowVersionId: string) {
	const [steps, fields, deps] = await Promise.all([
		db.query.step.findMany({
			where: (s, { eq: e }) => e(s.workflowVersionId, workflowVersionId),
			orderBy: (s, { asc }) => [asc(s.position)],
		}),
		db.query.field.findMany({
			where: (f, { eq: e }) => e(f.workflowVersionId, workflowVersionId),
			orderBy: (f, { asc }) => [asc(f.position)],
		}),
		db
			.select({
				stepId: stepDependency.stepId,
				dependsOnStepId: stepDependency.dependsOnStepId,
			})
			.from(stepDependency)
			.innerJoin(
				sql`(SELECT id FROM step WHERE workflow_version_id = ${workflowVersionId}) AS s`,
				sql`s.id = ${stepDependency.stepId}`,
			),
	]);
	return { steps, fields, deps };
}

// ---------------------------------------------------------------------------
// Version reads — draft path (Builder canvas consumer)
// ---------------------------------------------------------------------------

export interface VersionEditBundleField {
	id: string;
	stepId: string | null;
	key: string;
	label: string;
	fieldType:
		| "text"
		| "textarea"
		| "number"
		| "date"
		| "select"
		| "multiselect"
		| "file"
		| "image"
		| "signature"
		| "member"
		| "lookup";
	config: Record<string, unknown> | null;
	isRequired: boolean;
	position: number;
	/** True iff the field is referenced by a schema reference today (condition or due
	 * source) -- the key can't be renamed. Computed in the same call so the canvas can
	 * paint the locked-key chip without re-fetching. */
	isKeyLocked: boolean;
}

export interface VersionEditBundle {
	version: typeof workflowVersion.$inferSelect;
	sections: Array<typeof section.$inferSelect>;
	steps: Array<typeof step.$inferSelect>;
	fields: VersionEditBundleField[];
	dependencies: Array<{ stepId: string; dependsOnStepId: string }>;
}

/** The Builder's canvas read. Returns the full editable shape PLUS the per-field locked
 * status -- single round-trip for the entire screen. Status (draft / published) is on the
 * returned version so the UI can decide whether to enable mutations. */
export async function getVersionEditBundle(
	workflowVersionId: string,
): Promise<VersionEditBundle | null> {
	const version = await getWorkflowVersionById(workflowVersionId);
	if (!version) return null;

	const [sections, steps, fields, deps] = await Promise.all([
		db
			.select()
			.from(section)
			.where(eq(section.workflowVersionId, workflowVersionId))
			.orderBy(asc(section.position)),
		db
			.select()
			.from(step)
			.where(eq(step.workflowVersionId, workflowVersionId))
			.orderBy(asc(step.position)),
		db
			.select()
			.from(field)
			.where(eq(field.workflowVersionId, workflowVersionId))
			.orderBy(asc(field.position)),
		db
			.select({
				stepId: stepDependency.stepId,
				dependsOnStepId: stepDependency.dependsOnStepId,
			})
			.from(stepDependency)
			.innerJoin(
				sql`(SELECT id FROM step WHERE workflow_version_id = ${workflowVersionId}) AS s`,
				sql`s.id = ${stepDependency.stepId}`,
			),
	]);

	// Lock computation: probe both reference surfaces in two batched queries.
	const lockedFieldIds = await findLockedFieldIds(fields.map((f) => f.id));

	return {
		version,
		sections,
		steps,
		fields: fields.map((f) => ({
			id: f.id,
			stepId: f.stepId,
			key: f.key,
			label: f.label,
			fieldType: f.fieldType,
			config: f.config as Record<string, unknown> | null,
			isRequired: f.isRequired,
			position: f.position,
			isKeyLocked: lockedFieldIds.has(f.id),
		})),
		dependencies: deps,
	};
}

/** Return the subset of `fieldIds` that are referenced by any schema reference today --
 * conditions or due-rules. Batched: two `inArray` queries regardless of input size. */
export async function findLockedFieldIds(fieldIds: string[]): Promise<Set<string>> {
	if (fieldIds.length === 0) return new Set();
	const [condRefs, dueRefs] = await Promise.all([
		db
			.select({ fieldId: automationCondition.sourceFieldId })
			.from(automationCondition)
			.where(inArray(automationCondition.sourceFieldId, fieldIds)),
		db
			.select({ fieldId: step.dueSourceFieldId })
			.from(step)
			.where(inArray(step.dueSourceFieldId, fieldIds)),
	]);
	const locked = new Set<string>();
	for (const r of condRefs) if (r.fieldId) locked.add(r.fieldId);
	for (const r of dueRefs) if (r.fieldId) locked.add(r.fieldId);
	return locked;
}

export interface FieldReferencer {
	type: "condition" | "due_source";
	/** The step that holds the reference (or the rule's host step, when we can resolve it).
	 * The UI uses this to point the user at "what to clear first." */
	stepId: string | null;
}

/** Enumerate, in detail, what references a single field today. Used by `update-field`
 * (rename guard) and `delete-field` (refuse-on-reference) to produce an actionable error
 * payload. Returns [] when nothing references the field. */
export async function findFieldReferencers(fieldId: string): Promise<FieldReferencer[]> {
	const [condRefs, dueRefs] = await Promise.all([
		db
			.select({ ruleId: automationCondition.ruleId })
			.from(automationCondition)
			.where(eq(automationCondition.sourceFieldId, fieldId)),
		db
			.select({ stepId: step.id })
			.from(step)
			.where(eq(step.dueSourceFieldId, fieldId)),
	]);
	const out: FieldReferencer[] = [];
	for (const _ of condRefs) out.push({ type: "condition", stepId: null });
	for (const r of dueRefs) out.push({ type: "due_source", stepId: r.stepId });
	return out;
}

export interface StepReferencer {
	type: "step_dependency_blocker" | "due_anchor";
	/** The step that holds the reference (the dependent step, or the step with the
	 * due-anchor pointer). */
	stepId: string;
}

/** Enumerate references to a step. Today: step_dependency.dependsOnStepId rows
 * (other steps that wait for this one) + step.dueAnchorStepId references
 * (offset_from_step due rules — feature deferred but the guard is wired now so the
 * authoring surface refuses delete the moment the consumer ships). */
export async function findStepReferencers(stepId: string): Promise<StepReferencer[]> {
	const [depRows, anchorRows] = await Promise.all([
		db
			.select({ stepId: stepDependency.stepId })
			.from(stepDependency)
			.where(eq(stepDependency.dependsOnStepId, stepId)),
		db
			.select({ stepId: step.id })
			.from(step)
			.where(eq(step.dueAnchorStepId, stepId)),
	]);
	const out: StepReferencer[] = [];
	for (const r of depRows) out.push({ type: "step_dependency_blocker", stepId: r.stepId });
	for (const r of anchorRows) out.push({ type: "due_anchor", stepId: r.stepId });
	return out;
}

// ---------------------------------------------------------------------------
// Workflow CRUD
// ---------------------------------------------------------------------------

/** Insert a workflow row + an initial draft `workflow_version` (number=1, status=draft).
 * Transactional -- a workflow is meaningless without a version to point at.
 *
 * Phase 12.1: `aiAuthoringPromptId` (optional) attaches provenance for AI-authored
 * workflows. Set when the workflow originated from `agents.authorWorkflow`; left null
 * for hand-authored or pack-installed workflows. */
export async function insertWorkflowWithDraft(
	input: {
		organizationId: string;
		title: string;
		description: string | null;
		type: "procedure" | "document" | "policy" | "form";
		createdBy: string;
		aiAuthoringPromptId?: string | null;
	},
	executor: DbExecutor = db,
): Promise<{ workflowId: string; versionId: string }> {
	return await executor.transaction(async (tx) => {
		const [wf] = await tx
			.insert(workflow)
			.values({
				organizationId: input.organizationId,
				title: input.title,
				description: input.description,
				type: input.type,
				createdBy: input.createdBy,
				aiAuthoringPromptId: input.aiAuthoringPromptId ?? null,
			})
			.returning({ id: workflow.id });

		const [v] = await tx
			.insert(workflowVersion)
			.values({
				workflowId: wf.id,
				versionNumber: 1,
				status: "draft",
			})
			.returning({ id: workflowVersion.id });

		return { workflowId: wf.id, versionId: v.id };
	});
}

/** Update workflow-level fields (title, description, type, isActive). Org-level
 * concerns; never touches a `workflow_version`. */
export async function updateWorkflow(
	input: {
		organizationId: string;
		workflowId: string;
		title?: string;
		description?: string | null;
		type?: "procedure" | "document" | "policy" | "form";
		isActive?: boolean;
		/** Phase 9.5e: entity-set scope. Empty array preserves pre-v1.5 behavior (workflow
		 * applies to any entity); non-empty narrows to runs launched from an entity whose
		 * set memberships intersect this list. Pass `undefined` to leave unchanged. */
		entitySetIds?: string[];
	},
	executor: DbExecutor = db,
): Promise<void> {
	const patch: Record<string, unknown> = {};
	if (input.title !== undefined) patch.title = input.title;
	if (input.description !== undefined) patch.description = input.description;
	if (input.type !== undefined) patch.type = input.type;
	if (input.isActive !== undefined) patch.isActive = input.isActive;
	if (input.entitySetIds !== undefined) patch.entitySetIds = input.entitySetIds;
	if (Object.keys(patch).length === 0) return;

	await executor
		.update(workflow)
		.set(patch)
		.where(
			and(eq(workflow.id, input.workflowId), eq(workflow.organizationId, input.organizationId)),
		);
}

/** Soft-archive a workflow: sets `workflow.deletedAt`. This is the WORKFLOW-LEVEL archive
 * (remove the whole authored asset) -- distinct from version-level `status='archived'`
 * which retires one published version while the workflow itself stays. */
export async function archiveWorkflow(
	input: { organizationId: string; workflowId: string },
	executor: DbExecutor = db,
): Promise<void> {
	await executor
		.update(workflow)
		.set({ deletedAt: new Date() })
		.where(
			and(eq(workflow.id, input.workflowId), eq(workflow.organizationId, input.organizationId)),
		);
}

// ---------------------------------------------------------------------------
// Review-state transitions (Phase 9.5g / PRD §6.6)
// ---------------------------------------------------------------------------

export type ReviewState = "draft" | "in_review" | "published" | "archived";

/** Atomic state transition that refuses (returns `{ ok: false }`) when the row's
 * current state doesn't match `fromState`. The WHERE-on-from-state closes the same
 * race the publish path closes -- two concurrent transitions can't both "succeed"
 * without one of them observing the wrong source state.
 *
 * The transition is REQUIRED to be valid per the state machine:
 *   draft     -> in_review (submitForReview, when concierge-review is on)
 *   in_review -> published (approveReview, internally also runs publishVersion)
 *   in_review -> draft     (sendBackToDraft)
 *   draft     -> published (publishVersion, when concierge-review is off)
 *
 * Caller responsibility: validate the (from, to) pair is a legal arrow before
 * calling. This helper just makes the write atomic; it doesn't enforce the graph
 * (keeps DB layer free of business logic). */
/** Count steps in a workflow version. Used by approveReview (Phase 9.5g) for the
 * pre-flight check that catches the VERSION_HAS_NO_STEPS publish-fail case BEFORE any
 * state mutation -- avoids the desync of reviewState='published' with a still-draft
 * version that dogfooding caught on 2026-05-27. */
export async function countStepsInVersion(versionId: string): Promise<number> {
	const rows = await db
		.select({ count: count() })
		.from(step)
		.where(eq(step.workflowVersionId, versionId));
	return Number(rows[0]?.count ?? 0);
}

export async function transitionWorkflowReviewState(
	input: {
		organizationId: string;
		workflowId: string;
		fromState: ReviewState;
		toState: ReviewState;
	},
	executor: DbExecutor = db,
): Promise<{ ok: boolean }> {
	const result = await executor
		.update(workflow)
		.set({ reviewState: input.toState })
		.where(
			and(
				eq(workflow.id, input.workflowId),
				eq(workflow.organizationId, input.organizationId),
				eq(workflow.reviewState, input.fromState),
			),
		)
		.returning({ id: workflow.id });
	return { ok: result.length > 0 };
}

export interface WorkflowInReviewRow {
	id: string;
	title: string;
	description: string | null;
	type: "procedure" | "document" | "policy" | "form";
	updatedAt: Date;
	/** The current draft version (the one waiting to be approved). Null only if the
	 * draft was deleted between submit and review-time, which is a data-integrity
	 * issue the UI surfaces as "stale review request." */
	currentDraftVersionId: string | null;
	currentDraftVersionNumber: number | null;
	/** Latest published version (used by the review pane to render a diff against). */
	latestPublishedVersionId: string | null;
	latestPublishedVersionNumber: number | null;
}

/** Admin review inbox -- workflows currently waiting for approval. Sorted by oldest-
 * updated-first so the staleness signal (long pending) is visible at the top.
 * Org-scoped via the workflow row's organizationId. */
export async function listWorkflowsInReview(
	organizationId: string,
): Promise<WorkflowInReviewRow[]> {
	const rows = await db
		.select({
			id: workflow.id,
			title: workflow.title,
			description: workflow.description,
			type: workflow.type,
			updatedAt: workflow.updatedAt,
		})
		.from(workflow)
		.where(
			and(
				eq(workflow.organizationId, organizationId),
				eq(workflow.reviewState, "in_review"),
				isNull(workflow.deletedAt),
			),
		)
		.orderBy(asc(workflow.updatedAt));

	if (rows.length === 0) return [];

	const ids = rows.map((r) => r.id);
	const versions = await db
		.select({
			id: workflowVersion.id,
			workflowId: workflowVersion.workflowId,
			status: workflowVersion.status,
			versionNumber: workflowVersion.versionNumber,
		})
		.from(workflowVersion)
		.where(inArray(workflowVersion.workflowId, ids));

	const draftByWf = new Map<string, { id: string; versionNumber: number }>();
	const latestPubByWf = new Map<string, { id: string; versionNumber: number }>();
	for (const v of versions) {
		if (v.status === "draft") {
			// At most one draft per workflow (enforced by editPublished/createWorkflow).
			draftByWf.set(v.workflowId, { id: v.id, versionNumber: v.versionNumber });
		} else if (v.status === "published") {
			const cur = latestPubByWf.get(v.workflowId);
			if (!cur || v.versionNumber > cur.versionNumber) {
				latestPubByWf.set(v.workflowId, {
					id: v.id,
					versionNumber: v.versionNumber,
				});
			}
		}
	}

	return rows.map((r) => {
		const draft = draftByWf.get(r.id);
		const pub = latestPubByWf.get(r.id);
		return {
			id: r.id,
			title: r.title,
			description: r.description,
			type: r.type,
			updatedAt: r.updatedAt,
			currentDraftVersionId: draft?.id ?? null,
			currentDraftVersionNumber: draft?.versionNumber ?? null,
			latestPublishedVersionId: pub?.id ?? null,
			latestPublishedVersionNumber: pub?.versionNumber ?? null,
		};
	});
}

// ---------------------------------------------------------------------------
// Section CRUD (draft-only -- caller enforces via assertVersionIsDraft)
// ---------------------------------------------------------------------------

export async function insertSection(
	input: { workflowVersionId: string; title: string; position?: number },
	executor: DbExecutor = db,
): Promise<{ id: string }> {
	const [row] = await executor
		.insert(section)
		.values({
			workflowVersionId: input.workflowVersionId,
			title: input.title,
			position: input.position ?? (await nextSectionPosition(input.workflowVersionId, executor)),
		})
		.returning({ id: section.id });
	return row;
}

export async function updateSection(
	input: { sectionId: string; title?: string; position?: number },
	executor: DbExecutor = db,
): Promise<void> {
	const patch: Record<string, unknown> = {};
	if (input.title !== undefined) patch.title = input.title;
	if (input.position !== undefined) patch.position = input.position;
	if (Object.keys(patch).length === 0) return;
	await executor.update(section).set(patch).where(eq(section.id, input.sectionId));
}

export async function deleteSection(
	input: { sectionId: string },
	executor: DbExecutor = db,
): Promise<void> {
	// Schema sets step.sectionId -> set null; we don't need to clear it manually.
	await executor.delete(section).where(eq(section.id, input.sectionId));
}

async function nextSectionPosition(
	workflowVersionId: string,
	executor: DbExecutor,
): Promise<number> {
	const [row] = await executor
		.select({ max: max(section.position) })
		.from(section)
		.where(eq(section.workflowVersionId, workflowVersionId));
	return ((row?.max ?? -1) as number) + 1;
}

// ---------------------------------------------------------------------------
// Step CRUD
// ---------------------------------------------------------------------------

export interface InsertStepInput {
	workflowVersionId: string;
	sectionId?: string | null;
	assignedRoleId?: string | null;
	type?: "task" | "approval" | "heading" | "one_off" | "code" | "ai";
	title: string;
	description?: string | null;
	position?: number;
	isRequired?: boolean;
	isStopTask?: boolean;
	dueType?: "none" | "offset_from_start" | "offset_from_step" | "from_date_field";
	dueOffsetDays?: number | null;
	dueAnchorStepId?: string | null;
	dueSourceFieldId?: string | null;
}

export async function insertStep(
	input: InsertStepInput,
	executor: DbExecutor = db,
): Promise<{ id: string }> {
	const [row] = await executor
		.insert(step)
		.values({
			workflowVersionId: input.workflowVersionId,
			sectionId: input.sectionId ?? null,
			assignedRoleId: input.assignedRoleId ?? null,
			type: input.type ?? "task",
			title: input.title,
			description: input.description ?? null,
			position: input.position ?? (await nextStepPosition(input.workflowVersionId, executor)),
			isRequired: input.isRequired ?? true,
			isStopTask: input.isStopTask ?? false,
			dueType: input.dueType ?? "none",
			dueOffsetDays: input.dueOffsetDays ?? null,
			dueAnchorStepId: input.dueAnchorStepId ?? null,
			dueSourceFieldId: input.dueSourceFieldId ?? null,
		})
		.returning({ id: step.id });
	return row;
}

export interface UpdateStepInput {
	stepId: string;
	sectionId?: string | null;
	assignedRoleId?: string | null;
	type?: "task" | "approval" | "heading" | "one_off" | "code" | "ai";
	title?: string;
	description?: string | null;
	position?: number;
	isRequired?: boolean;
	isStopTask?: boolean;
	dueType?: "none" | "offset_from_start" | "offset_from_step" | "from_date_field";
	dueOffsetDays?: number | null;
	dueAnchorStepId?: string | null;
	dueSourceFieldId?: string | null;
}

export async function updateStep(input: UpdateStepInput, executor: DbExecutor = db): Promise<void> {
	const patch: Record<string, unknown> = {};
	for (const k of [
		"sectionId",
		"assignedRoleId",
		"type",
		"title",
		"description",
		"position",
		"isRequired",
		"isStopTask",
		"dueType",
		"dueOffsetDays",
		"dueAnchorStepId",
		"dueSourceFieldId",
	] as const) {
		if (input[k] !== undefined) patch[k] = input[k];
	}
	if (Object.keys(patch).length === 0) return;
	await executor.update(step).set(patch).where(eq(step.id, input.stepId));
}

export async function deleteStep(
	input: { stepId: string },
	executor: DbExecutor = db,
): Promise<void> {
	// step_dependency.stepId / .dependsOnStepId cascade on delete.
	// Fields with stepId -> this step cascade too. Caller has already enforced
	// refuse-on-reference for any field whose key is referenced, and refuse-on-reference
	// for any step that points at this one as a due-anchor.
	await executor.delete(step).where(eq(step.id, input.stepId));
}

async function nextStepPosition(workflowVersionId: string, executor: DbExecutor): Promise<number> {
	const [row] = await executor
		.select({ max: max(step.position) })
		.from(step)
		.where(eq(step.workflowVersionId, workflowVersionId));
	return ((row?.max ?? -1) as number) + 1;
}

/** Reorder steps within a version: assign each (stepId, position) tuple in one
 * transaction. Caller supplies the full set of step positions for the version. */
export async function reorderSteps(
	input: { workflowVersionId: string; ordering: Array<{ stepId: string; position: number }> },
	executor: DbExecutor = db,
): Promise<void> {
	await executor.transaction(async (tx) => {
		for (const o of input.ordering) {
			await tx
				.update(step)
				.set({ position: o.position })
				.where(
					and(eq(step.id, o.stepId), eq(step.workflowVersionId, input.workflowVersionId)),
				);
		}
	});
}

// ---------------------------------------------------------------------------
// Field CRUD (key lifecycle enforced in the api/lib layer)
// ---------------------------------------------------------------------------

export interface InsertFieldInput {
	workflowVersionId: string;
	stepId: string | null;
	key: string;
	label: string;
	fieldType:
		| "text"
		| "textarea"
		| "number"
		| "date"
		| "select"
		| "multiselect"
		| "file"
		| "image"
		| "signature"
		| "member"
		| "lookup";
	config?: Record<string, unknown> | null;
	isRequired?: boolean;
	position?: number;
}

export async function insertField(
	input: InsertFieldInput,
	executor: DbExecutor = db,
): Promise<{ id: string }> {
	const [row] = await executor
		.insert(field)
		.values({
			workflowVersionId: input.workflowVersionId,
			stepId: input.stepId,
			key: input.key,
			label: input.label,
			fieldType: input.fieldType,
			config: input.config ?? null,
			isRequired: input.isRequired ?? false,
			position: input.position ?? (await nextFieldPosition(input, executor)),
		})
		.returning({ id: field.id });
	return row;
}

async function nextFieldPosition(
	input: { workflowVersionId: string; stepId: string | null },
	executor: DbExecutor,
): Promise<number> {
	// Kickoff fields and step fields each have their own ordering within (version, stepId).
	const whereExpr =
		input.stepId === null
			? and(eq(field.workflowVersionId, input.workflowVersionId), isNull(field.stepId))
			: and(eq(field.workflowVersionId, input.workflowVersionId), eq(field.stepId, input.stepId));
	const [row] = await executor.select({ max: max(field.position) }).from(field).where(whereExpr);
	return ((row?.max ?? -1) as number) + 1;
}

export interface UpdateFieldInput {
	fieldId: string;
	key?: string;
	label?: string;
	fieldType?:
		| "text"
		| "textarea"
		| "number"
		| "date"
		| "select"
		| "multiselect"
		| "file"
		| "image"
		| "signature"
		| "member"
		| "lookup";
	config?: Record<string, unknown> | null;
	isRequired?: boolean;
	position?: number;
}

export async function updateField(
	input: UpdateFieldInput,
	executor: DbExecutor = db,
): Promise<void> {
	const patch: Record<string, unknown> = {};
	for (const k of [
		"key",
		"label",
		"fieldType",
		"config",
		"isRequired",
		"position",
	] as const) {
		if (input[k] !== undefined) patch[k] = input[k];
	}
	if (Object.keys(patch).length === 0) return;
	await executor.update(field).set(patch).where(eq(field.id, input.fieldId));
}

export async function deleteField(
	input: { fieldId: string },
	executor: DbExecutor = db,
): Promise<void> {
	await executor.delete(field).where(eq(field.id, input.fieldId));
}

/** Fetch a field plus its version's status -- the rename/delete guards need the version
 * status to refuse on non-draft. One query, one round-trip. */
export async function getFieldWithVersion(fieldId: string): Promise<{
	field: typeof field.$inferSelect;
	version: typeof workflowVersion.$inferSelect;
} | null> {
	const rows = await db
		.select()
		.from(field)
		.innerJoin(workflowVersion, eq(workflowVersion.id, field.workflowVersionId))
		.where(eq(field.id, fieldId))
		.limit(1);
	const r = rows[0];
	if (!r) return null;
	return { field: r.field, version: r.workflow_version };
}

/** Same shape for steps. */
export async function getStepWithVersion(stepId: string): Promise<{
	step: typeof step.$inferSelect;
	version: typeof workflowVersion.$inferSelect;
} | null> {
	const rows = await db
		.select()
		.from(step)
		.innerJoin(workflowVersion, eq(workflowVersion.id, step.workflowVersionId))
		.where(eq(step.id, stepId))
		.limit(1);
	const r = rows[0];
	if (!r) return null;
	return { step: r.step, version: r.workflow_version };
}

/** And sections. */
export async function getSectionWithVersion(sectionId: string): Promise<{
	section: typeof section.$inferSelect;
	version: typeof workflowVersion.$inferSelect;
} | null> {
	const rows = await db
		.select()
		.from(section)
		.innerJoin(workflowVersion, eq(workflowVersion.id, section.workflowVersionId))
		.where(eq(section.id, sectionId))
		.limit(1);
	const r = rows[0];
	if (!r) return null;
	return { section: r.section, version: r.workflow_version };
}

/** Fetch a workflow_version + its parent workflow (for org scoping checks). One join. */
export async function getVersionWithWorkflow(versionId: string): Promise<{
	version: typeof workflowVersion.$inferSelect;
	workflow: typeof workflow.$inferSelect;
} | null> {
	const rows = await db
		.select()
		.from(workflowVersion)
		.innerJoin(workflow, eq(workflow.id, workflowVersion.workflowId))
		.where(eq(workflowVersion.id, versionId))
		.limit(1);
	const r = rows[0];
	if (!r) return null;
	return { version: r.workflow_version, workflow: r.workflow };
}

/** Check whether `(workflowVersionId, key)` is unique. Returns the conflicting field's id
 * if it exists (excluding `excludeFieldId`, so rename-to-same is a no-op). */
export async function findFieldByKey(
	workflowVersionId: string,
	key: string,
	excludeFieldId?: string,
): Promise<{ id: string } | null> {
	const conds = [eq(field.workflowVersionId, workflowVersionId), eq(field.key, key)];
	if (excludeFieldId) conds.push(ne(field.id, excludeFieldId));
	const rows = await db
		.select({ id: field.id })
		.from(field)
		.where(and(...conds))
		.limit(1);
	return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Step dependency CRUD
// ---------------------------------------------------------------------------

export async function insertStepDependency(
	input: { stepId: string; dependsOnStepId: string },
	executor: DbExecutor = db,
): Promise<void> {
	await executor
		.insert(stepDependency)
		.values({ stepId: input.stepId, dependsOnStepId: input.dependsOnStepId })
		.onConflictDoNothing({
			target: [stepDependency.stepId, stepDependency.dependsOnStepId],
		});
}

export async function deleteStepDependency(
	input: { stepId: string; dependsOnStepId: string },
	executor: DbExecutor = db,
): Promise<void> {
	await executor
		.delete(stepDependency)
		.where(
			and(
				eq(stepDependency.stepId, input.stepId),
				eq(stepDependency.dependsOnStepId, input.dependsOnStepId),
			),
		);
}

// ---------------------------------------------------------------------------
// Workflow role CRUD (org-level, not version-bound)
// ---------------------------------------------------------------------------

export async function listWorkflowRolesForOrg(organizationId: string) {
	return await db
		.select()
		.from(workflowRole)
		.where(eq(workflowRole.organizationId, organizationId))
		.orderBy(asc(workflowRole.name));
}

export async function insertWorkflowRole(
	input: { organizationId: string; name: string; isInitiator?: boolean },
	executor: DbExecutor = db,
): Promise<{ id: string }> {
	const [row] = await executor
		.insert(workflowRole)
		.values({
			organizationId: input.organizationId,
			name: input.name,
			isInitiator: input.isInitiator ?? false,
		})
		.returning({ id: workflowRole.id });
	return row;
}

export async function updateWorkflowRole(
	input: { organizationId: string; roleId: string; name?: string; isInitiator?: boolean },
	executor: DbExecutor = db,
): Promise<void> {
	const patch: Record<string, unknown> = {};
	if (input.name !== undefined) patch.name = input.name;
	if (input.isInitiator !== undefined) patch.isInitiator = input.isInitiator;
	if (Object.keys(patch).length === 0) return;
	await executor
		.update(workflowRole)
		.set(patch)
		.where(
			and(
				eq(workflowRole.id, input.roleId),
				eq(workflowRole.organizationId, input.organizationId),
			),
		);
}

export async function deleteWorkflowRole(
	input: { organizationId: string; roleId: string },
	executor: DbExecutor = db,
): Promise<void> {
	// `step.assignedRoleId -> set null` on delete (schema). Existing steps referencing the
	// role lose their assignment but otherwise survive; the builder can re-assign.
	await executor
		.delete(workflowRole)
		.where(
			and(
				eq(workflowRole.id, input.roleId),
				eq(workflowRole.organizationId, input.organizationId),
			),
		);
}

// ---------------------------------------------------------------------------
// Publish / fork primitives (used by lib/publish.ts -- raw DB ops only)
// ---------------------------------------------------------------------------

/** Atomic publish: flip status draft -> published. The WHERE clause refuses to publish a
 * non-draft, closing the race between two concurrent publish calls. Returns true iff the
 * UPDATE matched a row -- false means someone else already published or the version was
 * never draft. */
export async function publishVersionRow(
	input: { versionId: string; publishedByUserId: string },
	executor: DbExecutor = db,
): Promise<boolean> {
	const result = await executor
		.update(workflowVersion)
		.set({
			status: "published",
			publishedAt: new Date(),
			publishedBy: input.publishedByUserId,
		})
		.where(and(eq(workflowVersion.id, input.versionId), eq(workflowVersion.status, "draft")))
		.returning({ id: workflowVersion.id });
	return result.length > 0;
}

/** Compute the next version number for a workflow (max + 1). */
export async function nextVersionNumber(workflowId: string, executor: DbExecutor): Promise<number> {
	const [row] = await executor
		.select({ max: max(workflowVersion.versionNumber) })
		.from(workflowVersion)
		.where(eq(workflowVersion.workflowId, workflowId));
	return ((row?.max ?? 0) as number) + 1;
}

/** Insert a draft workflow_version row. Used by editPublished after the deep-copy plan
 * is computed. */
export async function insertDraftVersion(
	input: { workflowId: string; versionNumber: number },
	executor: DbExecutor = db,
): Promise<{ id: string }> {
	const [row] = await executor
		.insert(workflowVersion)
		.values({
			workflowId: input.workflowId,
			versionNumber: input.versionNumber,
			status: "draft",
		})
		.returning({ id: workflowVersion.id });
	return row;
}

/** Delete a workflow_version row. Used by `discardDraft`. CASCADE handles sections /
 * steps / fields / dependencies. */
export async function deleteVersion(
	input: { versionId: string },
	executor: DbExecutor = db,
): Promise<void> {
	await executor.delete(workflowVersion).where(eq(workflowVersion.id, input.versionId));
}
