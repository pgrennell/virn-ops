"use client";

// Home -- bridge dashboard (UX_SPEC §5.1, wireframe 06). Stat row + two-column body:
// "My tasks" (left, ~6 most-imminent) + right rail (Awaiting you cap-gated, Active runs).
// All gating/permissions resolved server-side; this client component just renders.

import { useSession } from "@auth/hooks/use-session";
import { orpc } from "@shared/lib/orpc-query-utils";
import { Alert, AlertDescription } from "@virn/ui/components/alert";
import { Button } from "@virn/ui/components/button";
import { Skeleton } from "@virn/ui/components/skeleton";
import { toastError } from "@virn/ui/components/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, FileText, Play } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ActiveRunCard } from "./ActiveRunCard";
import type { MyTaskRowData } from "./MyTaskRow";
import { MyTaskRow } from "./MyTaskRow";

interface HomeViewProps {
	orgSlug: string;
	/** True iff `governance.approvals` is on for this org. The Awaiting-you card is hidden
	 * entirely when false (UX §5.1: "the approvals card only shows if approvals is on"). */
	approvalsEnabled: boolean;
}

const HOME_TASK_LIMIT = 6;
const HOME_ACTIVE_RUNS_LIMIT = 8;

export function HomeView({ orgSlug, approvalsEnabled }: HomeViewProps) {
	const router = useRouter();
	const queryClient = useQueryClient();
	const { user } = useSession();

	const summary = useQuery(orpc.runs.getHomeSummary.queryOptions({ input: {} }));
	const tasks = useQuery(
		orpc.runs.listMyTasks.queryOptions({
			input: { status: "pending", limit: HOME_TASK_LIMIT },
		}),
	);
	const activeRuns = useQuery(
		orpc.runs.listActiveRuns.queryOptions({
			input: { limit: HOME_ACTIVE_RUNS_LIMIT },
		}),
	);

	const completeStep = useMutation(orpc.runs.completeStep.mutationOptions());
	const [completingRunStepId, setCompletingRunStepId] = useState<string | null>(null);

	const onOpenTask = (task: MyTaskRowData) =>
		router.push(`/${orgSlug}/runs/${task.runId}?step=${task.runStepId}`);

	const onQuickComplete = (task: MyTaskRowData) => {
		setCompletingRunStepId(task.runStepId);
		completeStep.mutate(
			{ runStepId: task.runStepId },
			{
				onSettled: () => setCompletingRunStepId(null),
				onSuccess: async () => {
					await Promise.all([
						queryClient.invalidateQueries({
							queryKey: orpc.runs.listMyTasks.queryKey({
								input: { status: "pending", limit: HOME_TASK_LIMIT },
							}),
						}),
						queryClient.invalidateQueries({
							queryKey: orpc.runs.getHomeSummary.queryKey({ input: {} }),
						}),
						queryClient.invalidateQueries({
							queryKey: orpc.runs.listActiveRuns.queryKey({
								input: { limit: HOME_ACTIVE_RUNS_LIMIT },
							}),
						}),
					]);
				},
				onError: (err) => handleQuickCompleteError(err, task, () => onOpenTask(task)),
			},
		);
	};

	return (
		<div className="max-w-5xl mx-auto w-full gap-6 flex flex-col">
			<header className="gap-3 flex items-center justify-between">
				<div>
					<h1 className="font-medium text-2xl">
						{greeting()}
						{user?.name ? `, ${firstName(user.name)}` : ""}
					</h1>
					<p className="text-sm text-foreground/60 mt-0.5">
						Here's what's on your plate today.
					</p>
				</div>
				<Button variant="primary" disabled title="Launching runs lands with the Library — coming soon">
					<Play className="size-3.5 mr-1" />
					Start a run
				</Button>
			</header>

			<StatRow summary={summary} />

			<div className="gap-6 grid lg:grid-cols-3 grid-cols-1">
				{/* My tasks — left column (spans 2/3 on wide) */}
				<section className="lg:col-span-2 gap-3 flex flex-col">
					<div className="flex items-center justify-between">
						<h2 className="font-medium text-sm">My tasks</h2>
						<Link
							href={`/${orgSlug}/my-work`}
							className="text-xs text-foreground/60 hover:text-foreground"
						>
							View all →
						</Link>
					</div>
					<TasksList
						query={tasks}
						completingRunStepId={completingRunStepId}
						onQuickComplete={onQuickComplete}
						onOpen={onOpenTask}
					/>
				</section>

				{/* Right rail */}
				<aside className="gap-6 flex flex-col">
					{approvalsEnabled && <AwaitingYouCard summary={summary} />}
					<ActiveRunsCard
						query={activeRuns}
						onOpen={(runId) => router.push(`/${orgSlug}/runs/${runId}`)}
					/>
				</aside>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Stat row
// ---------------------------------------------------------------------------

interface SummaryShape {
	openTasksCount: number;
	dueTodayCount: number;
	overdueCount: number;
	activeRunsCount: number;
	approvalsPendingCount: number;
}

function StatRow({ summary }: { summary: ReturnType<typeof useQuery<SummaryShape>> }) {
	if (summary.isLoading) {
		return (
			<div className="gap-3 grid grid-cols-2 md:grid-cols-4">
				{[0, 1, 2, 3].map((i) => (
					<Skeleton key={i} className="h-20 w-full" />
				))}
			</div>
		);
	}
	if (summary.isError || !summary.data) {
		return (
			<Alert variant="error">
				<AlertDescription>
					Couldn't load summary: {summary.error?.message ?? "unknown error"}
				</AlertDescription>
			</Alert>
		);
	}
	const stats = [
		{ label: "Open tasks", value: summary.data.openTasksCount },
		{ label: "Due today", value: summary.data.dueTodayCount, accent: summary.data.dueTodayCount > 0 },
		{
			label: "Overdue",
			value: summary.data.overdueCount,
			danger: summary.data.overdueCount > 0,
		},
		{ label: "Active runs", value: summary.data.activeRunsCount },
	];
	return (
		<div className="gap-3 grid grid-cols-2 md:grid-cols-4">
			{stats.map((s) => (
				<div
					key={s.label}
					className={`rounded-lg border border-border bg-background p-4 ${s.danger ? "border-destructive/30" : ""}`}
				>
					<div
						className={`text-2xl font-medium ${s.danger ? "text-destructive" : s.accent ? "text-foreground" : "text-foreground"}`}
					>
						{s.value}
					</div>
					<div className="text-xs text-foreground/60 mt-0.5">{s.label}</div>
				</div>
			))}
		</div>
	);
}

// ---------------------------------------------------------------------------
// My tasks list (left)
// ---------------------------------------------------------------------------

function TasksList({
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
	if (query.isLoading) {
		return (
			<div className="gap-2 flex flex-col">
				{[0, 1, 2].map((i) => (
					<Skeleton key={i} className="h-12 w-full" />
				))}
			</div>
		);
	}
	if (query.isError) {
		return (
			<Alert variant="error">
				<AlertDescription>Couldn't load tasks: {query.error?.message ?? "unknown"}</AlertDescription>
			</Alert>
		);
	}
	if (!query.data || query.data.length === 0) {
		return (
			<div className="rounded-lg border border-border bg-background p-8 text-center">
				<CheckCircle2 className="size-5 mx-auto text-foreground/30 mb-2" />
				<p className="text-sm text-foreground/60">Nothing on your plate.</p>
			</div>
		);
	}
	return (
		<div className="rounded-lg border border-border bg-background">
			{query.data.map((task) => (
				<MyTaskRow
					key={task.runStepId}
					task={task}
					completing={completingRunStepId === task.runStepId}
					onQuickComplete={() => onQuickComplete(task)}
					onOpen={() => onOpen(task)}
				/>
			))}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Awaiting you (approvals — capability-gated)
// ---------------------------------------------------------------------------

function AwaitingYouCard({ summary }: { summary: ReturnType<typeof useQuery<SummaryShape>> }) {
	const count = summary.data?.approvalsPendingCount ?? 0;
	return (
		<section className="gap-3 flex flex-col">
			<h2 className="font-medium text-sm">Awaiting you</h2>
			<div className="rounded-lg border border-border bg-background p-4">
				{count === 0 ? (
					<div className="text-sm text-foreground/60">
						<FileText className="size-4 inline-block mr-1 align-text-bottom text-foreground/30" />
						No approvals or acknowledgments pending.
					</div>
				) : (
					<div>
						<div className="text-2xl font-medium">{count}</div>
						<div className="text-xs text-foreground/60 mt-0.5">
							{count === 1 ? "Item awaiting you" : "Items awaiting you"}
						</div>
					</div>
				)}
			</div>
		</section>
	);
}

// ---------------------------------------------------------------------------
// Active runs (right)
// ---------------------------------------------------------------------------

interface ActiveRunShape {
	id: string;
	title: string;
	workflowTitle: string;
	startedAt: Date | string;
	dueAt: Date | string | null;
	totalSteps: number;
	completedSteps: number;
}

function ActiveRunsCard({
	query,
	onOpen,
}: {
	query: ReturnType<typeof useQuery<ActiveRunShape[]>>;
	onOpen: (runId: string) => void;
}) {
	return (
		<section className="gap-3 flex flex-col">
			<h2 className="font-medium text-sm">Active runs</h2>
			{query.isLoading ? (
				<div className="gap-2 flex flex-col">
					{[0, 1].map((i) => (
						<Skeleton key={i} className="h-20 w-full" />
					))}
				</div>
			) : query.isError ? (
				<Alert variant="error">
					<AlertDescription>
						Couldn't load runs: {query.error?.message ?? "unknown"}
					</AlertDescription>
				</Alert>
			) : !query.data || query.data.length === 0 ? (
				<div className="rounded-lg border border-border bg-background p-4 text-sm text-foreground/60">
					No active runs. Try{" "}
					<code className="text-[11px] bg-muted px-1 py-0.5 rounded">
						pnpm --filter @virn/scripts seed:demo-workflow
					</code>
					.
				</div>
			) : (
				<div className="gap-2 flex flex-col">
					{query.data.map((r) => (
						<ActiveRunCard
							key={r.id}
							runId={r.id}
							title={r.title}
							workflowTitle={r.workflowTitle}
							startedAt={r.startedAt}
							dueAt={r.dueAt}
							totalSteps={r.totalSteps}
							completedSteps={r.completedSteps}
							onClick={() => onOpen(r.id)}
						/>
					))}
				</div>
			)}
		</section>
	);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function greeting(): string {
	const h = new Date().getHours();
	if (h < 5) return "Good evening";
	if (h < 12) return "Good morning";
	if (h < 17) return "Good afternoon";
	return "Good evening";
}

function firstName(fullName: string): string {
	return fullName.split(" ")[0] ?? fullName;
}

function handleQuickCompleteError(err: Error, task: MyTaskRowData, onOpen: () => void) {
	const data = (err as Error & { data?: { code?: string } }).data;
	const code = data?.code;
	if (code === "REQUIRED_FIELD_UNFILLED") {
		toastError("Required fields missing", "Open the task to fill them, then complete.", {
			action: { label: "Open task", onClick: onOpen },
		});
		return;
	}
	if (code === "STOP_TASK_BLOCKED") {
		toastError("Blocked by an earlier step", "This task can't complete until its dependency is done.", {
			action: { label: "Open task", onClick: onOpen },
		});
		return;
	}
	toastError("Couldn't complete task", err.message);
}
