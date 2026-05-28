// Phase 12.2 -- structure.ts dueType ref validation tests.
//
// Asserts that createStep + updateStepOp reject dueAnchorStepId / dueSourceFieldId
// payloads that would silently no-op at launch (anchor in wrong version, source
// field not a date, etc.). Three concerns covered:
//
//   1. Refs are validated when present in the patch.
//   2. Refs that are NOT in the patch don't trigger a lookup (cheap path for
//      title-only edits stays cheap).
//   3. Self-anchor is rejected without needing a DB lookup.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@virn/database", () => ({
	deleteField: vi.fn(),
	deleteSection: vi.fn(),
	deleteStep: vi.fn(),
	deleteStepDependency: vi.fn(),
	findFieldReferencers: vi.fn(),
	findStepReferencers: vi.fn(),
	getFieldWithVersion: vi.fn(),
	getStepWithVersion: vi.fn(),
	insertField: vi.fn(),
	insertSection: vi.fn(),
	insertStep: vi.fn(),
	insertStepDependency: vi.fn(),
	reorderSteps: vi.fn(),
	updateField: vi.fn(),
	updateSection: vi.fn(),
	updateStep: vi.fn(),
}));

vi.mock("./guards", () => ({
	assertVersionIsDraft: vi.fn(async () => ({
		workflow: { id: "wf_1", organizationId: "org_1" },
		version: { id: "ver_1", status: "draft" },
	})),
	assertStepEditable: vi.fn(async () => ({
		step: { id: "st_1", workflowVersionId: "ver_1" },
		version: { id: "ver_1", status: "draft" },
		workflow: { id: "wf_1", organizationId: "org_1" },
	})),
	assertSectionEditable: vi.fn(),
	assertFieldEditable: vi.fn(async () => ({
		field: { id: "fld_1", workflowVersionId: "ver_1", key: "k", fieldType: "date" },
		version: { id: "ver_1", status: "draft" },
		workflow: { id: "wf_1", organizationId: "org_1" },
	})),
}));

// The field-key lib does network-ish lookups inside updateFieldOp. Stub it so
// tests focused on the fieldType guard don't have to set up key rename mocks.
vi.mock("./field-key", () => ({
	autoSlugFromLabel: (s: string) => s.toLowerCase().replace(/\s+/g, "_"),
	resolveUniqueKey: vi.fn(async (input: { candidate: string }) => input.candidate),
	validateKeyShape: vi.fn(),
	assertKeyRenameAllowed: vi.fn(async () => undefined),
	assertFieldDeleteAllowed: vi.fn(async () => undefined),
}));

import {
	findFieldReferencers,
	getFieldWithVersion,
	getStepWithVersion,
	insertStep,
	updateField,
	updateStep,
} from "@virn/database";

import { WorkflowEngineError } from "./errors";
import { createStep, updateFieldOp, updateStepOp } from "./structure";

const CTX = { organizationId: "org_1", userId: "user_1" };

beforeEach(() => {
	vi.resetAllMocks();
});

describe("updateStepOp -- dueAnchorStepId validation", () => {
	it("accepts an anchor in the same version", async () => {
		vi.mocked(getStepWithVersion).mockResolvedValue({
			step: { id: "st_2" },
			version: { id: "ver_1" },
		} as never);
		await expect(
			updateStepOp(CTX, {
				stepId: "st_1",
				dueType: "offset_from_step",
				dueAnchorStepId: "st_2",
			}),
		).resolves.toBeUndefined();
		expect(updateStep).toHaveBeenCalledTimes(1);
	});

	it("rejects an anchor in a different version (DUE_ANCHOR_INVALID)", async () => {
		vi.mocked(getStepWithVersion).mockResolvedValue({
			step: { id: "st_other" },
			version: { id: "ver_OTHER" },
		} as never);
		const err = await updateStepOp(CTX, {
			stepId: "st_1",
			dueType: "offset_from_step",
			dueAnchorStepId: "st_other",
		}).catch((e) => e);
		expect(err).toBeInstanceOf(WorkflowEngineError);
		expect(err.code).toBe("DUE_ANCHOR_INVALID");
		expect(updateStep).not.toHaveBeenCalled();
	});

	it("rejects an anchor that doesn't exist (DUE_ANCHOR_INVALID)", async () => {
		vi.mocked(getStepWithVersion).mockResolvedValue(null);
		const err = await updateStepOp(CTX, {
			stepId: "st_1",
			dueType: "offset_from_step",
			dueAnchorStepId: "st_phantom",
		}).catch((e) => e);
		expect(err.code).toBe("DUE_ANCHOR_INVALID");
	});

	it("rejects self-anchor (DUE_ANCHOR_SELF_REFERENCE)", async () => {
		const err = await updateStepOp(CTX, {
			stepId: "st_1",
			dueType: "offset_from_step",
			dueAnchorStepId: "st_1",
		}).catch((e) => e);
		expect(err.code).toBe("DUE_ANCHOR_SELF_REFERENCE");
		// Importantly, no DB lookup happened -- caught before the query.
		expect(getStepWithVersion).not.toHaveBeenCalled();
		expect(updateStep).not.toHaveBeenCalled();
	});

	it("allows dueAnchorStepId=null (clearing the anchor)", async () => {
		await expect(
			updateStepOp(CTX, {
				stepId: "st_1",
				dueType: "none",
				dueAnchorStepId: null,
			}),
		).resolves.toBeUndefined();
		// Null clears the anchor; no DB lookup needed.
		expect(getStepWithVersion).not.toHaveBeenCalled();
		expect(updateStep).toHaveBeenCalledTimes(1);
	});
});

describe("updateStepOp -- dueSourceFieldId validation", () => {
	it("accepts a date field in the same version", async () => {
		vi.mocked(getFieldWithVersion).mockResolvedValue({
			field: { id: "fld_1", fieldType: "date" },
			version: { id: "ver_1" },
		} as never);
		await expect(
			updateStepOp(CTX, {
				stepId: "st_1",
				dueType: "from_date_field",
				dueSourceFieldId: "fld_1",
			}),
		).resolves.toBeUndefined();
		expect(updateStep).toHaveBeenCalledTimes(1);
	});

	it("rejects a non-date source field (DUE_SOURCE_FIELD_NOT_DATE)", async () => {
		vi.mocked(getFieldWithVersion).mockResolvedValue({
			field: { id: "fld_1", fieldType: "text" },
			version: { id: "ver_1" },
		} as never);
		const err = await updateStepOp(CTX, {
			stepId: "st_1",
			dueType: "from_date_field",
			dueSourceFieldId: "fld_1",
		}).catch((e) => e);
		expect(err.code).toBe("DUE_SOURCE_FIELD_NOT_DATE");
		expect(err.details?.actualFieldType).toBe("text");
		expect(updateStep).not.toHaveBeenCalled();
	});

	it("rejects a source field in a different version (DUE_SOURCE_FIELD_INVALID)", async () => {
		vi.mocked(getFieldWithVersion).mockResolvedValue({
			field: { id: "fld_other", fieldType: "date" },
			version: { id: "ver_OTHER" },
		} as never);
		const err = await updateStepOp(CTX, {
			stepId: "st_1",
			dueType: "from_date_field",
			dueSourceFieldId: "fld_other",
		}).catch((e) => e);
		expect(err.code).toBe("DUE_SOURCE_FIELD_INVALID");
	});

	it("rejects a missing source field (DUE_SOURCE_FIELD_INVALID)", async () => {
		vi.mocked(getFieldWithVersion).mockResolvedValue(null);
		const err = await updateStepOp(CTX, {
			stepId: "st_1",
			dueType: "from_date_field",
			dueSourceFieldId: "fld_phantom",
		}).catch((e) => e);
		expect(err.code).toBe("DUE_SOURCE_FIELD_INVALID");
	});

	it("allows dueSourceFieldId=null (clearing the source)", async () => {
		await expect(
			updateStepOp(CTX, {
				stepId: "st_1",
				dueType: "none",
				dueSourceFieldId: null,
			}),
		).resolves.toBeUndefined();
		expect(getFieldWithVersion).not.toHaveBeenCalled();
		expect(updateStep).toHaveBeenCalledTimes(1);
	});
});

describe("updateStepOp -- cheap path for non-due patches", () => {
	it("skips ref lookups when neither dueAnchorStepId nor dueSourceFieldId is in the patch", async () => {
		await updateStepOp(CTX, {
			stepId: "st_1",
			title: "Renamed",
			description: "New description",
		});
		expect(getStepWithVersion).not.toHaveBeenCalled();
		expect(getFieldWithVersion).not.toHaveBeenCalled();
		expect(updateStep).toHaveBeenCalledTimes(1);
	});
});

describe("createStep -- dueType ref validation at insert time", () => {
	it("validates dueAnchorStepId against the new step's version", async () => {
		vi.mocked(getStepWithVersion).mockResolvedValue({
			step: { id: "st_anchor" },
			version: { id: "ver_1" },
		} as never);
		vi.mocked(insertStep).mockResolvedValue({ id: "st_new" });
		const result = await createStep(CTX, {
			workflowVersionId: "ver_1",
			title: "New step",
			dueType: "offset_from_step",
			dueOffsetDays: 2,
			dueAnchorStepId: "st_anchor",
		});
		expect(result.id).toBe("st_new");
		expect(insertStep).toHaveBeenCalledTimes(1);
	});

	it("rejects createStep with an anchor in a different version", async () => {
		vi.mocked(getStepWithVersion).mockResolvedValue({
			step: { id: "st_anchor" },
			version: { id: "ver_OTHER" },
		} as never);
		const err = await createStep(CTX, {
			workflowVersionId: "ver_1",
			title: "Bad step",
			dueType: "offset_from_step",
			dueAnchorStepId: "st_anchor",
		}).catch((e) => e);
		expect(err.code).toBe("DUE_ANCHOR_INVALID");
		expect(insertStep).not.toHaveBeenCalled();
	});

	it("rejects createStep with a non-date source field", async () => {
		vi.mocked(getFieldWithVersion).mockResolvedValue({
			field: { id: "fld_1", fieldType: "select" },
			version: { id: "ver_1" },
		} as never);
		const err = await createStep(CTX, {
			workflowVersionId: "ver_1",
			title: "Bad step",
			dueType: "from_date_field",
			dueSourceFieldId: "fld_1",
		}).catch((e) => e);
		expect(err.code).toBe("DUE_SOURCE_FIELD_NOT_DATE");
		expect(insertStep).not.toHaveBeenCalled();
	});

	it("self-anchor cannot trigger on createStep (no id yet)", async () => {
		// createStep can't self-anchor because the new id doesn't exist; the
		// anchor must point at some PRE-EXISTING step in the version. Verified
		// by absence of the SELF_REFERENCE error path on this call shape.
		vi.mocked(getStepWithVersion).mockResolvedValue({
			step: { id: "st_anchor" },
			version: { id: "ver_1" },
		} as never);
		vi.mocked(insertStep).mockResolvedValue({ id: "st_new" });
		await expect(
			createStep(CTX, {
				workflowVersionId: "ver_1",
				title: "Step",
				dueType: "offset_from_step",
				dueAnchorStepId: "st_anchor",
			}),
		).resolves.toMatchObject({ id: "st_new" });
	});
});

describe("updateStepOp -- position ordering (anchor + source-step must be earlier)", () => {
	it("rejects anchor at the SAME position as the dependent (DUE_ANCHOR_NOT_EARLIER)", async () => {
		vi.mocked(getStepWithVersion).mockResolvedValue({
			step: { id: "st_anchor", position: 3 },
			version: { id: "ver_1" },
		} as never);
		// assertStepEditable's mock returns step with no position; override the mock
		// once for this test so dependentPosition flows in as 3.
		const guards = await import("./guards");
		vi.mocked(guards.assertStepEditable).mockResolvedValueOnce({
			step: { id: "st_1", workflowVersionId: "ver_1", position: 3 },
			version: { id: "ver_1", status: "draft" },
			workflow: { id: "wf_1", organizationId: "org_1" },
		} as never);

		const err = await updateStepOp(CTX, {
			stepId: "st_1",
			dueType: "offset_from_step",
			dueAnchorStepId: "st_anchor",
			dueOffsetDays: 2,
		}).catch((e) => e);
		expect(err.code).toBe("DUE_ANCHOR_NOT_EARLIER");
		expect(updateStep).not.toHaveBeenCalled();
	});

	it("rejects anchor at a LATER position", async () => {
		vi.mocked(getStepWithVersion).mockResolvedValue({
			step: { id: "st_anchor", position: 5 },
			version: { id: "ver_1" },
		} as never);
		const guards = await import("./guards");
		vi.mocked(guards.assertStepEditable).mockResolvedValueOnce({
			step: { id: "st_1", workflowVersionId: "ver_1", position: 2 },
			version: { id: "ver_1", status: "draft" },
			workflow: { id: "wf_1", organizationId: "org_1" },
		} as never);

		const err = await updateStepOp(CTX, {
			stepId: "st_1",
			dueType: "offset_from_step",
			dueAnchorStepId: "st_anchor",
			dueOffsetDays: 2,
		}).catch((e) => e);
		expect(err.code).toBe("DUE_ANCHOR_NOT_EARLIER");
	});

	it("accepts anchor at an EARLIER position", async () => {
		vi.mocked(getStepWithVersion).mockResolvedValue({
			step: { id: "st_anchor", position: 1 },
			version: { id: "ver_1" },
		} as never);
		const guards = await import("./guards");
		vi.mocked(guards.assertStepEditable).mockResolvedValueOnce({
			step: { id: "st_1", workflowVersionId: "ver_1", position: 5 },
			version: { id: "ver_1", status: "draft" },
			workflow: { id: "wf_1", organizationId: "org_1" },
		} as never);

		await expect(
			updateStepOp(CTX, {
				stepId: "st_1",
				dueType: "offset_from_step",
				dueAnchorStepId: "st_anchor",
				dueOffsetDays: 2,
			}),
		).resolves.toBeUndefined();
	});

	it("rejects source field whose step is at a LATER position (DUE_SOURCE_STEP_NOT_EARLIER)", async () => {
		// Source field is on a step at position 8; dependent step is at position 3.
		vi.mocked(getFieldWithVersion).mockResolvedValue({
			field: { id: "fld_src", fieldType: "date", stepId: "st_later" },
			version: { id: "ver_1" },
		} as never);
		// getStepWithVersion is called BOTH for source field's parent step and (if
		// anchor were also in the patch) for the anchor. Use mockImplementation so
		// the same mock returns the appropriate row for st_later.
		vi.mocked(getStepWithVersion).mockResolvedValue({
			step: { id: "st_later", position: 8 },
			version: { id: "ver_1" },
		} as never);
		const guards = await import("./guards");
		vi.mocked(guards.assertStepEditable).mockResolvedValueOnce({
			step: { id: "st_1", workflowVersionId: "ver_1", position: 3 },
			version: { id: "ver_1", status: "draft" },
			workflow: { id: "wf_1", organizationId: "org_1" },
		} as never);

		const err = await updateStepOp(CTX, {
			stepId: "st_1",
			dueType: "from_date_field",
			dueSourceFieldId: "fld_src",
			dueOffsetDays: 1,
		}).catch((e) => e);
		expect(err.code).toBe("DUE_SOURCE_STEP_NOT_EARLIER");
	});

	it("accepts source field that's a KICKOFF field (no parent step)", async () => {
		vi.mocked(getFieldWithVersion).mockResolvedValue({
			field: { id: "fld_kickoff", fieldType: "date", stepId: null },
			version: { id: "ver_1" },
		} as never);
		const guards = await import("./guards");
		vi.mocked(guards.assertStepEditable).mockResolvedValueOnce({
			step: { id: "st_1", workflowVersionId: "ver_1", position: 0 },
			version: { id: "ver_1", status: "draft" },
			workflow: { id: "wf_1", organizationId: "org_1" },
		} as never);

		await expect(
			updateStepOp(CTX, {
				stepId: "st_1",
				dueType: "from_date_field",
				dueSourceFieldId: "fld_kickoff",
				dueOffsetDays: -1,
			}),
		).resolves.toBeUndefined();
	});
});

describe("updateStepOp + createStep -- normalize stale companions on dueType narrow", () => {
	it("dueType='none' patch nulls dueAnchorStepId + dueSourceFieldId + dueOffsetDays in the write", async () => {
		await updateStepOp(CTX, {
			stepId: "st_1",
			dueType: "none",
			// Caller deliberately did NOT pass nulls for the companions
		});
		expect(updateStep).toHaveBeenCalledTimes(1);
		const arg = vi.mocked(updateStep).mock.calls[0][0];
		expect(arg.dueAnchorStepId).toBeNull();
		expect(arg.dueSourceFieldId).toBeNull();
		expect(arg.dueOffsetDays).toBeNull();
	});

	it("dueType='offset_from_start' patch nulls dueAnchorStepId + dueSourceFieldId", async () => {
		await updateStepOp(CTX, {
			stepId: "st_1",
			dueType: "offset_from_start",
			dueOffsetDays: 3,
		});
		const arg = vi.mocked(updateStep).mock.calls[0][0];
		expect(arg.dueAnchorStepId).toBeNull();
		expect(arg.dueSourceFieldId).toBeNull();
		expect(arg.dueOffsetDays).toBe(3);
	});

	it("dueType='offset_from_step' patch nulls dueSourceFieldId but keeps dueAnchorStepId", async () => {
		vi.mocked(getStepWithVersion).mockResolvedValue({
			step: { id: "st_2" },
			version: { id: "ver_1" },
		} as never);
		await updateStepOp(CTX, {
			stepId: "st_1",
			dueType: "offset_from_step",
			dueAnchorStepId: "st_2",
			dueOffsetDays: 2,
		});
		const arg = vi.mocked(updateStep).mock.calls[0][0];
		expect(arg.dueAnchorStepId).toBe("st_2");
		expect(arg.dueSourceFieldId).toBeNull();
	});

	it("dueType='from_date_field' patch nulls dueAnchorStepId but keeps dueSourceFieldId", async () => {
		vi.mocked(getFieldWithVersion).mockResolvedValue({
			field: { id: "fld_1", fieldType: "date" },
			version: { id: "ver_1" },
		} as never);
		await updateStepOp(CTX, {
			stepId: "st_1",
			dueType: "from_date_field",
			dueSourceFieldId: "fld_1",
			dueOffsetDays: 5,
		});
		const arg = vi.mocked(updateStep).mock.calls[0][0];
		expect(arg.dueSourceFieldId).toBe("fld_1");
		expect(arg.dueAnchorStepId).toBeNull();
	});

	it("title-only patch (no dueType) leaves companion fields untouched", async () => {
		await updateStepOp(CTX, { stepId: "st_1", title: "Renamed" });
		const arg = vi.mocked(updateStep).mock.calls[0][0];
		expect(arg.dueAnchorStepId).toBeUndefined();
		expect(arg.dueSourceFieldId).toBeUndefined();
	});

	it("createStep with dueType='none' but stray dueAnchorStepId still null-clears it", async () => {
		vi.mocked(insertStep).mockResolvedValue({ id: "st_new" });
		await createStep(CTX, {
			workflowVersionId: "ver_1",
			title: "Step",
			dueType: "none",
			dueAnchorStepId: "st_stray",
		});
		const arg = vi.mocked(insertStep).mock.calls[0][0];
		expect(arg.dueAnchorStepId).toBeNull();
		// Lookup never happens because normalize nulled the ref before assertDueRefs ran.
		expect(getStepWithVersion).not.toHaveBeenCalled();
	});
});

describe("updateFieldOp -- fieldType change guard (FIELD_TYPE_CHANGE_LOCKED)", () => {
	it("allows fieldType change when nothing references the field", async () => {
		vi.mocked(findFieldReferencers).mockResolvedValue([]);
		await expect(
			updateFieldOp(CTX, { fieldId: "fld_1", fieldType: "text" }),
		).resolves.toBeUndefined();
		expect(updateField).toHaveBeenCalledTimes(1);
	});

	it("refuses fieldType change when a from_date_field due rule references the field", async () => {
		vi.mocked(findFieldReferencers).mockResolvedValue([
			{ type: "due_source", stepId: "st_dependent" },
		]);
		const err = await updateFieldOp(CTX, {
			fieldId: "fld_1",
			fieldType: "text",
		}).catch((e) => e);
		expect(err).toBeInstanceOf(WorkflowEngineError);
		expect(err.code).toBe("FIELD_TYPE_CHANGE_LOCKED");
		expect(err.details?.fromType).toBe("date");
		expect(err.details?.toType).toBe("text");
		expect(err.details?.referencers).toEqual([
			{ type: "due_source", stepId: "st_dependent" },
		]);
		expect(updateField).not.toHaveBeenCalled();
	});

	it("refuses fieldType change when an automation condition references the field", async () => {
		vi.mocked(findFieldReferencers).mockResolvedValue([
			{ type: "condition", stepId: null },
		]);
		const err = await updateFieldOp(CTX, {
			fieldId: "fld_1",
			fieldType: "number",
		}).catch((e) => e);
		expect(err.code).toBe("FIELD_TYPE_CHANGE_LOCKED");
	});

	it("skips the referencer lookup when fieldType is not in the patch (cheap path)", async () => {
		await updateFieldOp(CTX, { fieldId: "fld_1", label: "Renamed" });
		expect(findFieldReferencers).not.toHaveBeenCalled();
		expect(updateField).toHaveBeenCalledTimes(1);
	});

	it("skips the referencer lookup when fieldType matches current (no-op change)", async () => {
		// assertFieldEditable returns fieldType: 'date'; sending 'date' again is a no-op.
		await updateFieldOp(CTX, { fieldId: "fld_1", fieldType: "date" });
		expect(findFieldReferencers).not.toHaveBeenCalled();
		expect(updateField).toHaveBeenCalledTimes(1);
	});
});
