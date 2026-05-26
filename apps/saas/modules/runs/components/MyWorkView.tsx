"use client";

// My Work — the operator's inbox over their `run_step` assignments (UX_SPEC §5.2,
// wireframe 07). Tabs (To do / Completed) + due-bucket grouping on the To do tab. Quick-
// complete inline; row click navigates to the Run view at that step (`?step=...`).
//
// Errors from quick-complete that are actionable -- REQUIRED_FIELD_UNFILLED or
// STOP_TASK_BLOCKED -- surface a toast with an "Open task" action so the user knows the
// next move. Generic errors show a bare error toast.

import { orpc } from "@shared/lib/orpc-query-utils";
import { Skeleton } from "@virn/ui/components/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@virn/ui/components/tabs";
import { toastError } from "@virn/ui/components/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import type { MyTaskRowData } from "./MyTaskRow";
import { MyTaskRow } from "./MyTaskRow";

interface MyWorkViewProps {
	orgSlug: string;
}

interface BucketGroup {
	id: "overdue" | "today" | "this-week" | "later";
	label: string;
	rows: MyTaskRowData[];
}

export function MyWorkView({ orgSlug }: MyWorkViewProps) {
	const queryClient = useQueryClient();
	const router = useRouter();

	const todoQuery = useQuery(
		orpc.runs.listMyTasks.queryOptions({
			input: { status: "pending", limit: 100 },
		}),
	);
	const doneQuery = useQuery(
		orpc.runs.listMyTasks.queryOptions({
			input: { status: "completed", limit: 100 },
		}),
	);

	const completeStep = useMutation(orpc.runs.completeStep.mutationOptions());
	const [completingRunStepId, setCompletingRunStepId] = useState<string | null>(null);

	const onOpen = (task: MyTaskRowData) =>
		router.push(`/${orgSlug}/runs/${task.runId}?step=${task.runStepId}`);

	const onQuickComplete = (task: MyTaskRowData) => {
		setCompletingRunStepId(task.runStepId);
		completeStep.mutate(
			{ runStepId: task.runStepId },
			{
				onSettled: () => setCompletingRunStepId(null),
				onSuccess: async () => {
					// Invalidate both tabs (pending list and completed list). oRPC's queryKey
					// helper requires the same input shape that the original useQuery used; we
					// invalidate each tab explicitly rather than fan out to all variants.
					await Promise.all([
						queryClient.invalidateQueries({
							queryKey: orpc.runs.listMyTasks.queryKey({
								input: { status: "pending", limit: 100 },
							}),
						}),
						queryClient.invalidateQueries({
							queryKey: orpc.runs.listMyTasks.queryKey({
								input: { status: "completed", limit: 100 },
							}),
						}),
					]);
				},
				onError: (err) => {
					handleQuickCompleteError(err, task, () => onOpen(task));
				},
			},
		);
	};

	return (
		<div className="max-w-3xl mx-auto w-full">
			<header className="mb-4">
				<h1 className="font-medium text-2xl">My work</h1>
				<p className="text-sm text-foreground/60 mt-1">
					Every task assigned to you across all runs.
				</p>
			</header>

			<Tabs defaultValue="todo" className="w-full">
				<TabsList>
					<TabsTrigger value="todo">
						To do
						{todoQuery.data && todoQuery.data.length > 0 && (
							<span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] bg-muted text-muted-foreground">
								{todoQuery.data.length}
							</span>
						)}
					</TabsTrigger>
					<TabsTrigger value="done">Completed</TabsTrigger>
				</TabsList>

				<TabsContent value="todo" className="mt-4">
					<TodoList
						query={todoQuery}
						completingRunStepId={completingRunStepId}
						onQuickComplete={onQuickComplete}
						onOpen={onOpen}
					/>
				</TabsContent>

				<TabsContent value="done" className="mt-4">
					<CompletedList query={doneQuery} onOpen={onOpen} />
				</TabsContent>
			</Tabs>
		</div>
	);
}

// ---------------------------------------------------------------------------
// To-do tab — due-bucket grouping
// ---------------------------------------------------------------------------

function TodoList({
	query,
	completingRunStepId,
	onQuickComplete,
	onOpen,
}: {
	query: ReturnType<typeof useQuery<MyTaskRowData[]>>;
	completingRunStepId: string | null;
	onQuickComplete: (task: MyTaskRowData) => void;
	onOpen: (task: MyTaskRowData) => void;
}) {
	const groups = useMemo(() => bucketByDue(query.data ?? []), [query.data]);

	if (query.isLoading) return <ListSkeleton />;
	if (query.isError) return <ErrorState message={query.error?.message ?? "Failed to load"} />;
	if (!query.data || query.data.length === 0) {
		return <EmptyState message="Nothing on your plate. Nice." />;
	}

	return (
		<div className="gap-6 flex flex-col">
			{groups.map((group) =>
				group.rows.length === 0 ? null : (
					<section key={group.id}>
						<h2 className="text-xs uppercase tracking-wide font-medium text-foreground/50 mb-2 px-3">
							{group.label} <span className="text-foreground/40">· {group.rows.length}</span>
						</h2>
						<div className="rounded-lg border border-border bg-background">
							{group.rows.map((task) => (
								<MyTaskRow
									key={task.runStepId}
									task={task}
									completing={completingRunStepId === task.runStepId}
									onQuickComplete={() => onQuickComplete(task)}
									onOpen={() => onOpen(task)}
								/>
							))}
						</div>
					</section>
				),
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Completed tab — flat list
// ---------------------------------------------------------------------------

function CompletedList({
	query,
	onOpen,
}: {
	query: ReturnType<typeof useQuery<MyTaskRowData[]>>;
	onOpen: (task: MyTaskRowData) => void;
}) {
	if (query.isLoading) return <ListSkeleton />;
	if (query.isError) return <ErrorState message={query.error?.message ?? "Failed to load"} />;
	if (!query.data || query.data.length === 0) {
		return <EmptyState message="Nothing completed yet." />;
	}

	// Completed dueAt-desc (most recent first), but the procedure orders by dueAt asc.
	// Re-sort here client-side -- cheap on <= 100 rows.
	const sorted = [...query.data].sort((a, b) => {
		const aTime = a.dueAt ? new Date(a.dueAt).getTime() : 0;
		const bTime = b.dueAt ? new Date(b.dueAt).getTime() : 0;
		return bTime - aTime;
	});

	return (
		<div className="rounded-lg border border-border bg-background">
			{sorted.map((task) => (
				<MyTaskRow
					key={task.runStepId}
					task={task}
					completing={false}
					onQuickComplete={() => {
						// no-op: completed rows can't be re-completed; the row's button is disabled.
					}}
					onOpen={() => onOpen(task)}
				/>
			))}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bucketByDue(rows: MyTaskRowData[]): BucketGroup[] {
	const now = new Date();
	const startOfToday = new Date(now);
	startOfToday.setHours(0, 0, 0, 0);
	const startOfTomorrow = new Date(startOfToday);
	startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
	const startOfNextWeek = new Date(startOfToday);
	startOfNextWeek.setDate(startOfNextWeek.getDate() + 7);

	const overdue: MyTaskRowData[] = [];
	const today: MyTaskRowData[] = [];
	const thisWeek: MyTaskRowData[] = [];
	const later: MyTaskRowData[] = [];

	for (const r of rows) {
		const due = r.dueAt ? new Date(r.dueAt) : null;
		if (!due) {
			later.push(r);
			continue;
		}
		if (due < startOfToday) overdue.push(r);
		else if (due < startOfTomorrow) today.push(r);
		else if (due < startOfNextWeek) thisWeek.push(r);
		else later.push(r);
	}

	return [
		{ id: "overdue", label: "Overdue", rows: overdue },
		{ id: "today", label: "Today", rows: today },
		{ id: "this-week", label: "This week", rows: thisWeek },
		{ id: "later", label: "Later", rows: later },
	];
}

function handleQuickCompleteError(err: Error, task: MyTaskRowData, onOpen: () => void) {
	// oRPC ORPCError carries our typed code via `.data.code`. Fall back to message-sniffing
	// if the data field isn't present (e.g., a transport-level error).
	const data = (err as Error & { data?: { code?: string } }).data;
	const code = data?.code;

	if (code === "REQUIRED_FIELD_UNFILLED") {
		toastError(
			"Required fields missing",
			"Open the task to fill them, then complete.",
			{ action: { label: "Open task", onClick: onOpen } },
		);
		return;
	}
	if (code === "STOP_TASK_BLOCKED") {
		toastError(
			"Blocked by an earlier step",
			"This task can't complete until its dependency is done.",
			{ action: { label: "Open task", onClick: onOpen } },
		);
		return;
	}
	toastError("Couldn't complete task", err.message);
}

function ListSkeleton() {
	return (
		<div className="gap-2 flex flex-col">
			{[0, 1, 2, 3].map((i) => (
				<Skeleton key={i} className="h-12 w-full" />
			))}
		</div>
	);
}

function ErrorState({ message }: { message: string }) {
	return <div className="text-sm text-destructive px-3 py-4">Couldn't load tasks: {message}</div>;
}

function EmptyState({ message }: { message: string }) {
	return <div className="text-sm text-foreground/60 px-3 py-8 text-center">{message}</div>;
}
