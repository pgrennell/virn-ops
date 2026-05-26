"use client";

// Shared primitive (#1 of 2). Section-grouped step list with status icons. Mode-agnostic:
// the parent decides what happens on click (RunView selects a step for the panel; the
// future Workflow Builder will open an edit drawer). Active/selected step is highlighted
// via ring + background, matching the wireframe's card treatment.

import { cn } from "@virn/ui";
import { CheckCircle2, Circle, Lock, MinusCircle } from "lucide-react";
import { useMemo } from "react";

import type { RunStepStatus, RunViewMode, StepType } from "../types";

export interface RunStepListSection {
	id: string;
	title: string;
	position: number;
}

export interface RunStepListDefinitionStep {
	id: string;
	sectionId: string | null;
	position: number;
	isRequired: boolean;
	type: StepType;
}

export interface RunStepListItem {
	id: string;
	stepId: string | null;
	title: string;
	status: RunStepStatus;
	blocked: boolean;
	position: number;
}

interface RunStepListProps {
	sections: readonly RunStepListSection[];
	definitionSteps: readonly RunStepListDefinitionStep[];
	runSteps: readonly RunStepListItem[];
	activeRunStepId: string | null;
	onSelectStep: (runStepId: string) => void;
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	mode?: RunViewMode;
}

interface RenderGroup {
	sectionId: string | null;
	sectionTitle: string | null;
	items: RunStepListItem[];
}

export function RunStepList({
	sections,
	definitionSteps,
	runSteps,
	activeRunStepId,
	onSelectStep,
}: RunStepListProps) {
	const groups = useMemo(
		() => groupRunStepsBySection(sections, definitionSteps, runSteps),
		[sections, definitionSteps, runSteps],
	);
	const defStepById = useMemo(
		() => new Map(definitionSteps.map((d) => [d.id, d] as const)),
		[definitionSteps],
	);

	return (
		<nav aria-label="Run steps" className="gap-0.5 flex flex-col p-2">
			{groups.map((group, gIdx) => (
				<div key={group.sectionId ?? `unsectioned-${gIdx}`} className="gap-0.5 flex flex-col">
					{group.sectionTitle && (
						<p className="px-2 pt-2 pb-1 text-[10px] uppercase tracking-wide font-medium text-foreground/50">
							{group.sectionTitle}
						</p>
					)}
					{group.items.map((rs) => {
						const def = rs.stepId ? defStepById.get(rs.stepId) : undefined;
						const showOptionalPill = def != null && !def.isRequired && def.type !== "heading";
						return (
							<RunStepRow
								key={rs.id}
								runStep={rs}
								active={rs.id === activeRunStepId}
								showOptionalPill={showOptionalPill}
								onClick={() => onSelectStep(rs.id)}
							/>
						);
					})}
				</div>
			))}
		</nav>
	);
}

function RunStepRow({
	runStep,
	active,
	showOptionalPill,
	onClick,
}: {
	runStep: RunStepListItem;
	active: boolean;
	showOptionalPill: boolean;
	onClick: () => void;
}) {
	const icon = renderStatusIcon(runStep);
	const isCompleted = runStep.status === "completed";
	const isSkippedOrNA = runStep.status === "skipped" || runStep.status === "not_applicable";
	return (
		<button
			type="button"
			onClick={onClick}
			aria-current={active ? "step" : undefined}
			className={cn(
				"gap-2 flex items-center text-sm text-left px-2 py-1.5 rounded-md transition-colors w-full",
				active
					? "bg-background border border-border shadow-sm"
					: "hover:bg-muted/50",
				(isCompleted || isSkippedOrNA) && !active && "text-foreground/60",
			)}
		>
			<span className="shrink-0" aria-hidden>
				{icon}
			</span>
			<span
				className={cn("flex-1 min-w-0 truncate", isCompleted && "line-through")}
				title={runStep.blocked ? "Blocked: a dependency step isn't complete yet" : undefined}
			>
				{runStep.title}
			</span>
			{showOptionalPill && (
				<span
					className="shrink-0 px-1.5 py-0.5 text-[9px] uppercase tracking-wide font-medium rounded bg-muted text-muted-foreground"
					title="Optional — does not block run completion"
				>
					Optional
				</span>
			)}
		</button>
	);
}

function renderStatusIcon(runStep: RunStepListItem) {
	if (runStep.status === "completed") {
		return <CheckCircle2 className="size-4 text-emerald-600" />;
	}
	if (runStep.status === "skipped" || runStep.status === "not_applicable") {
		return <MinusCircle className="size-4 text-foreground/30" />;
	}
	if (runStep.blocked) {
		return <Lock className="size-4 text-foreground/40" />;
	}
	return <Circle className="size-4 text-foreground/40" />;
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

function groupRunStepsBySection(
	sections: readonly RunStepListSection[],
	definitionSteps: readonly RunStepListDefinitionStep[],
	runSteps: readonly RunStepListItem[],
): RenderGroup[] {
	const sectionIdByDefStepId = new Map(definitionSteps.map((s) => [s.id, s.sectionId] as const));

	const groupsBySectionId = new Map<string | null, RunStepListItem[]>();
	for (const rs of runSteps) {
		const secId = rs.stepId ? (sectionIdByDefStepId.get(rs.stepId) ?? null) : null;
		const arr = groupsBySectionId.get(secId) ?? [];
		arr.push(rs);
		groupsBySectionId.set(secId, arr);
	}
	for (const items of groupsBySectionId.values()) {
		items.sort((a, b) => a.position - b.position);
	}

	const sortedSections = [...sections].sort((a, b) => a.position - b.position);
	const result: RenderGroup[] = [];
	for (const section of sortedSections) {
		const items = groupsBySectionId.get(section.id);
		if (!items || items.length === 0) continue;
		result.push({ sectionId: section.id, sectionTitle: section.title, items });
	}
	const unsectioned = groupsBySectionId.get(null);
	if (unsectioned && unsectioned.length > 0) {
		result.push({
			sectionId: null,
			// Hide the header for unsectioned groups when sections exist; keep them flush.
			sectionTitle: sortedSections.length === 0 ? null : null,
			items: unsectioned,
		});
	}
	return result;
}
