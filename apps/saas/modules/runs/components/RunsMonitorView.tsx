"use client";

// Phase 14 -- the Lightweight Monitor view (S-06).
//
// Renders the org-level /runs index + (when scopeWorkflowId is set) the per-
// workflow Runs surface (Slice C, see /library/workflows/[id]/runs). Tabs map to
// the runs.list procedure's status / needsAttention filters; the "Needs
// attention" tab is the union of overdue + blocked-by-stop-task (computed in
// SQL, see listRunsWithProgress).
//
// URL state lives in (view, sort, page) search params via nuqs so tab + sort
// changes are shareable and survive refresh. The scopeWorkflowId path skips URL
// state for the workflowId because that's pinned by the parent route.

import { Pagination } from "@shared/components/Pagination";
import { orpc } from "@shared/lib/orpc-query-utils";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@virn/ui";
import { Alert, AlertDescription } from "@virn/ui/components/alert";
import { Badge } from "@virn/ui/components/badge";
import { Progress } from "@virn/ui/components/progress";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@virn/ui/components/select";
import { Skeleton } from "@virn/ui/components/skeleton";
import { AlertTriangleIcon, LockIcon } from "lucide-react";
import Link from "next/link";
import { parseAsInteger, parseAsStringEnum, useQueryState } from "nuqs";
import { useMemo } from "react";

const ITEMS_PER_PAGE = 25;

const VIEW_KEYS = ["all", "active", "needs_attention", "completed"] as const;
type ViewKey = (typeof VIEW_KEYS)[number];

const SORT_KEYS = [
	"started_desc",
	"started_asc",
	"due_asc",
	"due_desc",
	"completed_desc",
] as const;
type SortKey = (typeof SORT_KEYS)[number];

const SORT_LABELS: Record<SortKey, string> = {
	started_desc: "Most recently started",
	started_asc: "Oldest first",
	due_asc: "Due soonest",
	due_desc: "Due latest",
	completed_desc: "Recently completed",
};

interface RunsMonitorViewProps {
	organizationSlug: string;
	initialView: ViewKey;
	initialSort: SortKey;
	initialPage: number;
	/** Org-level /runs only -- not surfaced today (no workflow filter UI in v1).
	 * Reserved for the search-param hydration path if the workflow-picker lands
	 * later. */
	initialWorkflowId?: string;
	/** When set, the view is pinned to this workflow (per-workflow Runs tab
	 * lives at /library/workflows/[id]/runs). Disables the URL workflowId path
	 * entirely so the parent route owns the scope. */
	scopeWorkflowId?: string;
}

export function RunsMonitorView({
	organizationSlug,
	initialView,
	initialSort,
	initialPage,
	scopeWorkflowId,
}: RunsMonitorViewProps) {
	const [view, setView] = useQueryState(
		"view",
		parseAsStringEnum<ViewKey>([...VIEW_KEYS])
			.withDefault(initialView)
			.withOptions({ history: "replace" }),
	);
	const [sort, setSort] = useQueryState(
		"sort",
		parseAsStringEnum<SortKey>([...SORT_KEYS])
			.withDefault(initialSort)
			.withOptions({ history: "replace" }),
	);
	const [page, setPage] = useQueryState(
		"page",
		parseAsInteger.withDefault(initialPage).withOptions({ history: "replace" }),
	);

	// Tab -> { statuses, needsAttention } translation. Keep the runs.list input
	// shape narrow so the procedure does the actual SQL filtering (the count
	// returned by the procedure agrees with the rendered rows on every tab).
	const tabFilter = useMemo(() => {
		switch (view) {
			case "all":
				return { statuses: undefined, needsAttention: undefined };
			case "active":
				return { statuses: ["active"] as const, needsAttention: undefined };
			case "needs_attention":
				return { statuses: undefined, needsAttention: true };
			case "completed":
				return { statuses: ["completed"] as const, needsAttention: undefined };
		}
	}, [view]);

	const listQuery = useQuery(
		orpc.runs.list.queryOptions({
			input: {
				workflowId: scopeWorkflowId,
				statuses: tabFilter.statuses
					? ([...tabFilter.statuses] as ("active" | "completed" | "archived")[])
					: undefined,
				needsAttention: tabFilter.needsAttention,
				sort,
				limit: ITEMS_PER_PAGE,
				offset: (page - 1) * ITEMS_PER_PAGE,
			},
		}),
	);

	const onChangeView = async (next: ViewKey) => {
		// Tab change always resets to page 1 -- prior offsets are meaningless once
		// the filter shape moves under the user.
		await Promise.all([setView(next), setPage(1)]);
	};

	return (
		<div className="rounded-lg border border-border bg-background overflow-hidden flex flex-col h-full min-h-0">
			<header className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
				<div className="min-w-0">
					<h1 className="font-medium text-sm">
						{scopeWorkflowId ? "Runs of this workflow" : "Runs"}
					</h1>
					<p className="text-xs text-foreground/60 mt-0.5">
						{scopeWorkflowId
							? "Every in-flight and completed run of this workflow."
							: "Every run across the org. Filter by status or pick a saved view."}
					</p>
				</div>
				<Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
					<SelectTrigger className="w-56 text-xs">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{SORT_KEYS.map((k) => (
							<SelectItem key={k} value={k} className="text-xs">
								{SORT_LABELS[k]}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</header>

			<nav
				className="px-4 border-b border-border gap-1 flex items-center overflow-x-auto"
				aria-label="Runs view tabs"
			>
				{VIEW_KEYS.map((key) => (
					<button
						key={key}
						type="button"
						onClick={() => void onChangeView(key)}
						aria-current={key === view ? "page" : undefined}
						className={cn(
							"px-3 py-2 text-sm border-b-2 -mb-px transition-colors whitespace-nowrap",
							key === view
								? "border-primary text-foreground font-medium"
								: "border-transparent text-foreground/60 hover:text-foreground",
						)}
					>
						{VIEW_LABELS[key]}
					</button>
				))}
			</nav>

			<div className="flex-1 min-h-0 overflow-y-auto">
				{listQuery.isLoading ? (
					<TableSkeleton />
				) : listQuery.isError ? (
					<div className="p-4">
						<Alert variant="error">
							<AlertDescription>
								Couldn't load runs: {listQuery.error?.message ?? "unknown error"}
							</AlertDescription>
						</Alert>
					</div>
				) : !listQuery.data || listQuery.data.rows.length === 0 ? (
					<EmptyState view={view} scopeWorkflow={!!scopeWorkflowId} />
				) : (
					<RunsTable rows={listQuery.data.rows} organizationSlug={organizationSlug} />
				)}
			</div>

			{listQuery.data && listQuery.data.totalCount > ITEMS_PER_PAGE && (
				<div className="border-t border-border py-3">
					<Pagination
						currentPage={page}
						totalItems={listQuery.data.totalCount}
						itemsPerPage={ITEMS_PER_PAGE}
						onChangeCurrentPage={(p) => void setPage(p)}
					/>
				</div>
			)}
		</div>
	);
}

const VIEW_LABELS: Record<ViewKey, string> = {
	all: "All",
	active: "Active",
	needs_attention: "Needs attention",
	completed: "Completed",
};

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

interface RunRow {
	id: string;
	title: string;
	status: "active" | "completed" | "archived";
	startedAt: Date | string;
	dueAt: Date | string | null;
	completedAt: Date | string | null;
	workflowTitle: string;
	totalSteps: number;
	completedSteps: number;
	isOverdue: boolean;
	hasBlockedStep: boolean;
}

function RunsTable({
	rows,
	organizationSlug,
}: {
	rows: RunRow[];
	organizationSlug: string;
}) {
	return (
		<table className="w-full text-sm">
			<thead className="sticky top-0 bg-background border-b border-border">
				<tr className="text-foreground/60 text-xs">
					<th className="text-left font-normal px-4 py-2">Run</th>
					<th className="text-left font-normal px-4 py-2">Status</th>
					<th className="text-left font-normal px-4 py-2 w-28">Started</th>
					<th className="text-left font-normal px-4 py-2 w-28">Due</th>
					<th className="text-left font-normal px-4 py-2 w-44">Progress</th>
				</tr>
			</thead>
			<tbody>
				{rows.map((row) => (
					<RunsTableRow
						key={row.id}
						row={row}
						organizationSlug={organizationSlug}
					/>
				))}
			</tbody>
		</table>
	);
}

function RunsTableRow({
	row,
	organizationSlug,
}: {
	row: RunRow;
	organizationSlug: string;
}) {
	const pct =
		row.totalSteps > 0 ? Math.round((row.completedSteps / row.totalSteps) * 100) : 0;

	return (
		<tr className="border-b border-border last:border-b-0 hover:bg-muted/30 transition-colors">
			<td className="px-4 py-3 align-top">
				<Link
					href={`/${organizationSlug}/runs/${row.id}`}
					className="font-medium text-foreground hover:underline"
				>
					{row.title}
				</Link>
				<div className="text-xs text-foreground/60 mt-0.5 truncate">
					{row.workflowTitle}
				</div>
			</td>
			<td className="px-4 py-3 align-top">
				<StatusCell row={row} />
			</td>
			<td className="px-4 py-3 align-top text-xs text-foreground/70 whitespace-nowrap">
				{formatRelative(row.startedAt)}
			</td>
			<td className="px-4 py-3 align-top text-xs whitespace-nowrap">
				{row.dueAt ? (
					<span className={cn(row.isOverdue ? "text-destructive font-medium" : "text-foreground/70")}>
						{formatRelative(row.dueAt)}
					</span>
				) : (
					<span className="text-foreground/40">—</span>
				)}
			</td>
			<td className="px-4 py-3 align-top">
				<div className="flex items-center gap-2">
					<Progress value={pct} className="flex-1 h-1.5" />
					<span className="text-[11px] text-foreground/60 whitespace-nowrap tabular-nums">
						{row.completedSteps}/{row.totalSteps}
					</span>
				</div>
			</td>
		</tr>
	);
}

function StatusCell({ row }: { row: RunRow }) {
	const status: "success" | "info" | "warning" | "error" =
		row.status === "completed"
			? "success"
			: row.status === "archived"
				? "info"
				: row.isOverdue
					? "error"
					: row.hasBlockedStep
						? "warning"
						: "info";

	const label =
		row.status === "completed"
			? "Completed"
			: row.status === "archived"
				? "Archived"
				: row.isOverdue
					? "Overdue"
					: row.hasBlockedStep
						? "Blocked"
						: "Active";

	const icon =
		row.status === "active" && row.isOverdue ? (
			<AlertTriangleIcon className="size-3 mr-1 inline align-text-top" />
		) : row.status === "active" && row.hasBlockedStep ? (
			<LockIcon className="size-3 mr-1 inline align-text-top" />
		) : null;

	return (
		<Badge status={status}>
			{icon}
			{label}
		</Badge>
	);
}

// ---------------------------------------------------------------------------
// Empty + loading states
// ---------------------------------------------------------------------------

function EmptyState({ view, scopeWorkflow }: { view: ViewKey; scopeWorkflow: boolean }) {
	const copy = (() => {
		if (view === "needs_attention") {
			return scopeWorkflow
				? "Nothing in this workflow needs attention right now."
				: "Nothing across the org needs attention right now.";
		}
		if (view === "completed") {
			return scopeWorkflow
				? "No completed runs of this workflow yet."
				: "No completed runs yet.";
		}
		if (view === "active") {
			return scopeWorkflow ? "No active runs of this workflow." : "No active runs right now.";
		}
		return scopeWorkflow
			? "No runs of this workflow yet."
			: "No runs yet. Launch a workflow from your Library to track it here.";
	})();
	return (
		<div className="px-5 py-16 text-sm text-foreground/60 text-center">{copy}</div>
	);
}

function TableSkeleton() {
	return (
		<div className="px-4 py-3 gap-2 flex flex-col">
			{[0, 1, 2, 3, 4].map((i) => (
				<Skeleton key={i} className="h-12 w-full" />
			))}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Date formatting (kept inline -- one call site, no need for a helper module)
// ---------------------------------------------------------------------------

function formatRelative(ts: Date | string): string {
	const d = typeof ts === "string" ? new Date(ts) : ts;
	const diffMs = d.getTime() - Date.now();
	const diffMin = Math.round(diffMs / 60_000);
	const diffHr = Math.round(diffMs / 3_600_000);
	const diffDay = Math.round(diffMs / 86_400_000);
	const abs = Math.abs;

	if (abs(diffMin) < 60) {
		if (diffMin === 0) return "now";
		return diffMin < 0 ? `${abs(diffMin)}m ago` : `in ${diffMin}m`;
	}
	if (abs(diffHr) < 24) {
		return diffHr < 0 ? `${abs(diffHr)}h ago` : `in ${diffHr}h`;
	}
	if (abs(diffDay) < 30) {
		return diffDay < 0 ? `${abs(diffDay)}d ago` : `in ${diffDay}d`;
	}
	return d.toLocaleDateString();
}
