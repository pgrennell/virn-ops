"use client";

// Top-level Run view client component (UX_SPEC §5.3, wireframe 08). Owns the active-step
// selection state, the field save-state map, and the orchestration of the three runtime
// mutations: setFieldValue, completeStep, getRun (via query invalidation).
//
// The shared primitives (RunStepList, RunStepPanel) are mode-aware; this component drives
// them in "complete" mode for assignees + admin and "view" mode otherwise.

import { useSession } from "@auth/hooks/use-session";
import { Spinner } from "@virn/ui/components/spinner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { orpc } from "@shared/lib/orpc-query-utils";

import type { FieldSaveState, FieldType, RunStatus, RunStepStatus, StepType } from "../types";
import { RunHeader } from "./RunHeader";
import {
	RunStepList,
	type RunStepListDefinitionStep,
	type RunStepListItem,
	type RunStepListSection,
} from "./RunStepList";
import { RunStepPanel, type RunStepPanelFieldRow } from "./RunStepPanel";

interface RunViewProps {
	runId: string;
	/** True when the viewer is admin/owner of the org -- bypasses assignee gating on
	 * inputs + Complete. Resolved server-side; passed via the page. */
	isAdminOrOwner: boolean;
}

export function RunView({ runId, isAdminOrOwner }: RunViewProps) {
	const queryClient = useQueryClient();
	const { user } = useSession();
	const meId = user?.id ?? null;
	const queryKey = orpc.runs.get.queryKey({ input: { runId } });
	const { data, isLoading, isError, error } = useQuery(orpc.runs.get.queryOptions({ input: { runId } }));

	const setFieldValue = useMutation(orpc.runs.setFieldValue.mutationOptions());
	const completeStep = useMutation(orpc.runs.completeStep.mutationOptions());

	const [activeRunStepId, setActiveRunStepId] = useState<string | null>(null);
	const [fieldSaveState, setFieldSaveState] = useState<Map<string, FieldSaveState>>(new Map());
	const [fieldErrors, setFieldErrors] = useState<Map<string, string | null>>(new Map());
	const [completeError, setCompleteError] = useState<string | null>(null);

	// Pick a sensible default active step once data arrives: first incomplete, non-blocked.
	useEffect(() => {
		if (!data || activeRunStepId) return;
		const candidate =
			data.steps.find((s) => s.status === "pending" && !s.blocked) ??
			data.steps.find((s) => s.status === "pending") ??
			data.steps[0];
		if (candidate) setActiveRunStepId(candidate.id);
	}, [data, activeRunStepId]);

	if (isLoading) {
		return (
			<div className="gap-3 flex items-center justify-center py-16 text-foreground/60">
				<Spinner className="size-4" /> Loading run…
			</div>
		);
	}

	if (isError || !data) {
		return (
			<div className="px-5 py-8 text-sm text-destructive">
				Couldn't load run: {error?.message ?? "not found"}
			</div>
		);
	}

	const activeRunStep = data.steps.find((s) => s.id === activeRunStepId) ?? null;

	// Build lookup maps for the panel.
	const versionSteps = data.version.steps;
	const versionFields = data.version.fields;
	const definitionStepById = new Map(versionSteps.map((s) => [s.id, s] as const));

	const fieldsForActiveStep: RunStepPanelFieldRow[] = activeRunStep?.stepId
		? versionFields.filter((f) => f.stepId === activeRunStep.stepId)
		: [];

	const fieldValuesByKey = new Map<string, unknown>();
	for (const fv of data.values) {
		if (fv.fieldId == null) continue;
		const f = versionFields.find((vf) => vf.id === fv.fieldId);
		if (!f) continue;
		// Only surface values for the active step's fields (kickoff values handled elsewhere).
		if (activeRunStep && f.stepId === activeRunStep.stepId) {
			fieldValuesByKey.set(f.key, fv.value);
		}
	}

	const completedCount = data.steps.filter((s) => s.status === "completed").length;
	const totalCount = data.steps.length;

	const sections: RunStepListSection[] = data.version.sections;
	const definitionSteps: RunStepListDefinitionStep[] = versionSteps.map((s) => ({
		id: s.id,
		sectionId: s.sectionId,
		position: s.position,
		isRequired: s.isRequired,
		type: s.type as StepType,
	}));
	const runStepListItems: RunStepListItem[] = data.steps.map((s) => ({
		id: s.id,
		stepId: s.stepId,
		title: s.title,
		status: s.status as RunStepStatus,
		blocked: s.blocked,
		position: s.position,
	}));

	const onSetFieldValue = (fieldKey: string, value: unknown) => {
		if (!activeRunStep) return;
		setFieldSaveState((m) => new Map(m).set(fieldKey, "saving"));
		setFieldErrors((m) => new Map(m).set(fieldKey, null));
		setFieldValue.mutate(
			{ runStepId: activeRunStep.id, fieldKey, value },
			{
				onSuccess: async () => {
					setFieldSaveState((m) => new Map(m).set(fieldKey, "saved"));
					await queryClient.invalidateQueries({ queryKey });
					// Fade the "Saved" badge back to idle after a moment.
					setTimeout(() => {
						setFieldSaveState((m) => {
							const next = new Map(m);
							if (next.get(fieldKey) === "saved") next.set(fieldKey, "idle");
							return next;
						});
					}, 1500);
				},
				onError: (err) => {
					setFieldSaveState((m) => new Map(m).set(fieldKey, "error"));
					setFieldErrors((m) => new Map(m).set(fieldKey, err.message));
				},
			},
		);
	};

	const onCompleteStep = () => {
		if (!activeRunStep) return;
		setCompleteError(null);
		completeStep.mutate(
			{ runStepId: activeRunStep.id },
			{
				onSuccess: async () => {
					await queryClient.invalidateQueries({ queryKey });
				},
				onError: (err) => setCompleteError(err.message),
			},
		);
	};

	const activeAssigneeUserIds = activeRunStep
		? new Set(
				activeRunStep.assignees
					.map((a) => a.participant.userId)
					.filter((v): v is string => v != null),
			)
		: new Set<string>();
	const isAssignedToMe = meId != null && activeAssigneeUserIds.has(meId);

	const panelMode = (() => {
		if (!activeRunStep) return "view" as const;
		if (isAdminOrOwner) return "complete" as const;
		if (isAssignedToMe) return "complete" as const;
		return "view" as const;
	})();

	const assigneeDisplay = (() => {
		if (!activeRunStep) return null;
		const ids = activeRunStep.assignees
			.map((a) => a.participant)
			.map((p) =>
				p.userId
					? data.participants.find((dp) => dp.userId === p.userId)?.guestName ?? p.userId
					: p.guestName ?? p.guestEmail ?? "Guest",
			);
		if (ids.length === 0) return null;
		return ids.slice(0, 2).join(", ") + (ids.length > 2 ? ` +${ids.length - 2}` : "");
	})();

	return (
		<div className="rounded-lg border border-border bg-background overflow-hidden flex flex-col h-full min-h-0">
			<RunHeader
				title={data.title}
				status={data.status as RunStatus}
				completedCount={completedCount}
				totalCount={totalCount}
				startedAt={data.startedAt}
				dueAt={data.dueAt}
			/>
			<div className="flex flex-1 min-h-0">
				<aside className="w-56 shrink-0 border-r border-border bg-muted/30 overflow-y-auto">
					<RunStepList
						sections={sections}
						definitionSteps={definitionSteps}
						runSteps={runStepListItems}
						activeRunStepId={activeRunStepId}
						onSelectStep={setActiveRunStepId}
					/>
				</aside>
				<div className="flex-1 min-w-0 overflow-y-auto">
					{activeRunStep ? (
						<RunStepPanel
							data={{
								runStepId: activeRunStep.id,
								stepId: activeRunStep.stepId,
								title: activeRunStep.title,
								description: activeRunStep.description,
								status: activeRunStep.status as RunStepStatus,
								stepType:
									(activeRunStep.stepId
										? (definitionStepById.get(activeRunStep.stepId)?.type as StepType | undefined)
										: undefined) ?? "task",
								blocked: activeRunStep.blocked,
								canComplete: activeRunStep.canComplete,
								dueAt: activeRunStep.dueAt,
								assigneeDisplay,
								isAssignedToMe,
							}}
							fields={fieldsForActiveStep.map((f) => ({
								id: f.id,
								key: f.key,
								label: f.label,
								fieldType: f.fieldType as FieldType,
								config: f.config as Record<string, unknown> | null,
								isRequired: f.isRequired,
								position: f.position,
							}))}
							fieldValuesByKey={fieldValuesByKey}
							fieldSaveState={fieldSaveState}
							fieldErrors={fieldErrors}
							mode={panelMode}
							completing={completeStep.isPending}
							completeError={completeError}
							onSetFieldValue={onSetFieldValue}
							onCompleteStep={onCompleteStep}
						/>
					) : (
						<div className="px-5 py-8 text-sm text-foreground/60">
							This run has no steps. Pick one from the list to begin.
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

