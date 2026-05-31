// Phase 18 hardening (A6) -- pins the PlaybookEngineError -> ORPCError mapping.
//
// CODE_MAP in _utils.ts is a Record<PlaybookEngineErrorCode, ...>, so the compiler
// already guarantees every code is MAPPED. What it can't catch is a WRONG mapping
// (a NOT_FOUND silently becoming BAD_REQUEST) or a regression in the wrapper itself.
// The EXPECTED map below is independently typed Record<PlaybookEngineErrorCode, ...>,
// so adding a new code without updating BOTH the source map and this test is a
// compile error -- a deliberate tripwire. The it.each then asserts each code routes
// to its intended ORPCError code end-to-end through playbookEngineCall.

import { ORPCError } from "@orpc/server";
import { describe, expect, it } from "vitest";

import { PlaybookEngineError, type PlaybookEngineErrorCode } from "../lib/errors";
import { playbookEngineCall } from "./_utils";

type OrpcCode = "NOT_FOUND" | "FORBIDDEN" | "BAD_REQUEST" | "CONFLICT";

// The INTENDED mapping. Must match CODE_MAP in _utils.ts; divergence -> a failing
// assertion (wrong code) or a compile error (missing/extra code).
const EXPECTED: Record<PlaybookEngineErrorCode, OrpcCode> = {
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
	VERSION_HAS_NO_STEPS: "BAD_REQUEST",
	PUBLISH_RACE: "CONFLICT",
	PLAYBOOK_NOT_PUBLISHED: "BAD_REQUEST",
	PLAYBOOK_RUN_NOT_FOUND: "NOT_FOUND",
	PLAYBOOK_RUN_NOT_CANCELLABLE: "CONFLICT",
	AI_AUTHORING_INVALID_OUTPUT: "BAD_REQUEST",
	AI_AUTHORING_MODEL_ERROR: "BAD_REQUEST",
	STEP_NOT_AI_GENERATED: "BAD_REQUEST",
};

describe("playbookEngineCall -- CODE_MAP routing", () => {
	it.each(Object.entries(EXPECTED) as [PlaybookEngineErrorCode, OrpcCode][])(
		"routes %s -> %s and preserves the domain code + details",
		async (code, expected) => {
			await expect(
				playbookEngineCall(async () => {
					throw new PlaybookEngineError(code, "boom", { detail: 1 });
				}),
			).rejects.toMatchObject({ code: expected, data: { code, detail: 1 } });
		},
	);

	it("covers every PlaybookEngineErrorCode (no code routes to a generic 500)", () => {
		// Every value is one of the four deliberate HTTP codes -- never INTERNAL/500.
		const allowed: OrpcCode[] = ["NOT_FOUND", "FORBIDDEN", "BAD_REQUEST", "CONFLICT"];
		for (const v of Object.values(EXPECTED)) expect(allowed).toContain(v);
	});

	it("wraps a domain error with no details into data carrying just the code", async () => {
		await expect(
			playbookEngineCall(async () => {
				throw new PlaybookEngineError("PLAYBOOK_NOT_FOUND", "gone");
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND", data: { code: "PLAYBOOK_NOT_FOUND" } });
	});

	it("lets a NON-domain error bubble unchanged (not swallowed into an ORPCError)", async () => {
		let caught: unknown;
		try {
			await playbookEngineCall(async () => {
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
		await expect(playbookEngineCall(async () => ({ ok: 7 }))).resolves.toEqual({ ok: 7 });
	});
});
