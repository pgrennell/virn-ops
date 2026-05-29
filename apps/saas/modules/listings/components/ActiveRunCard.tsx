"use client";

// Phase 10 / v1.5c (PRD §6.5 / R6 lift) -- Active Run right-rail card on
// entity-detail pages. The card surfaces in-flight `run` rows whose entity
// context matches the host entity (set at launch time via
// runs.launch.entityContext).
//
// Row click target:
//   `/[orgSlug]/library/workflows/[workflowId]/read?runId=<id>`
// which opens the Workflow Read view with the per-run timeline shipped in
// R5 cont. (the Read view's right column flips from generic flowchart to
// the static activity timeline when `?runId=` is set).
//
// Empty state: most entities will have zero active runs in flight at any
// given moment. The card stays compact and renders a one-line "No active
// runs" hint rather than hiding entirely -- the operator should see "yes,
// I'm looking at the right entity surface, nothing's running right now."
//
// Future surface (called out in PRD §6.5): when Playbooks ship in Phase
// 18b, the card grows to surface `playbook_run` rows alongside `run` rows
// (playbook click target is `/playbooks/[id]?view=read&runId=<id>`). The
// card's data source is already plural (runs[]) -- adding a playbook
// section is a layout change, not a contract change.

import { Spinner } from "@virn/ui/components/spinner";
import { cn } from "@virn/ui";
import { useQuery } from "@tanstack/react-query";
import { Activity, ChevronRight, Play } from "lucide-react";

import { orpc } from "@shared/lib/orpc-query-utils";

interface ActiveRunCardProps {
	organizationSlug: string;
	entityType: "listing";
	entityId: string;
}

export function ActiveRunCard({
	organizationSlug,
	entityType,
	entityId,
}: ActiveRunCardProps) {
	const query = useQuery(
		orpc.runs.listForEntity.queryOptions({
			input: { entityType, entityId },
		}),
	);

	const runs = query.data?.runs ?? [];

	return (
		<section className="rounded-lg border border-border bg-background overflow-hidden">
			<header className="px-3 py-2 border-b border-border bg-muted/20 flex items-center gap-2 text-xs uppercase tracking-wider font-semibold text-foreground/60">
				<Activity className="size-3.5" aria-hidden="true" />
				Active Run
				{runs.length > 0 && (
					<span className="ml-auto px-1.5 py-0.5 text-[10px] font-mono rounded bg-foreground/5 text-foreground/70">
						{runs.length}
					</span>
				)}
			</header>

			{query.isLoading && (
				<div className="flex items-center justify-center gap-2 py-6 text-xs text-foreground/60">
					<Spinner className="size-4" /> Loading…
				</div>
			)}

			{query.isError && (
				<div className="px-3 py-3 text-xs text-destructive">
					{query.error instanceof Error
						? query.error.message
						: "Couldn't load active runs."}
				</div>
			)}

			{!query.isLoading && !query.isError && runs.length === 0 && (
				<div className="px-3 py-4 text-xs text-foreground/50 leading-relaxed">
					No active runs on this entity right now.
				</div>
			)}

			{runs.length > 0 && (
				<ul className="flex flex-col">
					{runs.map((run) => (
						<li key={run.id}>
							<a
								href={`/${organizationSlug}/library/workflows/${run.workflowId}/read?runId=${run.id}`}
								className={cn(
									"flex items-center gap-2 px-3 py-2.5 border-b border-border/40 last:border-b-0",
									"hover:bg-muted/40 transition-colors",
								)}
							>
								<Play
									className="size-3.5 text-emerald-600 dark:text-emerald-400 shrink-0"
									aria-hidden="true"
								/>
								<div className="flex-1 min-w-0 flex flex-col gap-0.5">
									<span className="text-xs font-medium truncate">{run.title}</span>
									<span className="text-[10px] text-foreground/50 truncate">
										{run.workflowTitle} · started {formatRelativeShort(run.startedAt)}
									</span>
								</div>
								<ChevronRight
									className="size-3.5 text-foreground/30 shrink-0"
									aria-hidden="true"
								/>
							</a>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}

// ---------------------------------------------------------------------------
// Helpers. Exported for unit testing.
// ---------------------------------------------------------------------------

/** Compact relative date for the row subtitle. "5m / 2h / 3d ago" so the row
 * stays single-line even on narrow rails. Falls back to "just now" under a
 * minute and a calendar date past 30 days. */
export function formatRelativeShort(value: Date | string, now: Date = new Date()): string {
	const then = value instanceof Date ? value : new Date(value);
	const diffMs = now.getTime() - then.getTime();
	if (diffMs < 60_000) return "just now";
	const minutes = Math.floor(diffMs / 60_000);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	if (days < 30) return `${days}d ago`;
	return then.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
