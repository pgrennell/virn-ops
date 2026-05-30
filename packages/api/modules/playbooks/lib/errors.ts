// packages/api/modules/playbooks/lib/errors.ts
//
// Typed errors thrown by the Playbook authoring backend. Procedure handlers map these
// to ORPCError codes via procedures/_utils.ts; tests assert on `error.code`. Mirrors
// workflows/lib/errors.ts pattern -- plain string codes (not an enum) keep this
// importable without a barrel.

export type PlaybookEngineErrorCode =
	| "PLAYBOOK_NOT_FOUND"
	| "PLAYBOOK_ARCHIVED"
	| "PLAYBOOK_NAME_CONFLICT"
	| "VERSION_NOT_FOUND"
	| "VERSION_NOT_DRAFT"
	| "VERSION_PUBLISHED_IMMUTABLE"
	| "PLAYBOOK_HAS_NO_DRAFT"
	| "STEP_NOT_FOUND"
	| "STEP_VERSION_MISMATCH"
	| "STEP_PARENT_INVALID"
	| "STEP_PARENT_SELF_REFERENCE"
	| "STEP_PARENT_NOT_BRANCH"
	| "STEP_CONFIG_INVALID"
	| "REORDER_STEPS_VERSION_MISMATCH"
	| "REORDER_STEPS_INCOMPLETE"
	// Phase 18a -- publish dance
	| "VERSION_HAS_NO_STEPS"
	| "PUBLISH_RACE";

export class PlaybookEngineError extends Error {
	readonly code: PlaybookEngineErrorCode;
	readonly details?: Record<string, unknown>;
	constructor(
		code: PlaybookEngineErrorCode,
		message: string,
		details?: Record<string, unknown>,
	) {
		super(message);
		this.name = "PlaybookEngineError";
		this.code = code;
		this.details = details;
	}
}
