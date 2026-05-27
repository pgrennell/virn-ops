import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@virn/database", () => ({
	getAgentForOrg: vi.fn(),
	getWorkflowForOrg: vi.fn(),
	getLatestPublishedWorkflowVersion: vi.fn(),
	getWorkflowVersionById: vi.fn(),
	getVersionLaunchBundle: vi.fn(),
	insertRunSnapshot: vi.fn(),
	writeAuditAndActivity: vi.fn(),
	// validateFieldValue is pure -- test it via real behavior, no need to mock unless the
	// test specifically exercises validation paths. We mock to a passthrough.
	validateFieldValue: vi.fn((_field: unknown, value: unknown) => value),
}));

import {
	getAgentForOrg,
	getLatestPublishedWorkflowVersion,
	getVersionLaunchBundle,
	getWorkflowForOrg,
	getWorkflowVersionById,
	insertRunSnapshot,
	writeAuditAndActivity,
} from "@virn/database";

import { launchRun, computeStepDueAt } from "./launch-run";

const CTX = { organizationId: "org_1", userId: "user_1" };

const WF = {
	id: "wf_1",
	organizationId: "org_1",
	title: "Onboarding",
	type: "procedure",
};

const VERSION_PUBLISHED = {
	id: "ver_1",
	workflowId: "wf_1",
	versionNumber: 3,
	status: "published" as const,
};

const STEP_ROW = (overrides: Partial<Record<string, unknown>> = {}) => ({
	id: "step_1",
	workflowVersionId: "ver_1",
	sectionId: null,
	assignedRoleId: null,
	type: "task",
	title: "First task",
	description: null,
	position: 0,
	isRequired: true,
	requiresAllAssignees: false,
	isStopTask: false,
	hiddenByDefault: false,
	dueType: "none",
	dueOffsetDays: null,
	dueAnchorStepId: null,
	dueSourceFieldId: null,
	...overrides,
});

const FIELD_ROW = (overrides: Partial<Record<string, unknown>> = {}) => ({
	id: "field_1",
	workflowVersionId: "ver_1",
	stepId: null,
	key: "customer_name",
	label: "Customer name",
	fieldType: "text",
	config: null,
	isRequired: false,
	position: 0,
	...overrides,
});

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(insertRunSnapshot).mockResolvedValue({
		runId: "run_new",
		runStepIdByStepId: new Map([["step_1", "rs_1"]]),
	});
	vi.mocked(writeAuditAndActivity).mockResolvedValue(undefined);
});

describe("launchRun", () => {
	it("WORKFLOW_NOT_FOUND when the workflow is not in the org", async () => {
		vi.mocked(getWorkflowForOrg).mockResolvedValueOnce(null);
		await expect(
			launchRun(CTX, { workflowId: "wf_missing", kickoffValues: {}, roleAssignments: [] }),
		).rejects.toMatchObject({ code: "WORKFLOW_NOT_FOUND" });
	});

	it("NO_PUBLISHED_VERSION when the workflow has no published versions", async () => {
		vi.mocked(getWorkflowForOrg).mockResolvedValueOnce(WF as never);
		vi.mocked(getLatestPublishedWorkflowVersion).mockResolvedValueOnce(null);
		await expect(
			launchRun(CTX, { workflowId: "wf_1", kickoffValues: {}, roleAssignments: [] }),
		).rejects.toMatchObject({ code: "NO_PUBLISHED_VERSION" });
	});

	it("VERSION_NOT_PUBLISHED when a draft version is explicitly requested", async () => {
		vi.mocked(getWorkflowForOrg).mockResolvedValueOnce(WF as never);
		vi.mocked(getWorkflowVersionById).mockResolvedValueOnce({
			...VERSION_PUBLISHED,
			status: "draft",
		} as never);
		await expect(
			launchRun(CTX, {
				workflowId: "wf_1",
				workflowVersionId: "ver_1",
				kickoffValues: {},
				roleAssignments: [],
			}),
		).rejects.toMatchObject({ code: "VERSION_NOT_PUBLISHED" });
	});

	it("VERSION_NOT_FOUND when the explicit version belongs to a different workflow", async () => {
		vi.mocked(getWorkflowForOrg).mockResolvedValueOnce(WF as never);
		vi.mocked(getWorkflowVersionById).mockResolvedValueOnce({
			...VERSION_PUBLISHED,
			workflowId: "wf_OTHER",
		} as never);
		await expect(
			launchRun(CTX, {
				workflowId: "wf_1",
				workflowVersionId: "ver_1",
				kickoffValues: {},
				roleAssignments: [],
			}),
		).rejects.toMatchObject({ code: "VERSION_NOT_FOUND" });
	});

	it("INVALID_ROLE_ASSIGNMENT when an assignment supplies both userId and guestEmail", async () => {
		vi.mocked(getWorkflowForOrg).mockResolvedValueOnce(WF as never);
		vi.mocked(getLatestPublishedWorkflowVersion).mockResolvedValueOnce(VERSION_PUBLISHED as never);
		vi.mocked(getVersionLaunchBundle).mockResolvedValueOnce({
			steps: [STEP_ROW()],
			fields: [],
			deps: [],
		} as never);
		await expect(
			launchRun(CTX, {
				workflowId: "wf_1",
				kickoffValues: {},
				roleAssignments: [
					{ roleId: "role_a", userId: "u_1", guestEmail: "g@example.com" },
				],
			}),
		).rejects.toMatchObject({ code: "INVALID_ROLE_ASSIGNMENT" });
	});

	it("UNKNOWN_FIELD_KEY when kickoffValues references a key not in the version", async () => {
		vi.mocked(getWorkflowForOrg).mockResolvedValueOnce(WF as never);
		vi.mocked(getLatestPublishedWorkflowVersion).mockResolvedValueOnce(VERSION_PUBLISHED as never);
		vi.mocked(getVersionLaunchBundle).mockResolvedValueOnce({
			steps: [STEP_ROW()],
			fields: [FIELD_ROW({ key: "customer_name" })],
			deps: [],
		} as never);
		await expect(
			launchRun(CTX, {
				workflowId: "wf_1",
				kickoffValues: { not_a_real_key: "x" },
				roleAssignments: [],
			}),
		).rejects.toMatchObject({ code: "UNKNOWN_FIELD_KEY" });
	});

	it("REQUIRED_KICKOFF_FIELD_MISSING when a required kickoff field has no value provided", async () => {
		vi.mocked(getWorkflowForOrg).mockResolvedValueOnce(WF as never);
		vi.mocked(getLatestPublishedWorkflowVersion).mockResolvedValueOnce(VERSION_PUBLISHED as never);
		vi.mocked(getVersionLaunchBundle).mockResolvedValueOnce({
			steps: [STEP_ROW()],
			fields: [FIELD_ROW({ key: "customer_name", isRequired: true })],
			deps: [],
		} as never);
		await expect(
			launchRun(CTX, {
				workflowId: "wf_1",
				kickoffValues: {}, // empty
				roleAssignments: [],
			}),
		).rejects.toMatchObject({ code: "REQUIRED_KICKOFF_FIELD_MISSING" });
	});

	it("happy path: snapshots steps + kickoff + assignments and emits audit/activity", async () => {
		vi.mocked(getWorkflowForOrg).mockResolvedValueOnce(WF as never);
		vi.mocked(getLatestPublishedWorkflowVersion).mockResolvedValueOnce(VERSION_PUBLISHED as never);
		vi.mocked(getVersionLaunchBundle).mockResolvedValueOnce({
			steps: [
				STEP_ROW({
					id: "step_a",
					assignedRoleId: "role_a",
					title: "Welcome call",
					dueType: "offset_from_start",
					dueOffsetDays: 1,
				}),
				STEP_ROW({
					id: "step_b",
					assignedRoleId: null,
					title: "Send packet",
					position: 1,
					dueType: "none",
				}),
			],
			fields: [FIELD_ROW({ key: "customer_name" })],
			deps: [],
		} as never);

		const result = await launchRun(CTX, {
			workflowId: "wf_1",
			kickoffValues: { customer_name: "Acme Co" },
			roleAssignments: [{ roleId: "role_a", userId: "u_member" }],
			title: "Custom title",
		});

		expect(result.runId).toBe("run_new");

		const [snapshotArg] = vi.mocked(insertRunSnapshot).mock.calls[0];
		expect(snapshotArg).toMatchObject({
			organizationId: "org_1",
			workflowId: "wf_1",
			workflowVersionId: "ver_1",
			title: "Custom title",
			createdBy: "user_1",
		});
		// Two steps materialized, titles snapshotted by value.
		expect(snapshotArg.steps).toHaveLength(2);
		expect(snapshotArg.steps.map((s) => s.title)).toEqual(["Welcome call", "Send packet"]);
		// First step's dueAt is roughly startedAt + 1 day; second is null.
		expect(snapshotArg.steps[0].dueAt).toBeInstanceOf(Date);
		expect(snapshotArg.steps[1].dueAt).toBeNull();
		// Kickoff value made it through.
		expect(snapshotArg.kickoffValues).toEqual([{ fieldId: "field_1", value: "Acme Co" }]);
		// One participant + one role assignment + one step-assignment (step_a's role matched).
		expect(snapshotArg.participants).toHaveLength(1);
		expect(snapshotArg.roleAssignments).toEqual([
			{ roleId: "role_a", participantTempKey: "p_0" },
		]);
		expect(snapshotArg.stepAssignments).toEqual([
			{ stepId: "step_a", participantTempKey: "p_0" },
		]);

		// Append-only writes fired once.
		expect(writeAuditAndActivity).toHaveBeenCalledTimes(1);
		expect(writeAuditAndActivity).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "run.launched",
				verb: "launched",
				entityType: "run",
				entityId: "run_new",
			}),
		);
	});
});

// ---------------------------------------------------------------------------
// Mode-aware launch (Phase 8 step 3) -- the S-07 wedge: one procedure runs
// three ways (human / ai_assisted / automated). The role-based assignment
// path is verified above; these tests cover the agent assignment shaping +
// the refusal codes.
// ---------------------------------------------------------------------------

const ACTIVE_AGENT = {
	id: "agt_1",
	name: "Turnover AI",
	description: null,
	isActive: true,
	credentialLastFour: "a3f9",
	credentialRotatedAt: new Date(),
	createdByUserId: "user_1",
	createdByUserName: "U",
	createdAt: new Date(),
	updatedAt: new Date(),
};

describe("launchRun -- mode-aware (Phase 8 step 3)", () => {
	// Two-step workflow: step_a is a normal task, step_b is an AI-typed step.
	function mountTwoStepBundleWithRoleAssignment() {
		vi.mocked(getWorkflowForOrg).mockResolvedValueOnce(WF as never);
		vi.mocked(getLatestPublishedWorkflowVersion).mockResolvedValueOnce(VERSION_PUBLISHED as never);
		vi.mocked(getVersionLaunchBundle).mockResolvedValueOnce({
			steps: [
				STEP_ROW({
					id: "step_a",
					assignedRoleId: "role_a",
					title: "Inspect rooms",
					type: "task",
				}),
				STEP_ROW({
					id: "step_b",
					assignedRoleId: "role_a",
					title: "Photo write-up",
					position: 1,
					type: "ai",
				}),
			],
			fields: [],
			deps: [],
		} as never);
		vi.mocked(insertRunSnapshot).mockResolvedValueOnce({
			runId: "run_new",
			runStepIdByStepId: new Map([
				["step_a", "rs_a"],
				["step_b", "rs_b"],
			]),
		});
	}

	it("MODE_REQUIRES_AGENT when mode is ai_assisted but agentId is null", async () => {
		mountTwoStepBundleWithRoleAssignment();
		await expect(
			launchRun(CTX, {
				workflowId: "wf_1",
				kickoffValues: {},
				roleAssignments: [{ roleId: "role_a", userId: "u_member" }],
				mode: "ai_assisted",
				agentId: null,
			}),
		).rejects.toMatchObject({ code: "MODE_REQUIRES_AGENT" });
	});

	it("AGENT_NOT_IN_ORG when the agent isn't in this org (getAgentForOrg returns null)", async () => {
		mountTwoStepBundleWithRoleAssignment();
		vi.mocked(getAgentForOrg).mockResolvedValueOnce(null);
		await expect(
			launchRun(CTX, {
				workflowId: "wf_1",
				kickoffValues: {},
				roleAssignments: [{ roleId: "role_a", userId: "u_member" }],
				mode: "ai_assisted",
				agentId: "agt_cross_org",
			}),
		).rejects.toMatchObject({ code: "AGENT_NOT_IN_ORG" });
	});

	it("AGENT_INACTIVE when the agent is disabled (isActive=false)", async () => {
		mountTwoStepBundleWithRoleAssignment();
		vi.mocked(getAgentForOrg).mockResolvedValueOnce({
			...ACTIVE_AGENT,
			isActive: false,
		} as never);
		await expect(
			launchRun(CTX, {
				workflowId: "wf_1",
				kickoffValues: {},
				roleAssignments: [{ roleId: "role_a", userId: "u_member" }],
				mode: "ai_assisted",
				agentId: ACTIVE_AGENT.id,
			}),
		).rejects.toMatchObject({ code: "AGENT_INACTIVE" });
	});

	it("ai_assisted: agent participant created, agent assigned to AI step, human keeps non-AI step", async () => {
		mountTwoStepBundleWithRoleAssignment();
		vi.mocked(getAgentForOrg).mockResolvedValueOnce(ACTIVE_AGENT as never);

		await launchRun(CTX, {
			workflowId: "wf_1",
			kickoffValues: {},
			roleAssignments: [{ roleId: "role_a", userId: "u_member" }],
			mode: "ai_assisted",
			agentId: ACTIVE_AGENT.id,
		});

		const [arg] = vi.mocked(insertRunSnapshot).mock.calls[0];
		// Two participants: the role's human + the agent.
		expect(arg.participants).toHaveLength(2);
		const agentP = arg.participants.find((p) => p.kind === "agent");
		expect(agentP).toBeDefined();
		expect(agentP?.agentId).toBe(ACTIVE_AGENT.id);
		expect(agentP?.userId).toBeNull();
		expect(agentP?.guestEmail).toBeNull();
		const humanP = arg.participants.find((p) => p.kind === "user");
		expect(humanP).toBeDefined();
		expect(humanP?.userId).toBe("u_member");

		// step_a (task) -> human; step_b (ai) -> agent. One-handler-per-step semantic.
		expect(arg.stepAssignments).toHaveLength(2);
		const aAssign = arg.stepAssignments.find((s) => s.stepId === "step_a");
		const bAssign = arg.stepAssignments.find((s) => s.stepId === "step_b");
		expect(aAssign?.participantTempKey).toBe(humanP?.tempKey);
		expect(bAssign?.participantTempKey).toBe(agentP?.tempKey);
	});

	it("automated: agent assigned to ALL steps regardless of step.type; role-based assignees skipped", async () => {
		mountTwoStepBundleWithRoleAssignment();
		vi.mocked(getAgentForOrg).mockResolvedValueOnce(ACTIVE_AGENT as never);

		await launchRun(CTX, {
			workflowId: "wf_1",
			kickoffValues: {},
			roleAssignments: [{ roleId: "role_a", userId: "u_member" }],
			mode: "automated",
			agentId: ACTIVE_AGENT.id,
		});

		const [arg] = vi.mocked(insertRunSnapshot).mock.calls[0];
		// Human participant still created (the role assignment row needs a target), but it
		// owns no steps -- the agent takes everything in automated mode.
		const agentP = arg.participants.find((p) => p.kind === "agent");
		expect(agentP).toBeDefined();

		expect(arg.stepAssignments).toHaveLength(2);
		expect(arg.stepAssignments.every((s) => s.participantTempKey === agentP?.tempKey)).toBe(
			true,
		);
	});

	it("ai_assisted with zero AI steps in the bundle: no agent participant, no step swap", async () => {
		// Override the standard mount: bundle has no AI-typed steps.
		vi.mocked(getWorkflowForOrg).mockResolvedValueOnce(WF as never);
		vi.mocked(getLatestPublishedWorkflowVersion).mockResolvedValueOnce(VERSION_PUBLISHED as never);
		vi.mocked(getVersionLaunchBundle).mockResolvedValueOnce({
			steps: [STEP_ROW({ id: "step_a", assignedRoleId: "role_a", type: "task" })],
			fields: [],
			deps: [],
		} as never);
		vi.mocked(insertRunSnapshot).mockResolvedValueOnce({
			runId: "run_new",
			runStepIdByStepId: new Map([["step_a", "rs_a"]]),
		});
		vi.mocked(getAgentForOrg).mockResolvedValueOnce(ACTIVE_AGENT as never);

		await launchRun(CTX, {
			workflowId: "wf_1",
			kickoffValues: {},
			roleAssignments: [{ roleId: "role_a", userId: "u_member" }],
			mode: "ai_assisted",
			agentId: ACTIVE_AGENT.id,
		});

		const [arg] = vi.mocked(insertRunSnapshot).mock.calls[0];
		// No dead agent participant rows for modes that ended up owning nothing.
		expect(arg.participants.find((p) => p.kind === "agent")).toBeUndefined();
		// The single step keeps the human role assignment.
		expect(arg.stepAssignments).toEqual([
			{ stepId: "step_a", participantTempKey: arg.participants[0].tempKey },
		]);
	});

	it("audit row records mode + agentId + agentHandledStepCount in changes", async () => {
		mountTwoStepBundleWithRoleAssignment();
		vi.mocked(getAgentForOrg).mockResolvedValueOnce(ACTIVE_AGENT as never);

		await launchRun(CTX, {
			workflowId: "wf_1",
			kickoffValues: {},
			roleAssignments: [{ roleId: "role_a", userId: "u_member" }],
			mode: "automated",
			agentId: ACTIVE_AGENT.id,
		});

		expect(writeAuditAndActivity).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "run.launched",
				changes: expect.objectContaining({
					mode: "automated",
					agentId: ACTIVE_AGENT.id,
					agentHandledStepCount: 2,
				}),
			}),
		);
	});

	it("default mode='human' (input omits mode): no agent lookup, existing role-based assignment unchanged", async () => {
		mountTwoStepBundleWithRoleAssignment();

		await launchRun(CTX, {
			workflowId: "wf_1",
			kickoffValues: {},
			roleAssignments: [{ roleId: "role_a", userId: "u_member" }],
			// mode + agentId both omitted
		});

		expect(getAgentForOrg).not.toHaveBeenCalled();
		const [arg] = vi.mocked(insertRunSnapshot).mock.calls[0];
		expect(arg.participants.find((p) => p.kind === "agent")).toBeUndefined();
		// Both steps assigned to the human (one-handler matches assignedRoleId).
		expect(arg.stepAssignments).toHaveLength(2);
		expect(arg.stepAssignments.every((s) => s.participantTempKey === arg.participants[0].tempKey)).toBe(true);
	});
});

describe("computeStepDueAt", () => {
	const start = new Date("2026-05-25T12:00:00Z");
	it("returns null for due_type=none", () => {
		expect(computeStepDueAt(start, "none", null)).toBeNull();
	});
	it("returns null for due_type=offset_from_step (deferred)", () => {
		expect(computeStepDueAt(start, "offset_from_step", 3)).toBeNull();
	});
	it("returns null for due_type=from_date_field (deferred)", () => {
		expect(computeStepDueAt(start, "from_date_field", 3)).toBeNull();
	});
	it("returns null for offset_from_start with no offset configured", () => {
		expect(computeStepDueAt(start, "offset_from_start", null)).toBeNull();
	});
	it("adds dueOffsetDays for offset_from_start", () => {
		const due = computeStepDueAt(start, "offset_from_start", 3);
		expect(due).not.toBeNull();
		const diffMs = due!.getTime() - start.getTime();
		expect(diffMs).toBe(3 * 24 * 60 * 60 * 1000);
	});
});
