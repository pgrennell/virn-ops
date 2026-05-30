"use client";

// Phase 16 -- pending approvals dashboard. Lists every pending
// version_approval in the org; reviewers approve/reject inline with an
// optional note. Idempotent against the WHERE-pending check in
// decideVersionApprovalRow: two reviewers can't double-decide.

import { Pagination } from "@shared/components/Pagination";
import { orpc } from "@shared/lib/orpc-query-utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription } from "@virn/ui/components/alert";
import { Button } from "@virn/ui/components/button";
import { Skeleton } from "@virn/ui/components/skeleton";
import { Textarea } from "@virn/ui/components/textarea";
import { CheckCircle2, ShieldCheck, XCircle } from "lucide-react";
import Link from "next/link";
import { parseAsInteger, useQueryState } from "nuqs";
import { useState } from "react";

const ITEMS_PER_PAGE = 25;

interface ApprovalsDashboardViewProps {
	organizationSlug: string;
	initialPage: number;
}

export function ApprovalsDashboardView({
	organizationSlug,
	initialPage,
}: ApprovalsDashboardViewProps) {
	const [page, setPage] = useQueryState(
		"page",
		parseAsInteger.withDefault(initialPage).withOptions({ history: "replace" }),
	);

	const listQuery = useQuery(
		orpc.approvals.listPending.queryOptions({
			input: {
				limit: ITEMS_PER_PAGE,
				offset: (page - 1) * ITEMS_PER_PAGE,
			},
		}),
	);

	return (
		<div className="rounded-lg border border-border bg-background overflow-hidden flex flex-col h-full min-h-0">
			<header className="px-4 py-3 border-b border-border">
				<div className="flex items-center gap-2">
					<ShieldCheck className="size-4 text-foreground/60" />
					<h1 className="font-medium text-sm">Pending approvals</h1>
				</div>
				<p className="text-xs text-foreground/60 mt-0.5">
					Workflow versions awaiting your decision. Oldest first.
				</p>
			</header>

			<div className="flex-1 min-h-0 overflow-y-auto">
				{listQuery.isLoading ? (
					<TableSkeleton />
				) : listQuery.isError ? (
					<div className="p-4">
						<Alert variant="error">
							<AlertDescription>
								Couldn't load pending approvals:{" "}
								{listQuery.error?.message ?? "unknown error"}
							</AlertDescription>
						</Alert>
					</div>
				) : !listQuery.data || listQuery.data.rows.length === 0 ? (
					<div className="px-5 py-16 text-sm text-foreground/60 text-center">
						<CheckCircle2 className="size-5 mx-auto text-emerald-500 mb-2" />
						Nothing waiting on you. The approvals queue is clear.
					</div>
				) : (
					<ul className="divide-y divide-border">
						{listQuery.data.rows.map((row) => (
							<ApprovalRow
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
	workflowVersionId: string;
	workflowTitle: string;
	workflowVersionNumber: number;
	requestedByName: string | null;
	requestedByEmail: string | null;
	createdAt: Date | string;
}

function ApprovalRow({
	row,
	organizationSlug,
}: {
	row: RowData;
	organizationSlug: string;
}) {
	const queryClient = useQueryClient();
	const [note, setNote] = useState("");
	const [expanded, setExpanded] = useState(false);

	const decideMut = useMutation({
		...orpc.approvals.decide.mutationOptions(),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: orpc.approvals.listPending.key() });
			void queryClient.invalidateQueries({
				queryKey: orpc.approvals.getLatest.queryKey({
					input: { workflowVersionId: row.workflowVersionId },
				}),
			});
		},
	});

	const createdAt =
		typeof row.createdAt === "string" ? new Date(row.createdAt) : row.createdAt;

	return (
		<li className="px-4 py-3 gap-3 flex flex-col">
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0 flex-1">
					<Link
						href={`/${organizationSlug}/library/workflows/${row.workflowId}/builder`}
						className="font-medium text-sm hover:underline"
					>
						{row.workflowTitle}{" "}
						<span className="text-foreground/50 font-normal">
							· v{row.workflowVersionNumber}
						</span>
					</Link>
					<div className="text-xs text-foreground/60 mt-0.5">
						Requested by{" "}
						{row.requestedByName ?? row.requestedByEmail ?? "Unknown user"}
						{" · "}
						{createdAt.toLocaleString()}
					</div>
				</div>
				<div className="shrink-0 flex items-center gap-2">
					<Button
						variant="ghost"
						size="sm"
						onClick={() => setExpanded((e) => !e)}
						disabled={decideMut.isPending}
					>
						{expanded ? "Cancel" : "Review"}
					</Button>
				</div>
			</div>
			{expanded && (
				<div className="gap-2 flex flex-col rounded-md border border-border bg-muted/20 p-3">
					<label className="text-[10px] uppercase tracking-wide text-foreground/50">
						Note (optional)
					</label>
					<Textarea
						value={note}
						onChange={(e) => setNote(e.target.value)}
						placeholder="Add context for the requester (especially useful on rejection)."
						rows={2}
						maxLength={2000}
						disabled={decideMut.isPending}
					/>
					<div className="flex items-center justify-end gap-2">
						<Button
							variant="ghost"
							size="sm"
							onClick={() =>
								decideMut.mutate({
									approvalId: row.id,
									decision: "rejected",
									note: note.trim() || null,
								})
							}
							disabled={decideMut.isPending}
						>
							<XCircle className="size-3.5 mr-1" />
							{decideMut.isPending ? "Deciding…" : "Reject"}
						</Button>
						<Button
							variant="primary"
							size="sm"
							onClick={() =>
								decideMut.mutate({
									approvalId: row.id,
									decision: "approved",
									note: note.trim() || null,
								})
							}
							disabled={decideMut.isPending}
						>
							<CheckCircle2 className="size-3.5 mr-1" />
							{decideMut.isPending ? "Deciding…" : "Approve"}
						</Button>
					</div>
					{decideMut.isError && (
						<Alert variant="error">
							<AlertDescription className="text-xs">
								{decideMut.error instanceof Error
									? decideMut.error.message
									: "Couldn't decide approval."}
							</AlertDescription>
						</Alert>
					)}
				</div>
			)}
		</li>
	);
}

function TableSkeleton() {
	return (
		<div className="px-4 py-3 gap-3 flex flex-col">
			{[0, 1, 2, 3].map((i) => (
				<Skeleton key={i} className="h-14 w-full" />
			))}
		</div>
	);
}
