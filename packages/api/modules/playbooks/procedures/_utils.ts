// packages/api/modules/playbooks/procedures/_utils.ts
//
// Translate the lib's typed PlaybookEngineError into the ORPCError shape oRPC
// understands. Mirrors workflows/procedures/_utils.ts -- kept at the procedure layer
// (not in lib/) so lib stays free of oRPC imports and remains unit-testable.

import { ORPCError } from "@orpc/server";

import {
	PlaybookEngineError,
	type PlaybookEngineErrorCode,
} from "../lib/errors";

const CODE_MAP: Record<
	PlaybookEngineErrorCode,
	"NOT_FOUND" | "FORBIDDEN" | "BAD_REQUEST" | "CONFLICT"
> = {
	PLAYBOOK_NOT_FOUND: "NOT_FOUND",
	PLAYBOOK_ARCHIVED: "BAD_REQUEST",
	PLAYBOOK_NAME_CONFLICT: "CONFLICT",
	VERSION_NOT_FOUND: "NOT_FOUND",
	VERSION_NOT_DRAFT: "BAD_REQUEST",
	VERSION_PUBLISHED_IMMUTABLE: "BAD_REQUEST",
	PLAYBOOK_HAS_NO_DRAFT: "BAD_REQUEST",
	STEP_NOT_FOUND: "NOT_FOUND",
	STEP_VERSION_MISMATCH: "BAD_REQUEST",
	STEP_PARENT_INVALID: "BAD_REQUEST",
	STEP_PARENT_SELF_REFERENCE: "BAD_REQUEST",
	STEP_PARENT_NOT_BRANCH: "BAD_REQUEST",
	STEP_CONFIG_INVALID: "BAD_REQUEST",
	REORDER_STEPS_VERSION_MISMATCH: "BAD_REQUEST",
	REORDER_STEPS_INCOMPLETE: "BAD_REQUEST",
	// Phase 18a -- publish dance
	VERSION_HAS_NO_STEPS: "BAD_REQUEST",
	PUBLISH_RACE: "CONFLICT",
};

/** Wraps a lib helper call so any PlaybookEngineError becomes an ORPCError with a
 * sensible HTTP code. Other exceptions bubble unchanged. */
export async function playbookEngineCall<T>(fn: () => Promise<T>): Promise<T> {
	try {
		return await fn();
	} catch (err) {
		if (err instanceof PlaybookEngineError) {
			throw new ORPCError(CODE_MAP[err.code], {
				message: err.message,
				data: { code: err.code, ...(err.details ?? {}) },
			});
		}
		throw err;
	}
}
