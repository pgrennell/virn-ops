"use client";

import { Progress } from "@virn/ui/components/progress";
import { cn } from "@virn/ui";
import { Bot, Briefcase } from "lucide-react";

import {
	RUN_MODE_BADGE_CLASS,
	RUN_MODE_LABEL,
	type RunMode,
} from "../lib/derive-run-mode";
import type { RunStatus } from "../types";

interface RunHeaderProps {
	title: string;
	status: RunStatus;
	completedCount: number;
	totalCount: number;
	startedAt: Date | string;
	dueAt: Date | string | null;
	/** Derived from participants + step-assignees (Phase 7 post-pivot threading; see
	 * `deriveRunMode`). Surfaced as a small badge alongside the status badge so the
	 * operator/admin sees the run's intended execution shape at a glance. */
	mode?: RunMode;
	/** Count of vendor participants in this run -- adds a small "1 vendor" / "2 vendors"
	 * chip when > 0. Vendors are orthogonal to mode (a human-mode run can still have
	 * vendor steps); the chip surfaces that mix without a full participants list. */
	vendorParticipantCount?: number;
	/** Count of agent participants in this run. When > 0, surfaces an "agent" chip
	 * (the mode badge already conveys this implicitly, but the explicit count is
	 * useful when more than one agent is involved post-Phase-11). */
	agentParticipantCount?: number;
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
	mode,
	vendorParticipantCount = 0,
	agentParticipantCount = 0,
}: RunHeaderProps) {
	const badge = STATUS_BADGE[status];
	const pct = totalCount === 0 ? 0 : Math.round((completedCount / totalCount) * 100);
	return (
		<div className="px-4 py-3 border-b border-border">
			<div className="gap-2 flex items-center flex-wrap">
				<h1 className="font-medium text-base flex-1 truncate min-w-0">{title}</h1>
				<span
					className={cn(
						"px-2 py-0.5 text-[11px] rounded font-medium uppercase tracking-wide shrink-0",
						badge.className,
					)}
				>
					{badge.label}
				</span>
				{mode && mode !== "human" && (
					<span
						className={cn(
							"px-2 py-0.5 text-[11px] rounded font-medium uppercase tracking-wide shrink-0",
							RUN_MODE_BADGE_CLASS[mode],
						)}
						title={`Launched in ${RUN_MODE_LABEL[mode]} mode (STRATEGY S-07)`}
					>
						{RUN_MODE_LABEL[mode]}
					</span>
				)}
				{vendorParticipantCount > 0 && (
					<span
						className="gap-1 px-2 py-0.5 text-[11px] rounded font-medium shrink-0 bg-amber-500/15 text-amber-700 dark:text-amber-400 inline-flex items-center"
						title={`${vendorParticipantCount} vendor ${vendorParticipantCount === 1 ? "participant" : "participants"} on this run (ADR-007)`}
					>
						<Briefcase className="size-3" />
						{vendorParticipantCount}{" "}
						{vendorParticipantCount === 1 ? "vendor" : "vendors"}
					</span>
				)}
				{agentParticipantCount > 0 && mode === "human" && (
					/* Defensive: a human-mode run shouldn't have agent participants but
					 * we surface the chip if it does for transparency. */
					<span
						className="gap-1 px-2 py-0.5 text-[11px] rounded font-medium shrink-0 bg-muted text-foreground/60 inline-flex items-center"
						title={`${agentParticipantCount} agent ${agentParticipantCount === 1 ? "participant" : "participants"} on this run`}
					>
						<Bot className="size-3" />
						{agentParticipantCount}
					</span>
				)}
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
