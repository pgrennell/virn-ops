"use client";

// Phase 16 -- admin triage view for suggestions. Status tabs (Open / Accepted /
// Rejected / Merged / All) + per-row decide actions (accept / reject / merge).
// URL state via nuqs for shareable links. Submit happens elsewhere (Read view
// footer); this is the resolution surface.

import { Pagination } from "@shared/components/Pagination";
import { orpc } from "@shared/lib/orpc-query-utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@virn/ui";
import { Alert, AlertDescription } from "@virn/ui/components/alert";
import { Badge } from "@virn/ui/components/badge";
import { Button } from "@virn/ui/components/button";
import { Skeleton } from "@virn/ui/components/skeleton";
import {
	CheckCircle2,
	GitMerge,
	Lightbulb,
	XCircle,
} from "lucide-react";
import Link from "next/link";
import { parseAsInteger, parseAsStringEnum, useQueryState } from "nuqs";

const ITEMS_PER_PAGE = 25;

const STATUS_KEYS = ["open", "accepted", "rejected", "merged"] as const;
type StatusKey = (typeof STATUS_KEYS)[number];
const TAB_KEYS = ["open", "accepted", "rejected", "merged", "all"] as const;
type TabKey = (typeof TAB_KEYS)[number];

const TAB_LABELS: Record<TabKey, string> = {
	open: "Open",
	accepted: "Accepted",
	rejected: "Rejected",
	merged: "Merged",
	all: "All",
};

interface SuggestionsTriageViewProps {
	organizationSlug: string;
	initialStatus: StatusKey | undefined;
	initialPage: number;
}

export function SuggestionsTriageView({
	organizationSlug,
	initialStatus,
	initialPage,
}: SuggestionsTriageViewProps) {
	const [status, setStatus] = useQueryState(
		"status",
		parseAsStringEnum<StatusKey>([...STATUS_KEYS])
			.withDefault(initialStatus ?? "open")
			.withOptions({ history: "replace" }),
	);
	const [page, setPage] = useQueryState(
		"page",
		parseAsInteger.withDefault(initialPage).withOptions({ history: "replace" }),
	);

	// Tab "all" maps to no status filter; the other tabs map directly.
	const tab: TabKey = (TAB_KEYS as readonly string[]).includes(status ?? "")
		? (status as TabKey)
		: "open";

	const listQuery = useQuery(
		orpc.suggestions.list.queryOptions({
			input: {
				status: tab === "all" ? undefined : (tab as StatusKey),
				limit: ITEMS_PER_PAGE,
				offset: (page - 1) * ITEMS_PER_PAGE,
			},
		}),
	);

	const onChangeTab = async (next: TabKey) => {
		await Promise.all([
			next === "all" ? setStatus(null) : setStatus(next as StatusKey),
			setPage(1),
		]);
	};

	return (
		<div className="rounded-lg border border-border bg-background overflow-hidden flex flex-col h-full min-h-0">
			<header className="px-4 py-3 border-b border-border">
				<div className="flex items-center gap-2">
					<Lightbulb className="size-4 text-foreground/60" />
					<h1 className="font-medium text-sm">Suggestions</h1>
				</div>
				<p className="text-xs text-foreground/60 mt-0.5">
					Improvement feedback against workflows. Triage open items + record the
					decision; the requester sees the outcome on their submitted suggestion.
				</p>
			</header>

			<nav
				className="px-4 border-b border-border gap-1 flex items-center overflow-x-auto"
				aria-label="Suggestion status tabs"
			>
				{TAB_KEYS.map((key) => (
					<button
						key={key}
						type="button"
						onClick={() => void onChangeTab(key)}
						aria-current={key === tab ? "page" : undefined}
						className={cn(
							"px-3 py-2 text-sm border-b-2 -mb-px transition-colors whitespace-nowrap",
							key === tab
								? "border-primary text-foreground font-medium"
								: "border-transparent text-foreground/60 hover:text-foreground",
						)}
					>
						{TAB_LABELS[key]}
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
								Couldn't load suggestions: {listQuery.error?.message ?? "unknown error"}
							</AlertDescription>
						</Alert>
					</div>
				) : !listQuery.data || listQuery.data.rows.length === 0 ? (
					<div className="px-5 py-16 text-sm text-foreground/60 text-center">
						{tab === "open"
							? "Nothing waiting for triage."
							: `No ${tab === "all" ? "" : tab + " "}suggestions yet.`}
					</div>
				) : (
					<ul className="divide-y divide-border">
						{listQuery.data.rows.map((row) => (
							<SuggestionRow
								key={row.id}
								row={row}
								organizationSlug={organizationSlug}
							/>
						))}
					</ul>
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

interface RowData {
	id: string;
	workflowId: string;
	workflowTitle: string;
	suggestedByName: string | null;
	suggestedByEmail: string | null;
	body: string;
	status: "open" | "accepted" | "rejected" | "merged";
	resolvedAt: Date | string | null;
	createdAt: Date | string;
}

function SuggestionRow({
	row,
	organizationSlug,
}: {
	row: RowData;
	organizationSlug: string;
}) {
	const queryClient = useQueryClient();
	const decideMut = useMutation({
		...orpc.suggestions.decide.mutationOptions(),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: orpc.suggestions.list.key() });
		},
	});
	const isOpen = row.status === "open";

	const createdAt =
		typeof row.createdAt === "string" ? new Date(row.createdAt) : row.createdAt;

	return (
		<li className="px-4 py-3 gap-2 flex flex-col">
			<div className="flex items-start justify-between gap-3 flex-wrap">
				<div className="min-w-0 flex-1">
					<Link
						href={`/${organizationSlug}/library/workflows/${row.workflowId}/read`}
						className="font-medium text-sm hover:underline"
					>
						{row.workflowTitle}
					</Link>
					<div className="text-xs text-foreground/60 mt-0.5">
						From {row.suggestedByName ?? row.suggestedByEmail ?? "Unknown user"}
						{" · "}
						{createdAt.toLocaleString()}
					</div>
				</div>
				<StatusBadge status={row.status} />
			</div>
			<p className="text-sm text-foreground/80 whitespace-pre-wrap border-l-2 border-border pl-3">
				{row.body}
			</p>
			{isOpen && (
				<div className="flex items-center justify-end gap-2">
					<Button
						variant="ghost"
						size="sm"
						onClick={() =>
							decideMut.mutate({ suggestionId: row.id, status: "rejected" })
						}
						disabled={decideMut.isPending}
					>
						<XCircle className="size-3.5 mr-1" />
						{decideMut.isPending ? "Deciding…" : "Reject"}
					</Button>
					<Button
						variant="ghost"
						size="sm"
						onClick={() =>
							decideMut.mutate({ suggestionId: row.id, status: "merged" })
						}
						disabled={decideMut.isPending}
					>
						<GitMerge className="size-3.5 mr-1" />
						Merged
					</Button>
					<Button
						variant="primary"
						size="sm"
						onClick={() =>
							decideMut.mutate({ suggestionId: row.id, status: "accepted" })
						}
						disabled={decideMut.isPending}
					>
						<CheckCircle2 className="size-3.5 mr-1" />
						Accept
					</Button>
				</div>
			)}
			{decideMut.isError && (
				<Alert variant="error">
					<AlertDescription className="text-xs">
						{decideMut.error instanceof Error
							? decideMut.error.message
							: "Couldn't update suggestion."}
					</AlertDescription>
				</Alert>
			)}
		</li>
	);
}

function StatusBadge({ status }: { status: RowData["status"] }) {
	const palette: Record<RowData["status"], "info" | "success" | "warning" | "error"> = {
		open: "info",
		accepted: "success",
		rejected: "error",
		merged: "success",
	};
	return (
		<Badge status={palette[status]}>{status}</Badge>
	);
}

function TableSkeleton() {
	return (
		<div className="px-4 py-3 gap-3 flex flex-col">
			{[0, 1, 2, 3].map((i) => (
				<Skeleton key={i} className="h-20 w-full" />
			))}
		</div>
	);
}
