// apps/saas/modules/builder/lib/preview-adapter.ts
//
// Definition -> synthetic-run shape adapter. Lets the same RunStepList + RunStepPanel
// primitives paint a Builder preview without a real run row in the DB. The user
// explicitly called out: "preview needs a small definition→synthetic-run adapter
// (empty values, all-pending) so the same primitive can paint it. That's fine and
// actually proves the reuse — just make sure that adapter exists rather than the
// panel sprouting a third data-shape branch."
//
// What this returns is exactly what `useQuery(orpc.runs.get)` would return for a run
// snapshotted from this version -- except every runStep is synthetic (no real id, no
// real status writes; the parent BuilderView passes noop callbacks for preview).

import type { VersionEditBundleResponse } from "./types";

export interface PreviewRunStep {
	id: string;
	stepId: string | null;
	title: string;
	description: string | null;
	position: number;
	status: "pending";
	blocked: false;
	canComplete: true;
	dueAt: null;
	assignees: [];
}

export interface PreviewRunData {
	id: string;
	title: string;
	status: "active";
	startedAt: Date;
	dueAt: null;
	workflow: { id: string; title: string; type: string };
	steps: PreviewRunStep[];
	values: [];
	participants: [];
	roleAssignments: [];
}

/** Synthesize a run-shaped view from the version bundle so RunStepList / RunStepPanel
 * can paint it unchanged. Every runStep id is `preview_${defStepId}` so the parent can
 * map back. Status is always `pending`; blocked is always `false` (a preview is a fresh
 * "what the operator will see when they open this"); fields show with no values. */
export function buildPreviewFromBundle(
	bundle: VersionEditBundleResponse,
	workflowTitle: string,
): PreviewRunData {
	const steps: PreviewRunStep[] = [...bundle.steps]
		.sort((a, b) => a.position - b.position)
		.map((s) => ({
			id: `preview_${s.id}`,
			stepId: s.id,
			title: s.title,
			description: s.description,
			position: s.position,
			status: "pending" as const,
			blocked: false as const,
			canComplete: true as const,
			dueAt: null,
			assignees: [],
		}));

	return {
		id: `preview_${bundle.version.id}`,
		title: workflowTitle,
		status: "active",
		startedAt: new Date(),
		dueAt: null,
		workflow: {
			id: bundle.workflow.id,
			title: workflowTitle,
			type: bundle.workflow.type,
		},
		steps,
		values: [],
		participants: [],
		roleAssignments: [],
	};
}
