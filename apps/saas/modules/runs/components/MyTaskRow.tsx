"use client";

// One row in My Work. Layout matches wireframe 07: checkbox (left) | task title +
// workflow/run context (middle) | due chip (right). Clicking the row body navigates to
// the Run view at this step. Clicking the checkbox quick-completes via the parent's
// mutation -- the spinner sits on the checkbox while in-flight. Blocked rows show a
// non-interactive Lock instead of the checkbox; clicking them still navigates.

import { cn } from "@virn/ui";
import { Spinner } from "@virn/ui/components/spinner";
import { CheckSquare, Lock, Square } from "lucide-react";

import type { RunStepStatus } from "../types";

export interface MyTaskRowData {
	runStepId: string;
	stepTitle: string;
	status: RunStepStatus;
	blocked: boolean;
	dueAt: Date | string | null;
	runId: string;
	runTitle: string;
	workflowTitle: string;
}

interface MyTaskRowProps {
	task: MyTaskRowData;
	completing: boolean;
	onQuickComplete: () => void;
	onOpen: () => void;
}

export function MyTaskRow({ task, completing, onQuickComplete, onOpen }: MyTaskRowProps) {
	const isCompleted = task.status === "completed";
	const canQuickComplete = !isCompleted && !task.blocked && !completing;

	return (
		<div
			className={cn(
				"group flex items-center gap-3 px-3 py-2.5 border-b border-border last:border-b-0 hover:bg-muted/30 transition-colors",
				isCompleted && "opacity-60",
			)}
		>
			{/* Left: checkbox / lock / spinner */}
			<button
				type="button"
				disabled={!canQuickComplete}
				onClick={(e) => {
					e.stopPropagation();
					if (canQuickComplete) onQuickComplete();
				}}
				className={cn(
					"shrink-0 size-5 rounded flex items-center justify-center transition-colors",
					canQuickComplete && "hover:bg-muted cursor-pointer",
					!canQuickComplete && "cursor-default",
				)}
				aria-label={
					isCompleted ? "Completed" : task.blocked ? "Blocked" : "Mark complete"
				}
				title={
					task.blocked
						? "Blocked — an earlier step in this run isn't completed yet"
						: isCompleted
							? "Completed"
							: "Mark complete"
				}
			>
				{completing ? (
					<Spinner className="size-4" />
				) : isCompleted ? (
					<CheckSquare className="size-4 text-emerald-600" />
				) : task.blocked ? (
					<Lock className="size-4 text-foreground/40" />
				) : (
					<Square className="size-4 text-foreground/40 group-hover:text-foreground/70" />
				)}
			</button>

			{/* Middle: title + context */}
			<button
				type="button"
				onClick={onOpen}
				className="flex-1 min-w-0 text-left"
			>
				<div className={cn("text-sm truncate", isCompleted && "line-through")}>
					{task.stepTitle}
				</div>
				<div className="text-xs text-foreground/60 truncate">
					{task.workflowTitle} · {task.runTitle}
				</div>
			</button>

			{/* Right: due chip */}
			{task.dueAt && (
				<span className="shrink-0 text-xs text-foreground/60">{formatDueChip(task.dueAt)}</span>
			)}
		</div>
	);
}

function formatDueChip(d: Date | string): string {
	const due = d instanceof Date ? d : new Date(d);
	const now = new Date();
	const startOfToday = new Date(now);
	startOfToday.setHours(0, 0, 0, 0);
	const startOfDue = new Date(due);
	startOfDue.setHours(0, 0, 0, 0);
	const diffDays = Math.round((startOfDue.getTime() - startOfToday.getTime()) / (24 * 60 * 60 * 1000));

	if (diffDays === 0) return "Today";
	if (diffDays === 1) return "Tomorrow";
	if (diffDays === -1) return "Yesterday";
	if (diffDays > 1 && diffDays <= 6) return `+${diffDays}d`;
	if (diffDays < -1 && diffDays >= -6) return `${diffDays}d`;
	// Beyond a week — absolute month/day.
	return due.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
