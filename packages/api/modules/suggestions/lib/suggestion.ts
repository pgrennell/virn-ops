// packages/api/modules/suggestions/lib/suggestion.ts
//
// Phase 16 -- suggestions lifecycle: submit -> triage (accept / reject /
// merge). Schema shipped in Phase 1 Batch 3. Distinct from the suggestion
// box in the Read view's reader-grade surface in concept: this is the
// underlying record + the admin-side triage flow. Submit is open to any
// member; triage is admin-only.
//
// Capability gating: governance.suggestions must be ON. The procedure
// layer also gates the UI button via the snapshot capability check.

import { ORPCError } from "@orpc/server";
import {
	getSuggestionForOrg,
	getWorkflowForOrg,
	insertSuggestion,
	isCapabilityEnabledForOrg,
	listSuggestionsForOrg,
	type SuggestionRow,
	updateSuggestionStatus,
	writeAuditAndActivity,
} from "@virn/database";

export const SUGGESTIONS_CAPABILITY_KEY = "governance.suggestions";

export interface SuggestionContext {
	organizationId: string;
	userId: string;
}

// ---------------------------------------------------------------------------
// submit
// ---------------------------------------------------------------------------

export interface SubmitSuggestionInput {
	workflowId: string;
	body: string;
}

export interface SubmitSuggestionResult {
	id: string;
	createdAt: Date;
}

export async function submitSuggestion(
	ctx: SuggestionContext,
	input: SubmitSuggestionInput,
): Promise<SubmitSuggestionResult> {
	const wf = await getWorkflowForOrg(ctx.organizationId, input.workflowId);
	if (!wf) {
		throw new ORPCError("NOT_FOUND", {
			message: "Workflow not found.",
			data: { code: "WORKFLOW_NOT_FOUND" },
		});
	}
	const capEnabled = await isCapabilityEnabledForOrg(
		ctx.organizationId,
		SUGGESTIONS_CAPABILITY_KEY,
	);
	if (!capEnabled) {
		throw new ORPCError("FORBIDDEN", {
			message: "Suggestions are not enabled for this organization.",
			data: { code: "CAPABILITY_DISABLED", capability: SUGGESTIONS_CAPABILITY_KEY },
		});
	}

	const inserted = await insertSuggestion({
		organizationId: ctx.organizationId,
		workflowId: input.workflowId,
		suggestedByUserId: ctx.userId,
		body: input.body,
	});

	await writeAuditAndActivity({
		organizationId: ctx.organizationId,
		actorUserId: ctx.userId,
		actorKind: "user",
		action: "suggestion.created",
		verb: "suggested",
		entityType: "suggestion",
		entityId: inserted.id,
		activityData: { workflowId: input.workflowId },
	});

	return inserted;
}

// ---------------------------------------------------------------------------
// list (admin triage)
// ---------------------------------------------------------------------------

export interface ListSuggestionsInput {
	workflowId?: string;
	status?: "open" | "accepted" | "rejected" | "merged";
	limit?: number;
	offset?: number;
}

export async function listSuggestions(
	ctx: SuggestionContext,
	input: ListSuggestionsInput,
): Promise<{ rows: SuggestionRow[]; totalCount: number }> {
	return await listSuggestionsForOrg({
		organizationId: ctx.organizationId,
		workflowId: input.workflowId,
		status: input.status,
		limit: input.limit,
		offset: input.offset,
	});
}

// ---------------------------------------------------------------------------
// decide (admin triage)
// ---------------------------------------------------------------------------

export interface DecideSuggestionInput {
	suggestionId: string;
	status: "accepted" | "rejected" | "merged";
}

export interface DecideSuggestionResult {
	id: string;
	status: "accepted" | "rejected" | "merged";
	resolvedAt: Date;
}

export async function decideSuggestion(
	ctx: SuggestionContext,
	input: DecideSuggestionInput,
): Promise<DecideSuggestionResult> {
	const row = await getSuggestionForOrg({
		organizationId: ctx.organizationId,
		suggestionId: input.suggestionId,
	});
	if (!row) {
		throw new ORPCError("NOT_FOUND", {
			message: "Suggestion not found in this organization.",
			data: { code: "SUGGESTION_NOT_FOUND" },
		});
	}
	if (row.status !== "open") {
		throw new ORPCError("CONFLICT", {
			message: "This suggestion was already resolved.",
			data: { code: "SUGGESTION_ALREADY_RESOLVED", currentStatus: row.status },
		});
	}
	// Capability check is admin-side too -- the triage UI should be hidden
	// when off, but we defend at the procedure layer anyway.
	const capEnabled = await isCapabilityEnabledForOrg(
		ctx.organizationId,
		SUGGESTIONS_CAPABILITY_KEY,
	);
	if (!capEnabled) {
		throw new ORPCError("FORBIDDEN", {
			message: "Suggestions are not enabled for this organization.",
			data: { code: "CAPABILITY_DISABLED", capability: SUGGESTIONS_CAPABILITY_KEY },
		});
	}

	const result = await updateSuggestionStatus({
		suggestionId: input.suggestionId,
		status: input.status,
		resolvedByUserId: ctx.userId,
	});
	if (!result) {
		throw new ORPCError("CONFLICT", {
			message: "This suggestion was just resolved by another reviewer.",
			data: { code: "SUGGESTION_ALREADY_RESOLVED" },
		});
	}

	await writeAuditAndActivity({
		organizationId: ctx.organizationId,
		actorUserId: ctx.userId,
		actorKind: "user",
		action: `suggestion.${input.status}`,
		verb: input.status,
		entityType: "suggestion",
		entityId: input.suggestionId,
		activityData: { workflowId: row.workflowId },
	});

	return {
		id: result.id,
		status: input.status,
		resolvedAt: result.resolvedAt,
	};
}
