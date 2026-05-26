// packages/api/modules/workflows/procedures/_utils.ts
//
// Translate the lib's typed WorkflowEngineError into the ORPCError shape oRPC understands.
// Kept at the procedure layer (not in lib/) so lib stays free of oRPC imports and remains
// unit-testable without an oRPC runtime. Same pattern as runs/procedures/_utils.ts.

import { ORPCError } from "@orpc/server";

import { WorkflowEngineError, type WorkflowEngineErrorCode } from "../lib/errors";

const CODE_MAP: Record<
	WorkflowEngineErrorCode,
	"NOT_FOUND" | "FORBIDDEN" | "BAD_REQUEST" | "CONFLICT"
> = {
	WORKFLOW_NOT_FOUND: "NOT_FOUND",
	WORKFLOW_ARCHIVED: "BAD_REQUEST",
	VERSION_NOT_FOUND: "NOT_FOUND",
	VERSION_NOT_DRAFT: "BAD_REQUEST",
	VERSION_NOT_PUBLISHED: "BAD_REQUEST",
	VERSION_HAS_NO_STEPS: "BAD_REQUEST",
	SECTION_NOT_FOUND: "NOT_FOUND",
	SECTION_VERSION_MISMATCH: "BAD_REQUEST",
	STEP_NOT_FOUND: "NOT_FOUND",
	STEP_VERSION_MISMATCH: "BAD_REQUEST",
	STEP_HAS_REFERENCERS: "BAD_REQUEST",
	FIELD_NOT_FOUND: "NOT_FOUND",
	FIELD_VERSION_MISMATCH: "BAD_REQUEST",
	FIELD_KEY_INVALID: "BAD_REQUEST",
	FIELD_KEY_CONFLICT: "BAD_REQUEST",
	FIELD_KEY_LOCKED: "BAD_REQUEST",
	FIELD_HAS_REFERENCERS: "BAD_REQUEST",
	DEPENDENCY_SELF_REFERENCE: "BAD_REQUEST",
	DEPENDENCY_VERSION_MISMATCH: "BAD_REQUEST",
	WORKFLOW_ROLE_NOT_FOUND: "NOT_FOUND",
	PUBLISH_RACE: "CONFLICT",
};

/** Wraps a lib helper call so any WorkflowEngineError becomes an ORPCError with a
 * sensible HTTP code. Other exceptions bubble unchanged. */
export async function workflowEngineCall<T>(fn: () => Promise<T>): Promise<T> {
	try {
		return await fn();
	} catch (err) {
		if (err instanceof WorkflowEngineError) {
			throw new ORPCError(CODE_MAP[err.code], {
				message: err.message,
				data: { code: err.code, ...(err.details ?? {}) },
			});
		}
		throw err;
	}
}
