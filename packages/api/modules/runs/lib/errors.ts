// packages/api/modules/runs/lib/errors.ts
//
// Typed errors thrown by the run engine orchestration helpers. Procedure handlers map
// these to ORPCError codes; tests assert on `error.code`. Plain string codes (vs. enum)
// keep this importable without a barrel.

export type RunEngineErrorCode =
	| "WORKFLOW_NOT_FOUND"
	| "VERSION_NOT_FOUND"
	| "VERSION_NOT_PUBLISHED"
	| "NO_PUBLISHED_VERSION"
	| "INVALID_ROLE_ASSIGNMENT"
	| "REQUIRED_KICKOFF_FIELD_MISSING"
	| "RUN_NOT_FOUND"
	| "RUN_NOT_ACTIVE"
	| "RUN_STEP_NOT_FOUND"
	| "RUN_STEP_ACCESS_DENIED"
	| "RUN_STEP_ALREADY_COMPLETED"
	| "REQUIRED_FIELD_UNFILLED"
	| "STOP_TASK_BLOCKED"
	| "UNKNOWN_FIELD_KEY"
	| "FIELD_VALUE_INVALID"
	| "GUEST_TOKEN_INVALID"
	// Mode-aware launch (Phase 8 step 3) — agent assignment refusals.
	| "MODE_REQUIRES_AGENT"
	| "AGENT_NOT_IN_ORG"
	| "AGENT_INACTIVE"
	// Vendor role-assignment (Phase 8 vendor picker, ADR-007 + D-023).
	| "VENDOR_NOT_IN_ORG"
	| "VENDOR_INACTIVE"
	| "VENDOR_BLACKLISTED"
	| "VENDOR_CONTACT_NOT_FOUND"
	| "VENDOR_CONTACT_INACTIVE";

export class RunEngineError extends Error {
	readonly code: RunEngineErrorCode;
	readonly details?: Record<string, unknown>;
	constructor(code: RunEngineErrorCode, message: string, details?: Record<string, unknown>) {
		super(message);
		this.name = "RunEngineError";
		this.code = code;
		this.details = details;
	}
}
