import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@virn/database", () => ({
	findAgentParticipantForRun: vi.fn(),
	getRunStepWithRun: vi.fn(),
	getRequiredFieldsForStep: vi.fn(),
	getFieldValuesForRun: vi.fn(),
	findIncompleteStopDependencies: vi.fn(),
	markRunStepCompleted: vi.fn(),
	areAllRequiredRunStepsComplete: vi.fn(),
	markRunCompleted: vi.fn(),
	writeAuditAndActivity: vi.fn(),
	// `withTransaction` is the helper from packages/database/drizzle/client.ts; in tests
	// we run the callback directly with a stub `tx` so the mutation helpers (already
	// mocked above) record their calls. Real transactional semantics are exercised by
	// integration tests.
	withTransaction: vi.fn(async (fn) => fn({} as never)),
}));

import {
	areAllRequiredRunStepsComplete,
	findAgentParticipantForRun,
	findIncompleteStopDependencies,
	getFieldValuesForRun,
	getRequiredFieldsForStep,
	getRunStepWithRun,
	markRunCompleted,
	markRunStepCompleted,
	writeAuditAndActivity,
} from "@virn/database";

import { completeRunStep } from "./complete-step";

const CTX = { organizationId: "org_1", userId: "user_1", isAdminOrOwner: false };

const RS_PENDING_AS_ASSIGNEE = {
	id: "rs_1",
	runId: "run_1",
	stepId: "step_1",
	title: "Confirm appointment",
	description: null,
	position: 0,
	status: "pending" as const,
	assignedRoleId: null,
	dueAt: null,
	completedBy: null,
	completedAt: null,
	run: {
		id: "run_1",
		organizationId: "org_1",
		status: "active" as const,
		workflowVersionId: "ver_1",
	},
	assignees: [{ participant: { userId: "user_1" } }],
};

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(markRunStepCompleted).mockResolvedValue(undefined);
	// markRunCompleted now returns a boolean indicating whether it actually
	// transitioned the row from 'active' to 'completed' (G3 race fix). Default
	// the mock to `true` (transition succeeded) — tests that exercise the
	// lost-race path override it explicitly.
	vi.mocked(markRunCompleted).mockResolvedValue(true);
	vi.mocked(writeAuditAndActivity).mockResolvedValue(undefined);
	vi.mocked(getRequiredFieldsForStep).mockResolvedValue([]);
	vi.mocked(getFieldValuesForRun).mockResolvedValue([]);
	vi.mocked(findIncompleteStopDependencies).mockResolvedValue([]);
	vi.mocked(areAllRequiredRunStepsComplete).mockResolvedValue(false);
});

describe("completeRunStep", () => {
	it("RUN_STEP_NOT_FOUND when no row matches (or wrong org)", async () => {
		vi.mocked(getRunStepWithRun).mockResolvedValueOnce(null);
		await expect(completeRunStep(CTX, "rs_missing")).rejects.toMatchObject({
			code: "RUN_STEP_NOT_FOUND",
		});
	});

	it("RUN_STEP_ALREADY_COMPLETED when status is completed", async () => {
		vi.mocked(getRunStepWithRun).mockResolvedValueOnce({
			...RS_PENDING_AS_ASSIGNEE,
			status: "completed",
		} as never);
		await expect(completeRunStep(CTX, "rs_1")).rejects.toMatchObject({
			code: "RUN_STEP_ALREADY_COMPLETED",
		});
	});

	it("RUN_STEP_ACCESS_DENIED when caller is not assignee and not admin", async () => {
		vi.mocked(getRunStepWithRun).mockResolvedValueOnce({
			...RS_PENDING_AS_ASSIGNEE,
			assignees: [{ participant: { userId: "someone_else" } }],
		} as never);
		await expect(completeRunStep(CTX, "rs_1")).rejects.toMatchObject({
			code: "RUN_STEP_ACCESS_DENIED",
		});
	});

	it("admin bypasses assignee check", async () => {
		vi.mocked(getRunStepWithRun).mockResolvedValueOnce({
			...RS_PENDING_AS_ASSIGNEE,
			assignees: [{ participant: { userId: "someone_else" } }],
		} as never);
		const result = await completeRunStep(
			{ ...CTX, isAdminOrOwner: true },
			"rs_1",
		);
		expect(result.runStepId).toBe("rs_1");
		expect(markRunStepCompleted).toHaveBeenCalledTimes(1);
	});

	it("REQUIRED_FIELD_UNFILLED when a required field has no value row", async () => {
		vi.mocked(getRunStepWithRun).mockResolvedValueOnce(RS_PENDING_AS_ASSIGNEE as never);
		vi.mocked(getRequiredFieldsForStep).mockResolvedValueOnce([
			{ id: "f_1", key: "appointment_confirmed" },
			{ id: "f_2", key: "notes" },
		]);
		// Only one of the two required fields is filled.
		vi.mocked(getFieldValuesForRun).mockResolvedValueOnce([
			{ fieldId: "f_1", value: true },
		]);
		await expect(completeRunStep(CTX, "rs_1")).rejects.toMatchObject({
			code: "REQUIRED_FIELD_UNFILLED",
			details: { missingFieldKeys: ["notes"] },
		});
		expect(markRunStepCompleted).not.toHaveBeenCalled();
	});

	it("REQUIRED_FIELD_UNFILLED also when a value row exists but value is null", async () => {
		vi.mocked(getRunStepWithRun).mockResolvedValueOnce(RS_PENDING_AS_ASSIGNEE as never);
		vi.mocked(getRequiredFieldsForStep).mockResolvedValueOnce([
			{ id: "f_1", key: "appointment_confirmed" },
		]);
		vi.mocked(getFieldValuesForRun).mockResolvedValueOnce([
			{ fieldId: "f_1", value: null },
		]);
		await expect(completeRunStep(CTX, "rs_1")).rejects.toMatchObject({
			code: "REQUIRED_FIELD_UNFILLED",
		});
	});

	it("STOP_TASK_BLOCKED when a dependency step isn't completed", async () => {
		vi.mocked(getRunStepWithRun).mockResolvedValueOnce(RS_PENDING_AS_ASSIGNEE as never);
		vi.mocked(findIncompleteStopDependencies).mockResolvedValueOnce(["step_blocker"]);
		await expect(completeRunStep(CTX, "rs_1")).rejects.toMatchObject({
			code: "STOP_TASK_BLOCKED",
			details: { incompleteDependencyStepIds: ["step_blocker"] },
		});
		expect(markRunStepCompleted).not.toHaveBeenCalled();
	});

	it("happy path: marks complete, writes audit/activity, no run cascade if not all done", async () => {
		vi.mocked(getRunStepWithRun).mockResolvedValueOnce(RS_PENDING_AS_ASSIGNEE as never);
		vi.mocked(areAllRequiredRunStepsComplete).mockResolvedValueOnce(false);

		const result = await completeRunStep(CTX, "rs_1");

		expect(result).toEqual({ runStepId: "rs_1", runCompleted: false });
		// Mutation helpers now receive (input, tx) — tx is the executor injected by
		// withTransaction (stub `{}` in test).
		expect(markRunStepCompleted).toHaveBeenCalledWith(
			{ runStepId: "rs_1", completedBy: "user_1" },
			expect.anything(),
		);
		expect(writeAuditAndActivity).toHaveBeenCalledTimes(1);
		expect(writeAuditAndActivity).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "run_step.completed",
				verb: "completed",
				entityType: "run_step",
				entityId: "rs_1",
			}),
			expect.anything(),
		);
		expect(markRunCompleted).not.toHaveBeenCalled();
	});

	it("cascades to run-complete when all required steps are done", async () => {
		vi.mocked(getRunStepWithRun).mockResolvedValueOnce(RS_PENDING_AS_ASSIGNEE as never);
		vi.mocked(areAllRequiredRunStepsComplete).mockResolvedValueOnce(true);

		const result = await completeRunStep(CTX, "rs_1");

		expect(result.runCompleted).toBe(true);
		// markRunCompleted is now called with (runId, tx) — tx is the transaction
		// handle injected by the withTransaction stub.
		expect(markRunCompleted).toHaveBeenCalledWith("run_1", expect.anything());
		// Two append-only emissions: one for the step, one for the run.
		expect(writeAuditAndActivity).toHaveBeenCalledTimes(2);
		const calls = vi.mocked(writeAuditAndActivity).mock.calls;
		expect(calls[1][0]).toMatchObject({
			action: "run.completed",
			entityType: "run",
			entityId: "run_1",
		});
	});

	it("RUN_NOT_ACTIVE when the parent run is completed (defense vs. post-cascade edits)", async () => {
		vi.mocked(getRunStepWithRun).mockResolvedValueOnce({
			...RS_PENDING_AS_ASSIGNEE,
			run: { ...RS_PENDING_AS_ASSIGNEE.run, status: "completed" },
		} as never);
		await expect(completeRunStep(CTX, "rs_1")).rejects.toMatchObject({
			code: "RUN_NOT_ACTIVE",
			details: { runStatus: "completed" },
		});
		expect(markRunStepCompleted).not.toHaveBeenCalled();
	});

	it("RUN_NOT_ACTIVE when the parent run is archived", async () => {
		vi.mocked(getRunStepWithRun).mockResolvedValueOnce({
			...RS_PENDING_AS_ASSIGNEE,
			run: { ...RS_PENDING_AS_ASSIGNEE.run, status: "archived" },
		} as never);
		await expect(completeRunStep(CTX, "rs_1")).rejects.toMatchObject({
			code: "RUN_NOT_ACTIVE",
			details: { runStatus: "archived" },
		});
		expect(markRunStepCompleted).not.toHaveBeenCalled();
	});

	// Phase 11a.1 -- agent principal path (ADR-006 action surface).
	describe("agent principal", () => {
		const AGENT_CTX = {
			organizationId: "org_1",
			agentId: "agent_1",
			isAdminOrOwner: false,
		};

		// Step is assigned to the agent's participant row; we wire the assignees list to
		// include that id so the assignee check passes on the agent branch.
		const RS_PENDING_AS_AGENT = {
			...RS_PENDING_AS_ASSIGNEE,
			assignees: [{ participant: { id: "part_agent_1", userId: null } }],
		};

		it("RUN_STEP_ACCESS_DENIED when the agent isn't a participant on this run", async () => {
			vi.mocked(getRunStepWithRun).mockResolvedValueOnce(RS_PENDING_AS_AGENT as never);
			vi.mocked(findAgentParticipantForRun).mockResolvedValueOnce(null);

			await expect(completeRunStep(AGENT_CTX, "rs_1")).rejects.toMatchObject({
				code: "RUN_STEP_ACCESS_DENIED",
			});
			expect(markRunStepCompleted).not.toHaveBeenCalled();
		});

		it("RUN_STEP_ACCESS_DENIED when the agent is a participant but not an assignee", async () => {
			vi.mocked(getRunStepWithRun).mockResolvedValueOnce({
				...RS_PENDING_AS_AGENT,
				assignees: [{ participant: { id: "part_other", userId: null } }],
			} as never);
			vi.mocked(findAgentParticipantForRun).mockResolvedValueOnce({
				id: "part_agent_1",
			});

			await expect(completeRunStep(AGENT_CTX, "rs_1")).rejects.toMatchObject({
				code: "RUN_STEP_ACCESS_DENIED",
			});
			expect(markRunStepCompleted).not.toHaveBeenCalled();
		});

		it("happy path: agent completes step, audit attributes actor_kind=agent + actorParticipantId", async () => {
			vi.mocked(getRunStepWithRun).mockResolvedValueOnce(RS_PENDING_AS_AGENT as never);
			vi.mocked(findAgentParticipantForRun).mockResolvedValueOnce({
				id: "part_agent_1",
			});
			vi.mocked(areAllRequiredRunStepsComplete).mockResolvedValueOnce(false);

			const result = await completeRunStep(AGENT_CTX, "rs_1");
			expect(result).toEqual({ runStepId: "rs_1", runCompleted: false });

			// `completedBy` is null for agent callers -- there is no Better Auth user.
			expect(markRunStepCompleted).toHaveBeenCalledWith(
				{ runStepId: "rs_1", completedBy: null },
				expect.anything(),
			);
			expect(writeAuditAndActivity).toHaveBeenCalledWith(
				expect.objectContaining({
					action: "run_step.completed",
					actorUserId: null,
					actorKind: "agent",
					actorParticipantId: "part_agent_1",
					metadata: expect.objectContaining({ actorAgentId: "agent_1" }),
				}),
				expect.anything(),
			);
		});

		it("agent cascade audit also carries actor_kind=agent attribution", async () => {
			vi.mocked(getRunStepWithRun).mockResolvedValueOnce(RS_PENDING_AS_AGENT as never);
			vi.mocked(findAgentParticipantForRun).mockResolvedValueOnce({
				id: "part_agent_1",
			});
			vi.mocked(areAllRequiredRunStepsComplete).mockResolvedValueOnce(true);

			const result = await completeRunStep(AGENT_CTX, "rs_1");
			expect(result.runCompleted).toBe(true);

			expect(writeAuditAndActivity).toHaveBeenCalledTimes(2);
			const calls = vi.mocked(writeAuditAndActivity).mock.calls;
			expect(calls[1][0]).toMatchObject({
				action: "run.completed",
				actorKind: "agent",
				actorParticipantId: "part_agent_1",
			});
		});
	});

	it("does not emit cascade audit when markRunCompleted loses the race (G3)", async () => {
		// Simulate two concurrent "complete last step" calls: both observe
		// areAllRequiredRunStepsComplete === true, but only one's UPDATE wins the
		// row-level lock and transitions status from 'active' to 'completed'. The
		// loser's markRunCompleted returns false; the cascade audit must NOT fire,
		// otherwise we'd write duplicate run.completed rows.
		vi.mocked(getRunStepWithRun).mockResolvedValueOnce(RS_PENDING_AS_ASSIGNEE as never);
		vi.mocked(areAllRequiredRunStepsComplete).mockResolvedValueOnce(true);
		vi.mocked(markRunCompleted).mockResolvedValueOnce(false);

		const result = await completeRunStep(CTX, "rs_1");

		expect(result.runCompleted).toBe(false);
		expect(markRunCompleted).toHaveBeenCalledTimes(1);
		// Only the step-completion audit fires; the cascade audit must be skipped.
		expect(writeAuditAndActivity).toHaveBeenCalledTimes(1);
		expect(vi.mocked(writeAuditAndActivity).mock.calls[0][0]).toMatchObject({
			action: "run_step.completed",
		});
	});
});
