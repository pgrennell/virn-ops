// Workflows lib hardening -- structure.ts is the big Builder CRUD engine, and it is
// ALREADY heavily covered: the org/draft guards by guards.test.ts, field-key lifecycle
// + FIELD_HAS_REFERENCERS by field-key.test.ts, due-reference validation by
// due-refs.test.ts, and the end-to-end build->publish->launch flow by acceptance.test.ts;
// the procedure gates by structure-authz.test.ts. The one genuinely-uncovered branch is
// deleteStepOp's STEP_HAS_REFERENCERS protection (you cannot delete a step that another
// item -- a dependency edge or a due-anchor -- references). This pins exactly that.
// The guard is no-op mocked (covered separately); only deleteStepOp's own logic is tested.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./guards", () => ({
	assertWorkflowInOrg: vi.fn(),
	assertVersionInOrg: vi.fn(),
	assertVersionIsDraft: vi.fn(),
	assertSectionEditable: vi.fn(),
	assertStepEditable: vi.fn(),
	assertFieldEditable: vi.fn(),
}));

vi.mock("@virn/database", () => ({
	findStepReferencers: vi.fn(),
	deleteStep: vi.fn(),
}));

import { deleteStep, findStepReferencers } from "@virn/database";

import { deleteStepOp } from "./structure";

const ctx = { organizationId: "org-1", userId: "user-1" };

beforeEach(() => {
	vi.clearAllMocks();
});

describe("deleteStepOp -- STEP_HAS_REFERENCERS protection", () => {
	it("refuses with STEP_HAS_REFERENCERS when the step is referenced; does NOT delete", async () => {
		vi.mocked(findStepReferencers).mockResolvedValueOnce([
			{ kind: "dependency", stepId: "s2" },
		] as never);

		await expect(deleteStepOp(ctx, { stepId: "s1" })).rejects.toMatchObject({
			code: "STEP_HAS_REFERENCERS",
			details: { stepId: "s1", referencers: [{ kind: "dependency", stepId: "s2" }] },
		});
		expect(deleteStep).not.toHaveBeenCalled();
	});

	it("deletes the step when nothing references it", async () => {
		vi.mocked(findStepReferencers).mockResolvedValueOnce([] as never);
		vi.mocked(deleteStep).mockResolvedValueOnce(undefined as never);

		await expect(deleteStepOp(ctx, { stepId: "s1" })).resolves.toBeUndefined();
		expect(deleteStep).toHaveBeenCalledWith({ stepId: "s1" });
	});
});
