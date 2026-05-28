// packages/database/drizzle/schema/ai_authoring.ts
//
// AI-authoring provenance (D-021 anchor / PRD_WORKFLOW_SOP_BUILDER.md §8.1, §8.4).
// One row per authoring attempt: captures the user's NL prompt, the entity-schema
// snapshot the AI was given (cached prompt block), the structured response, and the
// model used. Workflows that came from AI authoring point back here via
// `workflow.ai_authoring_prompt_id` -- a soft trail from the authored object back to
// the request that produced it.
//
// Reproducibility: snapshotting the entity schema (rather than refetching live) means
// later re-running the same prompt with a changed entity catalog can be detected and
// distinguished from model drift -- key for the "why did this template change shape"
// forensic story.

import { relations } from "drizzle-orm";
import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { id, orgId, organization, timestamps, user } from "./_shared";

export const aiAuthoringPrompt = pgTable("ai_authoring_prompt", {
	id: id(),
	organizationId: orgId(),
	// Author user id. NOT nullable -- AI authoring is always initiated by a known
	// admin (the procedure layer enforces adminOrgProcedure); orphan-attribution
	// rows would mean the actor was lost, which is forensically useless.
	userId: text("user_id")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
	// The free-text prompt the user supplied. The PRD limits this at 8k chars at the
	// procedure layer; column is unconstrained text (Postgres TOAST handles it).
	prompt: text("prompt").notNull(),
	// Optional doc → workflow ingest path: pasted markdown / extracted PDF text the
	// model uses as additional grounding. Phase 13 (Tango/Scribe import) wires this
	// path through dedicated procedures; for now it's stored when provided.
	sourceText: text("source_text"),
	// The validated structured workflow JSON the model emitted (after Zod gate).
	// Stored verbatim so a follow-up regenerateStep call can diff against the prior
	// emission, and so forensic analysis can compare "what the model produced" vs
	// "what got built" (the latter may diverge if validation drops fields).
	responseJson: jsonb("response_json").notNull(),
	// Frozen snapshot of the EntityAdapter.schemaForAI() blocks the model was given,
	// per-entity-type. Re-running an old prompt with the current schema would
	// produce different output if the schema has since changed; this snapshot
	// preserves the original grounding for reproducibility.
	entitySchemaSnapshot: jsonb("entity_schema_snapshot").notNull(),
	// Model id used (e.g. 'claude-sonnet-4-6'). Plain text so a future model swap
	// doesn't require an enum migration; the model catalog evolves faster than
	// our schema.
	model: text("model").notNull(),
	// Only createdAt -- this is an immutable provenance record. Updates would lose
	// the historical fidelity these rows exist to preserve.
	createdAt: timestamps.createdAt,
});

export const aiAuthoringPromptRelations = relations(aiAuthoringPrompt, ({ one }) => ({
	organization: one(organization, {
		fields: [aiAuthoringPrompt.organizationId],
		references: [organization.id],
	}),
	author: one(user, {
		fields: [aiAuthoringPrompt.userId],
		references: [user.id],
	}),
}));
