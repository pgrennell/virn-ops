import { ORPCError } from "@orpc/server";
import { getDependenciesForRunSteps, getRunForOrg } from "@virn/database";
import { z } from "zod";

import { protectedOrgProcedure } from "../../../orpc/procedures";

export const getRunProc = protectedOrgProcedure
	.route({
		method: "GET",
		path: "/runs/{runId}",
		tags: ["Runs"],
		summary: "Get a run with steps, field values, participants, and assignments",
		description:
			"Returns the snapshot data needed to render a run. Each step includes a computed `blocked` boolean (true when any stop-task dependency is incomplete) and `canComplete` (true when not blocked and required fields are filled).",
	})
	.input(z.object({ runId: z.string().min(1) }))
	.handler(async ({ input, context }) => {
		const r = await getRunForOrg(context.organization.id, input.runId);
		if (!r) {
			throw new ORPCError("NOT_FOUND", { message: "Run not found in this organization." });
		}

		// Compute `blocked` per step from step_dependency.
		const definitionStepIds = r.steps
			.map((s) => s.stepId)
			.filter((id): id is string => id !== null);
		const deps = await getDependenciesForRunSteps(definitionStepIds);
		// step -> [dependsOn1, dependsOn2, ...]
		const depsByStep = new Map<string, string[]>();
		for (const d of deps) {
			const existing = depsByStep.get(d.stepId) ?? [];
			existing.push(d.dependsOnStepId);
			depsByStep.set(d.stepId, existing);
		}
		// Map definition stepId -> runStep.status for quick "is dependency completed" checks.
		const statusByDefinitionStepId = new Map<string, string>();
		for (const rs of r.steps) {
			if (rs.stepId) statusByDefinitionStepId.set(rs.stepId, rs.status);
		}

		// Field values keyed by (runStepId | "kickoff") for canComplete hints.
		const valuesByRunStepId = new Map<string, Set<string>>();
		const kickoffValueFieldIds = new Set<string>();
		for (const fv of r.values) {
			if (fv.value === null || fv.value === undefined) continue;
			if (fv.runStepId === null) {
				if (fv.fieldId) kickoffValueFieldIds.add(fv.fieldId);
			} else {
				const set = valuesByRunStepId.get(fv.runStepId) ?? new Set<string>();
				if (fv.fieldId) set.add(fv.fieldId);
				valuesByRunStepId.set(fv.runStepId, set);
			}
		}

		const stepsView = r.steps.map((rs) => {
			const blocked =
				rs.stepId !== null &&
				(depsByStep.get(rs.stepId) ?? []).some(
					(depId) => statusByDefinitionStepId.get(depId) !== "completed",
				);
			return {
				...rs,
				blocked,
				// canComplete is a hint -- the server still enforces on completeStep.
				canComplete: rs.status === "pending" && !blocked,
			};
		});

		return {
			...r,
			steps: stepsView,
			kickoffValueFieldIds: Array.from(kickoffValueFieldIds),
		};
	});
