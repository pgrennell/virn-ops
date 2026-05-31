// packages/api/inngest/functions/playbook-orchestrator.ts
//
// Phase 18b -- the DURABLE Playbook orchestrator. Triggered by `playbook/run.start`
// (emitted by launchManual + the dispatcher). Walks the published version's step
// list, applying Inngest's durable primitives for the wait step types:
//   - wait_for_duration -> step.sleep(durationMs)
//   - wait_for_event    -> step.waitForEvent(playbook/wait.signal, match on waitKey)
// Action + branch steps run inside step.run via the pure executePlaybookStep, so a
// crash/redeploy mid-run resumes from the last completed step (Inngest memoizes
// each step.run / step.sleep by id). Branch children execute only when their
// branchLabel matches the evaluated label; the rest are recorded `skipped`.

import {
	getPlaybookRunCore,
	getPlaybookRunWithSteps,
	insertPlaybookRunStep,
	updatePlaybookRunState,
	updatePlaybookRunStepState,
	writeAuditAndActivity,
} from "@virn/database";

import { inngest } from "../client";
import {
	PLAYBOOK_RUN_START_EVENT,
	PLAYBOOK_WAIT_SIGNAL_EVENT,
	type PlaybookRunStartEventData,
} from "../events";
import {
	executePlaybookStep,
	type PlaybookStepExecCtx,
	type PlaybookStepExecInput,
} from "../../modules/playbook-runs/lib/orchestrator";

type StepTools = Parameters<
	Parameters<typeof inngest.createFunction>[2]
>[0]["step"];

export const playbookOrchestrator = inngest.createFunction(
	{ id: "playbook-orchestrator", name: "Playbook orchestrator", retries: 3 },
	{ event: PLAYBOOK_RUN_START_EVENT },
	async ({ event, step }) => {
		const { playbookRunId } = event.data as PlaybookRunStartEventData;

		const bundle = await step.run("load-run", () =>
			getPlaybookRunWithSteps(playbookRunId),
		);
		if (!bundle) return { skipped: "run not found" };
		const { run, steps } = bundle;
		if (run.status === "completed" || run.status === "cancelled" || run.status === "failed") {
			return { skipped: `run already ${run.status}` };
		}

		const ctx: PlaybookStepExecCtx = {
			organizationId: run.organizationId,
			crossProductOrigin: run.crossProductOrigin,
			run,
		};

		await step.run("mark-active", async () => {
			await updatePlaybookRunState({
				runId: run.id,
				status: "active",
				startedAt: new Date(),
			});
			await writeAuditAndActivity({
				organizationId: run.organizationId,
				actorUserId: null,
				crossProductOrigin: run.crossProductOrigin ?? null,
				action: "playbook_run.started",
				verb: "started",
				entityType: "playbook_run",
				entityId: run.id,
				metadata: { playbookVersionId: run.playbookVersionId },
			});
		});

		const topLevel = steps
			.filter((s) => !s.parentStepId)
			.sort((a, b) => a.position - b.position);

		let aborted = false;
		outer: for (const s of topLevel) {
			const status = await step.run(`status-${s.id}`, async () => {
				const cur = await getPlaybookRunCore(run.id);
				return cur?.status ?? "cancelled";
			});
			if (status === "cancelled") {
				aborted = true;
				break;
			}

			const result = await runOneStep(step, s, ctx, run.id);
			if (result === "aborted") {
				aborted = true;
				break;
			}
			if (typeof result === "object" && "branchLabel" in result) {
				const children = steps
					.filter((c) => c.parentStepId === s.id)
					.sort((a, b) => a.position - b.position);
				for (const child of children) {
					const taken =
						result.branchLabel !== null && child.branchLabel === result.branchLabel;
					if (taken) {
						const childResult = await runOneStep(step, child, ctx, run.id);
						if (childResult === "aborted") {
							aborted = true;
							break outer;
						}
					} else {
						await step.run(`skip-${child.id}`, () =>
							insertPlaybookRunStep({
								playbookRunId: run.id,
								playbookStepId: child.id,
								status: "skipped",
							}),
						);
					}
				}
			}
		}

		await step.run("finalize", async () => {
			const cur = await getPlaybookRunCore(run.id);
			if (cur && (cur.status === "active" || cur.status === "waiting")) {
				await updatePlaybookRunState({
					runId: run.id,
					status: aborted ? "cancelled" : "completed",
					currentStepId: null,
					nextWakeAt: null,
					completedAt: aborted ? null : new Date(),
				});
				await writeAuditAndActivity({
					organizationId: run.organizationId,
					actorUserId: null,
					crossProductOrigin: run.crossProductOrigin ?? null,
					action: aborted ? "playbook_run.cancelled" : "playbook_run.completed",
					verb: aborted ? "cancelled" : "completed",
					entityType: "playbook_run",
					entityId: run.id,
				});
			}
		});

		return { runId: run.id, aborted };
	},
);

/** Execute one step (action / branch / wait) durably. Returns "ok", "aborted"
 * (a wait_for_event timed out with onTimeout='abort'), or a branch result. */
async function runOneStep(
	step: StepTools,
	s: PlaybookStepExecInput,
	ctx: PlaybookStepExecCtx,
	runId: string,
): Promise<"ok" | "aborted" | { branchLabel: string | null }> {
	// Materialize the run-step row + compute the outcome (actions run here).
	const { runStepId, outcome } = await step.run(`exec-${s.id}`, async () => {
		const rs = await insertPlaybookRunStep({
			playbookRunId: runId,
			playbookStepId: s.id,
			status: "active",
			startedAt: new Date(),
		});
		const out = await executePlaybookStep(s, ctx);
		return { runStepId: rs.id, outcome: out };
	});

	if (outcome.kind === "sleep") {
		await step.run(`waiting-${s.id}`, () =>
			updatePlaybookRunState({
				runId,
				status: "waiting",
				currentStepId: s.id,
				nextWakeAt: new Date(Date.now() + outcome.durationMs),
			}),
		);
		await step.sleep(`sleep-${s.id}`, outcome.durationMs);
		await step.run(`woke-${s.id}`, async () => {
			await updatePlaybookRunStepState({
				runStepId,
				status: "completed",
				completedAt: new Date(),
			});
			await updatePlaybookRunState({ runId, status: "active", nextWakeAt: null });
		});
		return "ok";
	}

	if (outcome.kind === "waitForEvent") {
		await step.run(`waiting-${s.id}`, () =>
			updatePlaybookRunState({ runId, status: "waiting", currentStepId: s.id }),
		);
		const signal = await step.waitForEvent(`wait-${s.id}`, {
			event: PLAYBOOK_WAIT_SIGNAL_EVENT,
			timeout: `${outcome.timeoutDays}d`,
			if: `async.data.waitKey == "${outcome.waitKey}"`,
		});
		const timedOut = signal === null;
		if (timedOut && outcome.onTimeout === "abort") {
			await step.run(`wait-fail-${s.id}`, async () => {
				await updatePlaybookRunStepState({
					runStepId,
					status: "failed",
					completedAt: new Date(),
					resultPayload: { timedOut: true },
				});
				await updatePlaybookRunState({ runId, status: "failed", nextWakeAt: null });
			});
			return "aborted";
		}
		await step.run(`wait-done-${s.id}`, async () => {
			await updatePlaybookRunStepState({
				runStepId,
				status: "completed",
				completedAt: new Date(),
				resultPayload: { timedOut },
			});
			await updatePlaybookRunState({ runId, status: "active", nextWakeAt: null });
		});
		return "ok";
	}

	if (outcome.kind === "branch") {
		await step.run(`branch-${s.id}`, () =>
			updatePlaybookRunStepState({
				runStepId,
				status: "completed",
				completedAt: new Date(),
				resultPayload: { takenLabel: outcome.takenLabel },
			}),
		);
		return { branchLabel: outcome.takenLabel };
	}

	// action
	await step.run(`done-${s.id}`, () =>
		updatePlaybookRunStepState({
			runStepId,
			status: outcome.status,
			completedAt: new Date(),
			resultPayload: outcome.resultPayload,
			launchedRunId: outcome.launchedRunId ?? null,
		}),
	);
	return "ok";
}
