// Run-engine hardening -- first tests for setRunFieldValue, which previously had
// zero coverage despite being a security-relevant write path: step-scoped vs
// kickoff writes, user/guest/agent/admin access gating, run-not-active defense,
// field resolution by stable key, value validation, lookup cross-row validation,
// and user/guest/agent audit attribution. Mocks @virn/database (and the recompute
// helpers transitively pulled via ./launch-run) so nothing hits a DB.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@virn/database", () => ({
	findAgentParticipantForRun: vi.fn(),
	findFieldByVersionAndKey: vi.fn(),
	getRunForOrg: vi.fn(),
	getRunStepWithRun: vi.fn(),
	upsertRunFieldValue: vi.fn(),
	validateFieldValue: vi.fn((_field, v) => v),
	validateLookupReferenceByKey: vi.fn(),
	writeAuditAndActivity: vi.fn(),
	withTransaction: vi.fn(async (fn) => fn({} as never)),
	// recomputeDueAtAfterFieldValueChange (via ./launch-run) pulls these; no-op them.
	findDueRecomputeTargets: vi.fn(async () => []),
	getDateFieldValuesForStepInRun: vi.fn(async () => []),
	updateRunStepDueAt: vi.fn(async () => undefined),
	// ./launch-run module-load imports -- shimmed so import succeeds.
	getAgentForOrg: vi.fn(),
	getLatestPublishedWorkflowVersion: vi.fn(),
	getVendorContactForLaunch: vi.fn(),
	getVersionLaunchBundle: vi.fn(),
	getWorkflowForOrg: vi.fn(),
	getWorkflowVersionById: vi.fn(),
	insertRunSnapshot: vi.fn(),
	markRunStepCompleted: vi.fn(),
	markRunCompleted: vi.fn(),
	areAllRequiredRunStepsComplete: vi.fn(),
	getRequiredFieldsForStep: vi.fn(),
	getFieldValuesForRun: vi.fn(),
	findIncompleteStopDependencies: vi.fn(),
	enqueueCrossProductEventForRun: vi.fn(async () => null),
}));

vi.mock("../../../inngest/client", () => ({
	inngest: { send: vi.fn(async () => ({ ids: [] })) },
}));

import {
	findAgentParticipantForRun,
	findFieldByVersionAndKey,
	getRunForOrg,
	getRunStepWithRun,
	upsertRunFieldValue,
	validateFieldValue,
	validateLookupReferenceByKey,
	writeAuditAndActivity,
} from "@virn/database";

import { setRunFieldValue } from "./set-field-value";

const ORG = "org_1";

const RS_STEP = {
	id: "rs_1",
	runId: "run_1",
	stepId: "step_1",
	status: "pending" as const,
	run: { id: "run_1", organizationId: ORG, status: "active" as const, workflowVersionId: "ver_1" },
	assignees: [{ participant: { id: "part_user_1", userId: "user_1" } }],
};

const TEXT_FIELD = { id: "f_1", fieldType: "text", config: null, isRequired: false, label: "Notes" };

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(validateFieldValue).mockImplementation((_field, v) => v);
	vi.mocked(writeAuditAndActivity).mockResolvedValue(undefined);
	vi.mocked(upsertRunFieldValue).mockResolvedValue(undefined as never);
	vi.mocked(findFieldByVersionAndKey).mockResolvedValue(TEXT_FIELD as never);
});

// ---------------------------------------------------------------------------
// Step-scoped writes -- access gating
// ---------------------------------------------------------------------------

describe("setRunFieldValue -- step-scoped access gating", () => {
	const ASSIGNEE = { organizationId: ORG, userId: "user_1", isAdminOrOwner: false };

	it("RUN_STEP_NOT_FOUND when the step isn't in this org", async () => {
		vi.mocked(getRunStepWithRun).mockResolvedValueOnce(null as never);
		await expect(
			setRunFieldValue(ASSIGNEE, { runStepId: "rs_x", fieldKey: "notes", value: "hi" }),
		).rejects.toMatchObject({ code: "RUN_STEP_NOT_FOUND" });
	});

	it("RUN_STEP_ALREADY_COMPLETED when the step is completed", async () => {
		vi.mocked(getRunStepWithRun).mockResolvedValueOnce({ ...RS_STEP, status: "completed" } as never);
		await expect(
			setRunFieldValue(ASSIGNEE, { runStepId: "rs_1", fieldKey: "notes", value: "hi" }),
		).rejects.toMatchObject({ code: "RUN_STEP_ALREADY_COMPLETED" });
		expect(upsertRunFieldValue).not.toHaveBeenCalled();
	});

	it("RUN_NOT_ACTIVE when the parent run is not active", async () => {
		vi.mocked(getRunStepWithRun).mockResolvedValueOnce({
			...RS_STEP,
			run: { ...RS_STEP.run, status: "completed" },
		} as never);
		await expect(
			setRunFieldValue(ASSIGNEE, { runStepId: "rs_1", fieldKey: "notes", value: "hi" }),
		).rejects.toMatchObject({ code: "RUN_NOT_ACTIVE", details: { runStatus: "completed" } });
	});

	it("RUN_STEP_ACCESS_DENIED when a non-admin caller isn't an assignee", async () => {
		vi.mocked(getRunStepWithRun).mockResolvedValueOnce(RS_STEP as never);
		await expect(
			setRunFieldValue(
				{ organizationId: ORG, userId: "user_other", isAdminOrOwner: false },
				{ runStepId: "rs_1", fieldKey: "notes", value: "hi" },
			),
		).rejects.toMatchObject({ code: "RUN_STEP_ACCESS_DENIED" });
		expect(upsertRunFieldValue).not.toHaveBeenCalled();
	});

	it("an admin bypasses the assignee check", async () => {
		vi.mocked(getRunStepWithRun).mockResolvedValueOnce(RS_STEP as never);
		const res = await setRunFieldValue(
			{ organizationId: ORG, userId: "admin_1", isAdminOrOwner: true },
			{ runStepId: "rs_1", fieldKey: "notes", value: "hi" },
		);
		expect(res).toEqual({ ok: true });
		expect(upsertRunFieldValue).toHaveBeenCalledWith(
			{ runId: "run_1", runStepId: "rs_1", fieldId: "f_1", value: "hi" },
			expect.anything(),
		);
	});

	it("an assignee may write + the audit attributes actorKind=user", async () => {
		vi.mocked(getRunStepWithRun).mockResolvedValueOnce(RS_STEP as never);
		const res = await setRunFieldValue(ASSIGNEE, { runStepId: "rs_1", fieldKey: "notes", value: "hi" });
		expect(res).toEqual({ ok: true });
		expect(writeAuditAndActivity).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "field_value.set",
				actorKind: "user",
				actorUserId: "user_1",
				entityType: "field_value",
			}),
			expect.anything(),
		);
	});

	it("a guest (participantId) assignee may write + the audit attributes actorKind=guest", async () => {
		vi.mocked(getRunStepWithRun).mockResolvedValueOnce({
			...RS_STEP,
			assignees: [{ participant: { id: "part_guest", userId: null } }],
		} as never);
		await setRunFieldValue(
			{ organizationId: ORG, participantId: "part_guest", isAdminOrOwner: false },
			{ runStepId: "rs_1", fieldKey: "notes", value: "hi" },
		);
		expect(writeAuditAndActivity).toHaveBeenCalledWith(
			expect.objectContaining({ actorKind: "guest", actorParticipantId: "part_guest" }),
			expect.anything(),
		);
	});
});

// ---------------------------------------------------------------------------
// Agent principal (ADR-006)
// ---------------------------------------------------------------------------

describe("setRunFieldValue -- agent principal", () => {
	const AGENT = { organizationId: ORG, agentId: "agent_1", isAdminOrOwner: false };
	const RS_AGENT = {
		...RS_STEP,
		assignees: [{ participant: { id: "part_agent_1", userId: null } }],
	};

	it("RUN_STEP_ACCESS_DENIED when the agent isn't a participant on the run", async () => {
		vi.mocked(getRunStepWithRun).mockResolvedValueOnce(RS_AGENT as never);
		vi.mocked(findAgentParticipantForRun).mockResolvedValueOnce(null as never);
		await expect(
			setRunFieldValue(AGENT, { runStepId: "rs_1", fieldKey: "notes", value: "hi" }),
		).rejects.toMatchObject({ code: "RUN_STEP_ACCESS_DENIED" });
	});

	it("RUN_STEP_ACCESS_DENIED when the agent is a participant but not an assignee", async () => {
		vi.mocked(getRunStepWithRun).mockResolvedValueOnce({
			...RS_AGENT,
			assignees: [{ participant: { id: "part_other", userId: null } }],
		} as never);
		vi.mocked(findAgentParticipantForRun).mockResolvedValueOnce({ id: "part_agent_1" } as never);
		await expect(
			setRunFieldValue(AGENT, { runStepId: "rs_1", fieldKey: "notes", value: "hi" }),
		).rejects.toMatchObject({ code: "RUN_STEP_ACCESS_DENIED" });
	});

	it("an assigned agent may write + the audit attributes actorKind=agent + ids", async () => {
		vi.mocked(getRunStepWithRun).mockResolvedValueOnce(RS_AGENT as never);
		vi.mocked(findAgentParticipantForRun).mockResolvedValueOnce({ id: "part_agent_1" } as never);
		await setRunFieldValue(
			{ ...AGENT, crossProductOrigin: "virn-pm" },
			{ runStepId: "rs_1", fieldKey: "notes", value: "hi" },
		);
		expect(writeAuditAndActivity).toHaveBeenCalledWith(
			expect.objectContaining({
				actorKind: "agent",
				actorParticipantId: "part_agent_1",
				crossProductOrigin: "virn-pm",
				changes: expect.objectContaining({ actorAgentId: "agent_1" }),
			}),
			expect.anything(),
		);
	});
});

// ---------------------------------------------------------------------------
// Kickoff (runStepId === null) writes -- admin-only escape hatch
// ---------------------------------------------------------------------------

describe("setRunFieldValue -- kickoff writes", () => {
	const ADMIN = { organizationId: ORG, userId: "admin_1", isAdminOrOwner: true };
	const ACTIVE_RUN = { id: "run_1", organizationId: ORG, status: "active", workflowVersionId: "ver_1" };

	it("refuses an agent caller (agents cannot edit kickoff fields)", async () => {
		await expect(
			setRunFieldValue(
				{ organizationId: ORG, agentId: "agent_1", isAdminOrOwner: false },
				{ runStepId: null, runId: "run_1", fieldKey: "prop", value: "x" },
			),
		).rejects.toMatchObject({ code: "RUN_STEP_ACCESS_DENIED" });
	});

	it("refuses a non-admin caller", async () => {
		await expect(
			setRunFieldValue(
				{ organizationId: ORG, userId: "user_1", isAdminOrOwner: false },
				{ runStepId: null, runId: "run_1", fieldKey: "prop", value: "x" },
			),
		).rejects.toMatchObject({ code: "RUN_STEP_ACCESS_DENIED" });
	});

	it("RUN_NOT_FOUND when runId is missing on a kickoff write", async () => {
		await expect(
			setRunFieldValue(ADMIN, { runStepId: null, fieldKey: "prop", value: "x" }),
		).rejects.toMatchObject({ code: "RUN_NOT_FOUND" });
	});

	it("RUN_NOT_FOUND when the run isn't in this org", async () => {
		vi.mocked(getRunForOrg).mockResolvedValueOnce(null as never);
		await expect(
			setRunFieldValue(ADMIN, { runStepId: null, runId: "run_x", fieldKey: "prop", value: "x" }),
		).rejects.toMatchObject({ code: "RUN_NOT_FOUND" });
	});

	it("RUN_NOT_ACTIVE when the run is not active", async () => {
		vi.mocked(getRunForOrg).mockResolvedValueOnce({ ...ACTIVE_RUN, status: "archived" } as never);
		await expect(
			setRunFieldValue(ADMIN, { runStepId: null, runId: "run_1", fieldKey: "prop", value: "x" }),
		).rejects.toMatchObject({ code: "RUN_NOT_ACTIVE" });
	});

	it("an admin kickoff write upserts with runStepId null", async () => {
		vi.mocked(getRunForOrg).mockResolvedValueOnce(ACTIVE_RUN as never);
		const res = await setRunFieldValue(ADMIN, {
			runStepId: null,
			runId: "run_1",
			fieldKey: "prop",
			value: "Maple St",
		});
		expect(res).toEqual({ ok: true });
		expect(upsertRunFieldValue).toHaveBeenCalledWith(
			{ runId: "run_1", runStepId: null, fieldId: "f_1", value: "Maple St" },
			expect.anything(),
		);
	});
});

// ---------------------------------------------------------------------------
// Field resolution + value validation
// ---------------------------------------------------------------------------

describe("setRunFieldValue -- field resolution + validation", () => {
	const ASSIGNEE = { organizationId: ORG, userId: "user_1", isAdminOrOwner: false };

	beforeEach(() => {
		vi.mocked(getRunStepWithRun).mockResolvedValue(RS_STEP as never);
	});

	it("UNKNOWN_FIELD_KEY when the key isn't in the version", async () => {
		vi.mocked(findFieldByVersionAndKey).mockResolvedValueOnce(null as never);
		await expect(
			setRunFieldValue(ASSIGNEE, { runStepId: "rs_1", fieldKey: "ghost", value: "x" }),
		).rejects.toMatchObject({ code: "UNKNOWN_FIELD_KEY" });
	});

	it("FIELD_VALUE_INVALID when the shape validator throws", async () => {
		vi.mocked(validateFieldValue).mockImplementationOnce(() => {
			throw new Error("expected a number");
		});
		await expect(
			setRunFieldValue(ASSIGNEE, { runStepId: "rs_1", fieldKey: "notes", value: "x" }),
		).rejects.toMatchObject({ code: "FIELD_VALUE_INVALID" });
		expect(upsertRunFieldValue).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// Lookup field cross-row validation (Phase 9b)
// ---------------------------------------------------------------------------

describe("setRunFieldValue -- lookup cross-row validation", () => {
	const ASSIGNEE = { organizationId: ORG, userId: "user_1", isAdminOrOwner: false };
	const LOOKUP_FIELD = {
		id: "f_l",
		fieldType: "lookup",
		config: { dataSetKey: "vendors" },
		isRequired: false,
		label: "Vendor",
	};

	beforeEach(() => {
		vi.mocked(getRunStepWithRun).mockResolvedValue(RS_STEP as never);
	});

	it("FIELD_VALUE_INVALID when the lookup field has no dataSetKey configured", async () => {
		vi.mocked(findFieldByVersionAndKey).mockResolvedValueOnce({ ...LOOKUP_FIELD, config: {} } as never);
		await expect(
			setRunFieldValue(ASSIGNEE, { runStepId: "rs_1", fieldKey: "vendor", value: "rec_1" }),
		).rejects.toMatchObject({ code: "FIELD_VALUE_INVALID" });
	});

	it("FIELD_VALUE_INVALID when the validated lookup value isn't a string id", async () => {
		vi.mocked(findFieldByVersionAndKey).mockResolvedValueOnce(LOOKUP_FIELD as never);
		await expect(
			setRunFieldValue(ASSIGNEE, { runStepId: "rs_1", fieldKey: "vendor", value: 42 }),
		).rejects.toMatchObject({ code: "FIELD_VALUE_INVALID" });
		expect(validateLookupReferenceByKey).not.toHaveBeenCalled();
	});

	it("FIELD_VALUE_INVALID when the referenced record fails validation", async () => {
		vi.mocked(findFieldByVersionAndKey).mockResolvedValueOnce(LOOKUP_FIELD as never);
		vi.mocked(validateLookupReferenceByKey).mockResolvedValueOnce({ ok: false, reason: "dataset_missing" } as never);
		await expect(
			setRunFieldValue(ASSIGNEE, { runStepId: "rs_1", fieldKey: "vendor", value: "rec_1" }),
		).rejects.toMatchObject({ code: "FIELD_VALUE_INVALID" });
		expect(upsertRunFieldValue).not.toHaveBeenCalled();
	});

	it("writes when the referenced record is valid", async () => {
		vi.mocked(findFieldByVersionAndKey).mockResolvedValueOnce(LOOKUP_FIELD as never);
		vi.mocked(validateLookupReferenceByKey).mockResolvedValueOnce({ ok: true } as never);
		const res = await setRunFieldValue(ASSIGNEE, { runStepId: "rs_1", fieldKey: "vendor", value: "rec_1" });
		expect(res).toEqual({ ok: true });
		expect(validateLookupReferenceByKey).toHaveBeenCalledWith({
			organizationId: ORG,
			dataSetKey: "vendors",
			recordId: "rec_1",
		});
		expect(upsertRunFieldValue).toHaveBeenCalled();
	});

	it("skips lookup cross-row validation when clearing the value (null)", async () => {
		vi.mocked(findFieldByVersionAndKey).mockResolvedValueOnce(LOOKUP_FIELD as never);
		await setRunFieldValue(ASSIGNEE, { runStepId: "rs_1", fieldKey: "vendor", value: null });
		expect(validateLookupReferenceByKey).not.toHaveBeenCalled();
		expect(upsertRunFieldValue).toHaveBeenCalledWith(
			expect.objectContaining({ value: null }),
			expect.anything(),
		);
	});
});
