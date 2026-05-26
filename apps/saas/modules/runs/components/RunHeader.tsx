"use client";

import { Progress } from "@virn/ui/components/progress";
import { cn } from "@virn/ui";

import type { RunStatus } from "../types";

interface RunHeaderProps {
	title: string;
	status: RunStatus;
	completedCount: number;
	totalCount: number;
	startedAt: Date | string;
	dueAt: Date | string | null;
}

const STATUS_BADGE: Record<RunStatus, { label: string; className: string }> = {
	active: { label: "Active", className: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-300" },
	completed: { label: "Completed", className: "bg-blue-100 text-blue-900 dark:bg-blue-900/30 dark:text-blue-300" },
	archived: { label: "Archived", className: "bg-muted text-muted-foreground" },
};

export function RunHeader({
	title,
	status,
	completedCount,
	totalCount,
	startedAt,
	dueAt,
}: RunHeaderProps) {
	const badge = STATUS_BADGE[status];
	const pct = totalCount === 0 ? 0 : Math.round((completedCount / totalCount) * 100);
	return (
		<div className="px-4 py-3 border-b border-border">
			<div className="gap-2 flex items-center">
				<h1 className="font-medium text-base flex-1 truncate">{title}</h1>
				<span
					className={cn(
						"px-2 py-0.5 text-[11px] rounded font-medium uppercase tracking-wide shrink-0",
						badge.className,
					)}
				>
					{badge.label}
				</span>
				<span className="text-xs text-foreground/60 shrink-0 hidden sm:inline">
					{dueAt ? `Due ${formatDate(dueAt)} · ` : ""}started {formatDate(startedAt)}
				</span>
			</div>
			<div className="gap-2.5 flex items-center mt-2">
				<Progress value={pct} className="h-1.5 flex-1" />
				<span className="text-xs text-foreground/60 shrink-0">
					{completedCount} of {totalCount} steps
				</span>
			</div>
		</div>
	);
}

function formatDate(d: Date | string): string {
	const date = d instanceof Date ? d : new Date(d);
	return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
