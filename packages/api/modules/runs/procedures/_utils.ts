// packages/api/modules/runs/procedures/_utils.ts
//
// Translate the lib's typed RunEngineError into the ORPCError shape oRPC understands.
// Kept at the procedure layer (not in lib/) so lib stays free of oRPC imports and remains
// unit-testable without an oRPC runtime.

import { ORPCError } from "@orpc/server";

import { RunEngineError, type RunEngineErrorCode } from "../lib/errors";

const CODE_MAP: Record<RunEngineErrorCode, "NOT_FOUND" | "FORBIDDEN" | "BAD_REQUEST"> = {
	WORKFLOW_NOT_FOUND: "NOT_FOUND",
	VERSION_NOT_FOUND: "NOT_FOUND",
	NO_PUBLISHED_VERSION: "BAD_REQUEST",
	VERSION_NOT_PUBLISHED: "BAD_REQUEST",
	RUN_NOT_FOUND: "NOT_FOUND",
	RUN_NOT_ACTIVE: "BAD_REQUEST",
	RUN_STEP_NOT_FOUND: "NOT_FOUND",
	RUN_STEP_ACCESS_DENIED: "FORBIDDEN",
	RUN_STEP_ALREADY_COMPLETED: "BAD_REQUEST",
	INVALID_ROLE_ASSIGNMENT: "BAD_REQUEST",
	REQUIRED_KICKOFF_FIELD_MISSING: "BAD_REQUEST",
	REQUIRED_FIELD_UNFILLED: "BAD_REQUEST",
	STOP_TASK_BLOCKED: "BAD_REQUEST",
	UNKNOWN_FIELD_KEY: "BAD_REQUEST",
	FIELD_VALUE_INVALID: "BAD_REQUEST",
	GUEST_TOKEN_INVALID: "FORBIDDEN",
};

/** Wraps a lib helper call so any RunEngineError becomes an ORPCError with a sensible
 * HTTP code. Other exceptions bubble unchanged. */
export async function runEngineCall<T>(fn: () => Promise<T>): Promise<T> {
	try {
		return await fn();
	} catch (err) {
		if (err instanceof RunEngineError) {
			throw new ORPCError(CODE_MAP[err.code], {
				message: err.message,
				data: { code: err.code, ...(err.details ?? {}) },
			});
		}
		throw err;
	}
}
