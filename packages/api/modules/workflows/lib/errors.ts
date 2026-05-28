// packages/api/modules/workflows/lib/errors.ts
//
// Typed errors thrown by the Workflow Builder backend. Procedure handlers map these to
// ORPCError codes via procedures/_utils.ts; tests assert on `error.code`. Plain string
// codes (vs. enum) keep this importable without a barrel.

export type WorkflowEngineErrorCode =
	| "WORKFLOW_NOT_FOUND"
	| "WORKFLOW_ARCHIVED"
	| "VERSION_NOT_FOUND"
	| "VERSION_NOT_DRAFT"
	| "VERSION_NOT_PUBLISHED"
	| "VERSION_HAS_NO_STEPS"
	| "SECTION_NOT_FOUND"
	| "SECTION_VERSION_MISMATCH"
	| "STEP_NOT_FOUND"
	| "STEP_VERSION_MISMATCH"
	| "STEP_HAS_REFERENCERS"
	| "FIELD_NOT_FOUND"
	| "FIELD_VERSION_MISMATCH"
	| "FIELD_KEY_INVALID"
	| "FIELD_KEY_CONFLICT"
	| "FIELD_KEY_LOCKED"
	| "FIELD_HAS_REFERENCERS"
	| "DEPENDENCY_SELF_REFERENCE"
	| "DEPENDENCY_VERSION_MISMATCH"
	| "WORKFLOW_ROLE_NOT_FOUND"
	| "PUBLISH_RACE"
	// Phase 9.5g review-state transitions (PRD §6.6)
	| "CONCIERGE_REVIEW_NOT_ENABLED"
	| "WORKFLOW_HAS_NO_DRAFT"
	| "REVIEW_STATE_INVALID"
	// Phase 12.1 AI authoring (PRD §6.4, §8.4)
	| "AI_AUTHORING_INVALID_OUTPUT"
	| "AI_AUTHORING_MODEL_ERROR"
	// Phase 12.2 dueType ref validation
	| "DUE_ANCHOR_INVALID"
	| "DUE_ANCHOR_SELF_REFERENCE"
	| "DUE_ANCHOR_NOT_EARLIER"
	| "DUE_SOURCE_FIELD_INVALID"
	| "DUE_SOURCE_FIELD_NOT_DATE"
	| "DUE_SOURCE_STEP_NOT_EARLIER"
	| "FIELD_TYPE_CHANGE_LOCKED";

export class WorkflowEngineError extends Error {
	readonly code: WorkflowEngineErrorCode;
	readonly details?: Record<string, unknown>;
	constructor(
		code: WorkflowEngineErrorCode,
		message: string,
		details?: Record<string, unknown>,
	) {
		super(message);
		this.name = "WorkflowEngineError";
		this.code = code;
		this.details = details;
	}
}
