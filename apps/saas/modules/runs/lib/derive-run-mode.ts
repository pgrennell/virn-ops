// apps/saas/modules/runs/lib/derive-run-mode.ts
//
// Derive the launch mode (human / ai_assisted / automated) of a run from the
// participants + step assignees the RunView already loads. We don't store mode on
// `run` -- it lives in the audit_log row (`changes.mode`) from the launch event --
// and the audit row isn't surfaced to the run-view client. Re-computing from the
// snapshot we already have keeps the data path clean (no new column, no second
// query).
//
// Classification:
//   - automated   : every step has an agent assignee
//   - ai_assisted : at least one step has an agent assignee, but not all
//   - human       : no agent assignees (or no agent participants at all)
//
// Vendor assignees don't affect the mode classification -- mode is the agent
// dimension only, per STRATEGY S-07 and the Phase 8 step 3 launcher. A run with
// vendors + humans + no agents is still "human" mode (the wedge framing).
//
// Pure function, easy to test. Lives client-side (modules/runs/lib) because the
// data is already on the client; deriving server-side would just trade one column
// for another query.

export type RunMode = "human" | "ai_assisted" | "automated";

interface ParticipantLike {
	id: string;
	kind: string;
}

interface AssigneeLike {
	participant: { id: string };
}

interface RunStepLike {
	assignees: AssigneeLike[];
}

export function deriveRunMode(
	steps: ReadonlyArray<RunStepLike>,
	participants: ReadonlyArray<ParticipantLike>,
): RunMode {
	const agentParticipantIds = new Set(
		participants.filter((p) => p.kind === "agent").map((p) => p.id),
	);
	if (agentParticipantIds.size === 0 || steps.length === 0) {
		return "human";
	}
	let agentAssignedSteps = 0;
	for (const step of steps) {
		const ownedByAgent = step.assignees.some((a) =>
			agentParticipantIds.has(a.participant.id),
		);
		if (ownedByAgent) agentAssignedSteps += 1;
	}
	if (agentAssignedSteps === 0) return "human";
	if (agentAssignedSteps === steps.length) return "automated";
	return "ai_assisted";
}

export const RUN_MODE_LABEL: Record<RunMode, string> = {
	human: "Human",
	ai_assisted: "AI-assisted",
	automated: "Automated",
};

export const RUN_MODE_BADGE_CLASS: Record<RunMode, string> = {
	// Subdued — human is the default mode, not a "feature".
	human: "bg-muted text-foreground/70",
	// AI-assisted: emerald (matches the LaunchModePicker's selected-agent emphasis).
	ai_assisted: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
	// Automated: sky (visually distinct from AI-assisted so the run-list shows the
	// mode split at a glance).
	automated: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
};
