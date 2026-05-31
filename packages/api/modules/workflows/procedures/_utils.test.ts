// Workflows procedure hardening -- pins the WorkflowEngineError -> ORPCError mapping
// that workflowEngineCall applies for ALL 33+ workflow procedures. CODE_MAP in
// _utils.ts is a Record<WorkflowEngineErrorCode, ...>, so the compiler guarantees
// every code is MAPPED; this asserts each routes to its INTENDED HTTP code (a wrong
// mapping -- e.g. a NOT_FOUND silently becoming BAD_REQUEST, or the unusual
// APPROVAL_REQUIRED -> FORBIDDEN regressing -- would slip through otherwise). The
// EXPECTED map is independently typed, so adding a new code without updating both the
// source map and this test is a compile error -- a deliberate tripwire. Mirrors the
// playbooks _utils.test.ts.

import { ORPCError } from "@orpc/server";
import { describe, expect, it } from "vitest";

import { WorkflowEngineError, type WorkflowEngineErrorCode } from "../lib/errors";
import { workflowEngineCall } from "./_utils";

type OrpcCode = "NOT_FOUND" | "FORBIDDEN" | "BAD_REQUEST" | "CONFLICT";

// The INTENDED mapping. Must match CODE_MAP in _utils.ts; divergence -> a failing
// assertion (wrong code) or a compile error (missing/extra code).
const EXPECTED: Record<WorkflowEngineErrorCode, OrpcCode> = {
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
	CONCIERGE_REVIEW_NOT_ENABLED: "BAD_REQUEST",
	WORKFLOW_HAS_NO_DRAFT: "BAD_REQUEST",
	REVIEW_STATE_INVALID: "CONFLICT",
	AI_AUTHORING_INVALID_OUTPUT: "BAD_REQUEST",
	AI_AUTHORING_MODEL_ERROR: "BAD_REQUEST",
	AI_REGENERATE_TARGET_NOT_FOUND: "NOT_FOUND",
	AI_REGENERATE_VERSION_NOT_DRAFT: "BAD_REQUEST",
	DUE_ANCHOR_INVALID: "BAD_REQUEST",
	DUE_ANCHOR_SELF_REFERENCE: "BAD_REQUEST",
	DUE_ANCHOR_NOT_EARLIER: "BAD_REQUEST",
	DUE_SOURCE_FIELD_INVALID: "BAD_REQUEST",
	DUE_SOURCE_FIELD_NOT_DATE: "BAD_REQUEST",
	DUE_SOURCE_STEP_NOT_EARLIER: "BAD_REQUEST",
	FIELD_TYPE_CHANGE_LOCKED: "BAD_REQUEST",
	IMPORT_NO_RECOGNIZABLE_STRUCTURE: "BAD_REQUEST",
	APPROVAL_REQUIRED: "FORBIDDEN",
};

describe("workflowEngineCall -- CODE_MAP routing", () => {
	it.each(Object.entries(EXPECTED) as [WorkflowEngineErrorCode, OrpcCode][])(
		"routes %s -> %s and preserves the domain code + details",
		async (code, expected) => {
			await expect(
				workflowEngineCall(async () => {
					throw new WorkflowEngineError(code, "boom", { detail: 1 });
				}),
			).rejects.toMatchObject({ code: expected, data: { code, detail: 1 } });
		},
	);

	it("covers every WorkflowEngineErrorCode with one of the four deliberate HTTP codes", () => {
		const allowed: OrpcCode[] = ["NOT_FOUND", "FORBIDDEN", "BAD_REQUEST", "CONFLICT"];
		for (const v of Object.values(EXPECTED)) expect(allowed).toContain(v);
	});

	it("maps the unusual APPROVAL_REQUIRED to FORBIDDEN (publish gate), not BAD_REQUEST", async () => {
		await expect(
			workflowEngineCall(async () => {
				throw new WorkflowEngineError("APPROVAL_REQUIRED", "needs approval");
			}),
		).rejects.toMatchObject({ code: "FORBIDDEN", data: { code: "APPROVAL_REQUIRED" } });
	});

	it("wraps a domain error with no details into data carrying just the code", async () => {
		await expect(
			workflowEngineCall(async () => {
				throw new WorkflowEngineError("WORKFLOW_NOT_FOUND", "gone");
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND", data: { code: "WORKFLOW_NOT_FOUND" } });
	});

	it("lets a NON-domain error bubble unchanged (not swallowed into an ORPCError)", async () => {
		let caught: unknown;
		try {
			await workflowEngineCall(async () => {
				throw new Error("infra blew up");
			});
		} catch (e) {
			caught = e;
		}
		expect(caught).toBeInstanceOf(Error);
		expect(caught).not.toBeInstanceOf(ORPCError);
		expect((caught as Error).message).toBe("infra blew up");
	});

	it("returns the resolved value when the wrapped fn succeeds", async () => {
		await expect(workflowEngineCall(async () => ({ ok: 7 }))).resolves.toEqual({ ok: 7 });
	});
});
