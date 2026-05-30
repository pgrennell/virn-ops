"use client";

// Phase 15 -- read-only acknowledgments index for the compliance reader.
//
// Single table over acknowledgment + workflow + version + user joined inline
// (no N+1). Each row links to /compliance/acknowledgments/[id] for the
// printable receipt. URL-driven pagination via nuqs so refresh-stable.

import { Pagination } from "@shared/components/Pagination";
import { orpc } from "@shared/lib/orpc-query-utils";
import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription } from "@virn/ui/components/alert";
import { Skeleton } from "@virn/ui/components/skeleton";
import { CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { parseAsInteger, useQueryState } from "nuqs";

const ITEMS_PER_PAGE = 25;

interface AcknowledgmentsListViewProps {
	organizationSlug: string;
	initialPage: number;
}

export function AcknowledgmentsListView({
	organizationSlug,
	initialPage,
}: AcknowledgmentsListViewProps) {
	const [page, setPage] = useQueryState(
		"page",
		parseAsInteger.withDefault(initialPage).withOptions({ history: "replace" }),
	);

	const listQuery = useQuery(
		orpc.acknowledgments.list.queryOptions({
			input: {
				limit: ITEMS_PER_PAGE,
				offset: (page - 1) * ITEMS_PER_PAGE,
			},
		}),
	);

	return (
		<div className="rounded-lg border border-border bg-background overflow-hidden flex flex-col h-full min-h-0">
			<header className="px-4 py-3 border-b border-border">
				<h1 className="font-medium text-sm">Acknowledgments</h1>
				<p className="text-xs text-foreground/60 mt-0.5">
					Every "I've read and agreed to this version" record in the org.
				</p>
			</header>

			<div className="flex-1 min-h-0 overflow-y-auto">
				{listQuery.isLoading ? (
					<TableSkeleton />
				) : listQuery.isError ? (
					<div className="p-4">
						<Alert variant="error">
							<AlertDescription>
								Couldn't load acknowledgments:{" "}
								{listQuery.error?.message ?? "unknown error"}
							</AlertDescription>
						</Alert>
					</div>
				) : !listQuery.data || listQuery.data.rows.length === 0 ? (
					<div className="px-5 py-16 text-sm text-foreground/60 text-center">
						<CheckCircle2 className="size-5 mx-auto text-foreground/30 mb-2" />
						No acknowledgments recorded yet.
					</div>
				) : (
					<table className="w-full text-sm">
						<thead className="sticky top-0 bg-background border-b border-border">
							<tr className="text-foreground/60 text-xs">
								<th className="text-left font-normal px-4 py-2">Workflow</th>
								<th className="text-left font-normal px-4 py-2 w-20">Version</th>
								<th className="text-left font-normal px-4 py-2">User</th>
								<th className="text-left font-normal px-4 py-2 w-40">Acknowledged</th>
							</tr>
						</thead>
						<tbody>
							{listQuery.data.rows.map((row) => (
								<Row key={row.id} row={row} organizationSlug={organizationSlug} />
							))}
						</tbody>
					</table>
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
	acknowledgedAt: Date | string;
	workflowId: string;
	workflowTitle: string;
	workflowVersionNumber: number;
	userId: string;
	userName: string | null;
	userEmail: string;
}

function Row({ row, organizationSlug }: { row: RowData; organizationSlug: string }) {
	const date = typeof row.acknowledgedAt === "string"
		? new Date(row.acknowledgedAt)
		: row.acknowledgedAt;
	return (
		<tr className="border-b border-border last:border-b-0 hover:bg-muted/30 transition-colors">
			<td className="px-4 py-3 align-top">
				<Link
					href={`/${organizationSlug}/compliance/acknowledgments/${row.id}`}
					className="font-medium text-foreground hover:underline"
				>
					{row.workflowTitle}
				</Link>
			</td>
			<td className="px-4 py-3 align-top text-xs text-foreground/70 tabular-nums">
				v{row.workflowVersionNumber}
			</td>
			<td className="px-4 py-3 align-top">
				<div className="text-sm">{row.userName ?? row.userEmail}</div>
				{row.userName && row.userName !== row.userEmail && (
					<div className="text-xs text-foreground/60">{row.userEmail}</div>
				)}
			</td>
			<td className="px-4 py-3 align-top text-xs text-foreground/70 whitespace-nowrap">
				{date.toLocaleString()}
			</td>
		</tr>
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
