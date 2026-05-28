"use client";

// Shared primitive (#1 of 2). Section-grouped step list with status icons. Mode-aware:
//
//   complete / view / preview  --  status icon + title (Run / Preview surfaces).
//   author                      --  drag handle + type icon + title, with inline +Add
//                                   affordances composed in. The author branch lives in
//                                   a small set of helpers below the main render; the
//                                   shell (sections + rows + selection) is shared.
//
// Author mutations are not owned here. The parent (BuilderView) passes a single
// `authorCallbacks` bundle; this component fires events into it. Reorder commit is
// inline (HTML5 DnD); per-row mutations (rename / delete / type change) live in the
// step panel, not this list.

import { cn } from "@virn/ui";
import {
	CheckCircle2,
	Circle,
	GripVertical,
	Lock,
	MinusCircle,
	Plus,
	StickyNote,
	UserCheck,
	Zap,
} from "lucide-react";
import { useMemo, useState } from "react";

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
	/** Phase 12.2 -- per-step due-rule summary for the author-mode chip. The
	 * caller (BuilderView) resolves dueAnchorStepId to its title + dueSourceFieldId
	 * to its key before passing this in so the rendered chip never has to do its
	 * own lookups. Omitted for runs/preview modes, where the runtime dueAt drives
	 * the deadline display instead. */
	dueRule?: {
		dueType: "none" | "offset_from_start" | "offset_from_step" | "from_date_field";
		dueOffsetDays: number | null;
		dueAnchorStepTitle: string | null;
		dueSourceFieldKey: string | null;
	};
}

export interface RunStepListItem {
	id: string;
	stepId: string | null;
	title: string;
	status: RunStepStatus;
	blocked: boolean;
	position: number;
}

/** Author-mode callback bundle. Passing this in switches the list into author affordances;
 * omitting it keeps the list in pure run/preview shape. */
export interface AuthorListCallbacks {
	onAddSection: () => void;
	onAddStepInSection: (sectionId: string | null) => void;
	/** Called after a drag-drop completes with the full new (stepId, position) tuples
	 * within the affected section. Optimistic-safe per D-018 follow-up (ids don't change). */
	onReorderSteps: (ordering: Array<{ stepId: string; position: number }>) => void;
}

interface RunStepListProps {
	sections: readonly RunStepListSection[];
	definitionSteps: readonly RunStepListDefinitionStep[];
	runSteps: readonly RunStepListItem[];
	activeRunStepId: string | null;
	onSelectStep: (runStepId: string) => void;
	mode?: RunViewMode;
	/** When provided AND mode === "author", composes the author-mode affordances in.
	 * Otherwise the list renders in run/preview shape. */
	authorCallbacks?: AuthorListCallbacks;
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
	mode = "complete",
	authorCallbacks,
}: RunStepListProps) {
	const isAuthorMode = mode === "author" && !!authorCallbacks;
	const groups = useMemo(
		() => groupRunStepsBySection(sections, definitionSteps, runSteps, isAuthorMode),
		[sections, definitionSteps, runSteps, isAuthorMode],
	);
	const defStepById = useMemo(
		() => new Map(definitionSteps.map((d) => [d.id, d] as const)),
		[definitionSteps],
	);
	const isAuthor = isAuthorMode;

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
						const showOptionalPill =
							!isAuthor && def != null && !def.isRequired && def.type !== "heading";
						return (
							<RunStepRow
								key={rs.id}
								runStep={rs}
								def={def}
								active={rs.id === activeRunStepId}
								showOptionalPill={showOptionalPill}
								authorMode={isAuthor}
								onClick={() => onSelectStep(rs.id)}
								onReorderWithin={
									isAuthor && authorCallbacks
										? (orderedIds) => commitReorder(orderedIds, group.items, authorCallbacks)
										: undefined
								}
							/>
						);
					})}
					{isAuthor && authorCallbacks && (
						<AuthorAddStepRow onClick={() => authorCallbacks.onAddStepInSection(group.sectionId)} />
					)}
				</div>
			))}
			{isAuthor && authorCallbacks && (
				<AuthorAddSectionRow onClick={authorCallbacks.onAddSection} />
			)}
		</nav>
	);
}

// ---------------------------------------------------------------------------
// Step row -- shared shell, mode-specific leading icon + drag handle
// ---------------------------------------------------------------------------

function RunStepRow({
	runStep,
	def,
	active,
	showOptionalPill,
	authorMode,
	onClick,
	onReorderWithin,
}: {
	runStep: RunStepListItem;
	def: RunStepListDefinitionStep | undefined;
	active: boolean;
	showOptionalPill: boolean;
	authorMode: boolean;
	onClick: () => void;
	/** Author-mode drag-drop hook. Called with the new order of step ids within the
	 * current section when a drop lands on this row. */
	onReorderWithin?: (orderedStepIds: string[]) => void;
}) {
	const icon = authorMode
		? renderStepTypeIcon(def?.type ?? "task")
		: renderStatusIcon(runStep);
	const isCompleted = runStep.status === "completed";
	const isSkippedOrNA = runStep.status === "skipped" || runStep.status === "not_applicable";

	// HTML5 DnD state. Lightweight -- no new dep. Only active in author mode.
	const [isDragOver, setIsDragOver] = useState(false);

	const handleDragStart = (e: React.DragEvent<HTMLButtonElement>) => {
		if (!authorMode || !runStep.stepId) return;
		e.dataTransfer.setData("text/x-step-id", runStep.stepId);
		e.dataTransfer.effectAllowed = "move";
	};
	const handleDragOver = (e: React.DragEvent<HTMLButtonElement>) => {
		if (!authorMode) return;
		const dragged = e.dataTransfer.types.includes("text/x-step-id");
		if (!dragged) return;
		e.preventDefault();
		e.dataTransfer.dropEffect = "move";
		setIsDragOver(true);
	};
	const handleDragLeave = () => {
		setIsDragOver(false);
	};
	const handleDrop = (e: React.DragEvent<HTMLButtonElement>) => {
		if (!authorMode || !onReorderWithin) return;
		e.preventDefault();
		setIsDragOver(false);
		const draggedStepId = e.dataTransfer.getData("text/x-step-id");
		if (!draggedStepId || !runStep.stepId || draggedStepId === runStep.stepId) return;
		// Reordering payload: we don't know the full section ordering here, so we hand
		// the dropped pair up; the commitReorder helper at the list level builds the
		// final tuple list.
		onReorderWithin([draggedStepId, runStep.stepId]);
	};

	return (
		<button
			type="button"
			onClick={onClick}
			draggable={authorMode}
			onDragStart={handleDragStart}
			onDragOver={handleDragOver}
			onDragLeave={handleDragLeave}
			onDrop={handleDrop}
			aria-current={active ? "step" : undefined}
			className={cn(
				"gap-2 flex items-center text-sm text-left px-2 py-1.5 rounded-md transition-colors w-full",
				active
					? "bg-background border border-border shadow-sm"
					: "hover:bg-muted/50",
				(isCompleted || isSkippedOrNA) && !active && !authorMode && "text-foreground/60",
				isDragOver && "ring-2 ring-primary/40",
				authorMode && "cursor-grab active:cursor-grabbing",
			)}
		>
			{authorMode && (
				<GripVertical
					className="size-3.5 text-foreground/30 shrink-0"
					aria-hidden
				/>
			)}
			<span className="shrink-0" aria-hidden>
				{icon}
			</span>
			<span
				className={cn(
					"flex-1 min-w-0 truncate flex flex-col gap-0.5",
					isCompleted && !authorMode && "line-through",
				)}
				title={
					runStep.blocked && !authorMode
						? "Blocked: a dependency step isn't complete yet"
						: undefined
				}
			>
				<span className="truncate">{runStep.title}</span>
				{authorMode && def?.dueRule && def.dueRule.dueType !== "none" && (
					<DueRuleSummary rule={def.dueRule} />
				)}
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

// ---------------------------------------------------------------------------
// Author-mode composed pieces
// ---------------------------------------------------------------------------

/** Author-mode chip rendered under the step title when a non-`none` due rule is
 * configured. Renders a single short line of plain text (truncated by the parent
 * column) plus a hover-title with the full description. Color-neutral on purpose:
 * the chip is reference information about the authored config, not a status
 * signal -- a colored badge here would compete visually with the run-status
 * cluster that lives in the same row when these defs are reused in run mode
 * (which never happens today because the run path doesn't pass dueRule, but the
 * caution is cheap). */
function DueRuleSummary({
	rule,
}: {
	rule: NonNullable<RunStepListDefinitionStep["dueRule"]>;
}) {
	const { text, title } = formatDueRule(rule);
	if (!text) return null;
	return (
		<span
			className="text-[10px] text-foreground/55 truncate font-normal"
			title={title}
		>
			{text}
		</span>
	);
}

/** Exported for unit tests; the component itself wraps the output in a chip. */
export function formatDueRule(rule: NonNullable<RunStepListDefinitionStep["dueRule"]>): {
	text: string;
	title: string;
} {
	const offset = rule.dueOffsetDays;
	// Phrase positive/negative offsets naturally: "3d after X" / "2d before X".
	// dueOffsetDays = 0 is "on" the anchor moment.
	const fmtOffset = (n: number, after: string, before: string) =>
		n === 0
			? `on ${after}`
			: n > 0
				? `${n}d after ${after}`
				: `${Math.abs(n)}d before ${before}`;

	switch (rule.dueType) {
		case "offset_from_start": {
			if (offset === null) return { text: "", title: "" };
			return {
				text: offset === 0 ? "due at launch" : `due ${offset}d after launch`,
				title:
					offset === 0
						? "Due at launch."
						: `Due ${offset} day(s) after the run launches.`,
			};
		}
		case "offset_from_step": {
			if (offset === null || !rule.dueAnchorStepTitle) {
				return { text: "due rule incomplete", title: "Anchor step or offset not set yet." };
			}
			const anchor = rule.dueAnchorStepTitle;
			return {
				text: `due ${fmtOffset(offset, anchor, anchor)}`,
				title: `Due ${Math.abs(offset)} day(s) ${offset >= 0 ? "after" : "before"} "${anchor}" completes.`,
			};
		}
		case "from_date_field": {
			if (offset === null || !rule.dueSourceFieldKey) {
				return { text: "due rule incomplete", title: "Source field or offset not set yet." };
			}
			const src = `{{${rule.dueSourceFieldKey}}}`;
			return {
				text: `due ${fmtOffset(offset, src, src)}`,
				title: `Due ${Math.abs(offset)} day(s) ${offset >= 0 ? "after" : "before"} the value of field "${rule.dueSourceFieldKey}".`,
			};
		}
		case "none":
			return { text: "", title: "" };
	}
}

function AuthorAddStepRow({ onClick }: { onClick: () => void }) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="gap-2 flex items-center text-xs text-foreground/60 hover:text-foreground hover:bg-muted/30 px-2 py-1.5 rounded-md transition-colors w-full"
		>
			<Plus className="size-3.5 shrink-0" />
			<span>Add step</span>
		</button>
	);
}

function AuthorAddSectionRow({ onClick }: { onClick: () => void }) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="gap-2 flex items-center text-xs text-foreground/60 hover:text-foreground hover:bg-muted/30 px-2 py-2 mt-2 border-t border-border rounded-md transition-colors w-full"
		>
			<Plus className="size-3.5 shrink-0" />
			<span>Add section</span>
		</button>
	);
}

const STEP_TYPE_ICONS: Record<StepType, React.ComponentType<{ className?: string }>> = {
	task: Circle,
	approval: UserCheck,
	heading: StickyNote,
	one_off: Zap,
	code: Circle, // reserved
	ai: Circle, // reserved
};

function renderStepTypeIcon(type: StepType) {
	const Icon = STEP_TYPE_ICONS[type];
	return <Icon className="size-4 text-foreground/40" />;
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
// Reorder commit -- builds full ordering tuples from a dropped pair
// ---------------------------------------------------------------------------

function commitReorder(
	pair: string[],
	itemsInSection: readonly RunStepListItem[],
	callbacks: AuthorListCallbacks,
) {
	const [draggedStepId, targetStepId] = pair;
	// Pull stepIds in current order, then move dragged before target.
	const ordered = itemsInSection
		.map((i) => i.stepId)
		.filter((id): id is string => id !== null);
	const fromIdx = ordered.indexOf(draggedStepId);
	const toIdx = ordered.indexOf(targetStepId);
	if (fromIdx < 0 || toIdx < 0) return;
	ordered.splice(fromIdx, 1);
	ordered.splice(toIdx, 0, draggedStepId);
	callbacks.onReorderSteps(ordered.map((stepId, position) => ({ stepId, position })));
}

// ---------------------------------------------------------------------------
// Grouping (unchanged from Pass 1)
// ---------------------------------------------------------------------------

function groupRunStepsBySection(
	sections: readonly RunStepListSection[],
	definitionSteps: readonly RunStepListDefinitionStep[],
	runSteps: readonly RunStepListItem[],
	includeEmptySections: boolean,
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
		// Author mode keeps empty sections visible so the +Add Step affordance is
		// reachable inside them; run mode skips empty sections (operator surfaces should
		// never render dead-end section headers).
		if (!items || items.length === 0) {
			if (!includeEmptySections) continue;
			result.push({ sectionId: section.id, sectionTitle: section.title, items: [] });
			continue;
		}
		result.push({ sectionId: section.id, sectionTitle: section.title, items });
	}
	const unsectioned = groupsBySectionId.get(null);
	if (unsectioned && unsectioned.length > 0) {
		result.push({
			sectionId: null,
			sectionTitle: sortedSections.length === 0 ? null : null,
			items: unsectioned,
		});
	}
	return result;
}
