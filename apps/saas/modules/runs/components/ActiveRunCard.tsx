"use client";

// One card in the Home right-rail "Active runs" column. Title + workflow context + due +
// per-run progress bar. Whole card is clickable -> /runs/[runId].

import { cn } from "@virn/ui";
import { Progress } from "@virn/ui/components/progress";

interface ActiveRunCardProps {
	runId: string;
	title: string;
	workflowTitle: string;
	startedAt: Date | string;
	dueAt: Date | string | null;
	totalSteps: number;
	completedSteps: number;
	onClick: () => void;
}

export function ActiveRunCard({
	title,
	workflowTitle,
	startedAt,
	dueAt,
	totalSteps,
	completedSteps,
	onClick,
}: ActiveRunCardProps) {
	const pct = totalSteps === 0 ? 0 : Math.round((completedSteps / totalSteps) * 100);
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"text-left rounded-lg border border-border bg-background p-3 transition-colors hover:bg-muted/40 w-full",
				"gap-2 flex flex-col",
			)}
		>
			<div className="gap-2 flex items-start justify-between min-w-0">
				<div className="flex-1 min-w-0">
					<div className="text-sm font-medium truncate">{title}</div>
					<div className="text-xs text-foreground/60 truncate">{workflowTitle}</div>
				</div>
				<span className="shrink-0 text-[11px] text-foreground/50">
					{dueAt ? `Due ${formatShort(dueAt)}` : `Started ${formatShort(startedAt)}`}
				</span>
			</div>
			<div className="gap-2 flex items-center">
				<Progress value={pct} className="h-1.5 flex-1" />
				<span className="text-[11px] text-foreground/60 shrink-0">
					{completedSteps} of {totalSteps}
				</span>
			</div>
		</button>
	);
}

function formatShort(d: Date | string): string {
	const date = d instanceof Date ? d : new Date(d);
	return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
