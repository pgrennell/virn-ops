// packages/api/modules/workflows/lib/import/markdown-import-builder.ts
//
// Phase 13 slice B -- builds a draft workflow from a parsed markdown import.
// Pure orchestration over existing @virn/database insert helpers; no AI
// involved. The parsed shape comes from parseStructuredMarkdown; this lib
// turns it into a workflow + workflowVersion + step rows.
//
// Why a separate builder file from the parser: testing leverage. The parser
// is unit-testable as a pure function over strings; this builder is the
// procedure-call layer that touches the DB. Keeping them split means the
// parser's tests don't need DB stubs.

import {
	type DbExecutor,
	type InsertStepInput,
	db,
	insertStep,
	insertWorkflowWithDraft,
	writeAuditAndActivity,
} from "@virn/database";

import { WorkflowEngineError } from "../errors";
import {
	type ImportedWorkflow,
	parseStructuredMarkdown,
} from "./markdown-import";

export interface ImportFromMarkdownContext {
	organizationId: string;
	userId: string;
}

export interface ImportFromMarkdownInput {
	/** The raw markdown source. The parser caps + slices to its own safety
	 * limit; we don't pre-trim here so the audit log keeps the raw source
	 * for forensic value. */
	source: string;
	/** Optional title override -- when supplied, replaces the parser-extracted
	 * title. The author dialog's prompt field maps to this so the user can
	 * name the workflow without editing the source. */
	titleOverride?: string | null;
}

export interface ImportFromMarkdownResult {
	workflowId: string;
	draftVersionId: string;
	title: string;
	stepCount: number;
	detectedFormat: ImportedWorkflow["detectedFormat"];
}

/** Build a draft workflow from a markdown source. Returns the same shape as
 * the AI authoring path so the UI can hand off to the Builder via the same
 * navigation. Throws a typed WorkflowEngineError on parse failure so the
 * procedure layer can surface a structured BAD_REQUEST code.
 *
 * NOTE: this path does NOT write an `ai_authoring_prompt` row or set
 * `workflow.aiAuthoringPromptId`. That column drives the Sparkles "AI-
 * authored" chip; tagging a deterministic markdown import as AI-authored
 * would be misleading. Traceability comes from the audit_log row instead. */
export async function importWorkflowFromMarkdown(
	ctx: ImportFromMarkdownContext,
	input: ImportFromMarkdownInput,
): Promise<ImportFromMarkdownResult> {
	const parsed = parseStructuredMarkdown(input.source);
	if (!parsed) {
		throw new WorkflowEngineError(
			"IMPORT_NO_RECOGNIZABLE_STRUCTURE",
			"Couldn't detect Tango / Scribe / numbered-markdown step structure in the source.",
			{ sourceLength: typeof input.source === "string" ? input.source.length : 0 },
		);
	}

	const titleOverride = input.titleOverride?.trim();
	const finalTitle =
		titleOverride && titleOverride.length > 0 ? titleOverride : parsed.title;

	const buildResult = await db.transaction(async (tx: DbExecutor) => {
		const { workflowId, versionId } = await insertWorkflowWithDraft(
			{
				organizationId: ctx.organizationId,
				title: finalTitle,
				description: parsed.description,
				type: "procedure",
				createdBy: ctx.userId,
				// Deliberately omit aiAuthoringPromptId -- this isn't AI-authored.
			},
			tx,
		);

		for (const [i, step] of parsed.steps.entries()) {
			const payload: InsertStepInput = {
				workflowVersionId: versionId,
				sectionId: null,
				type: "task",
				title: step.title,
				description: step.description,
				position: i,
				isRequired: true,
				isStopTask: false,
				dueType: "none",
				dueOffsetDays: null,
				// D-040 -- imports are a manual gesture; flag them as
				// manually_edited so regenerateStep's sibling-isolation guard
				// won't ever rewrite them. The user explicitly chose this
				// source content.
				provenance: "manually_edited",
			};
			await insertStep(payload, tx);
		}

		return { workflowId, versionId, stepCount: parsed.steps.length };
	});

	// Audit + activity outside the build transaction so a post-build audit
	// failure can't roll back a fully-valid workflow.
	await writeAuditAndActivity({
		organizationId: ctx.organizationId,
		actorUserId: ctx.userId,
		action: "workflow.imported_from_markdown",
		verb: "imported from markdown",
		entityType: "workflow",
		entityId: buildResult.workflowId,
		changes: {
			title: finalTitle,
			detectedFormat: parsed.detectedFormat,
			stepCount: buildResult.stepCount,
		},
		metadata: {
			draftVersionId: buildResult.versionId,
			// Source length only -- the raw source can be megabytes; storing it
			// here would bloat the audit table. The user retains it; the
			// audit row is just the forensic anchor.
			sourceLength: input.source.length,
		},
		activityData: {
			workflowTitle: finalTitle,
			source: "markdown-import",
			detectedFormat: parsed.detectedFormat,
		},
	});

	return {
		workflowId: buildResult.workflowId,
		draftVersionId: buildResult.versionId,
		title: finalTitle,
		stepCount: buildResult.stepCount,
		detectedFormat: parsed.detectedFormat,
	};
}
