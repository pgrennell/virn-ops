"use client";

// Phase 18a -- Playbook Read view. Chronological timeline render of the
// latest published version. Distinct from Workflow Read view (SOP markdown +
// flowchart) per D-039 / PRD_PLAYBOOKS §6.5 -- the timeline metaphor matches
// the data shape (steps are inherently sequential with time-staged waits).

import { orpc } from "@shared/lib/orpc-query-utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription } from "@virn/ui/components/alert";
import { Badge } from "@virn/ui/components/badge";
import { Button } from "@virn/ui/components/button";
import { Skeleton } from "@virn/ui/components/skeleton";
import {
	Clock,
	GitBranch,
	Pencil,
	Play,
	Save,
	Send,
	Zap,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

const STEP_TYPE_LABELS: Record<string, string> = {
	wait_for_duration: "Wait (duration)",
	wait_for_event: "Wait (event)",
	launch_workflow: "Launch workflow",
	send_notification: "Send notification",
	branch_on_data_set: "Branch on data set",
	write_to_data_set: "Write to data set",
};

const STEP_TYPE_ICONS: Record<string, typeof Clock> = {
	wait_for_duration: Clock,
	wait_for_event: Clock,
	launch_workflow: Zap,
	send_notification: Send,
	branch_on_data_set: GitBranch,
	write_to_data_set: Save,
};

interface PlaybookReadViewProps {
	playbookId: string;
	organizationSlug: string;
	isAdminOrOwner: boolean;
	/** Phase 18b-3 -- when set, the Read view becomes the EXECUTE view: a banner
	 * shows the live run's status + next-wake countdown, with a cancel control. */
	runId?: string | null;
}

export function PlaybookReadView({
	playbookId,
	organizationSlug,
	isAdminOrOwner,
	runId = null,
}: PlaybookReadViewProps) {
	const queryClient = useQueryClient();
	const router = useRouter();
	const getQuery = useQuery(
		orpc.playbooks.get.queryOptions({ input: { playbookId } }),
	);

	// Phase 18b-3 -- manual launch: seed a run + switch into the execute view.
	const launchMut = useMutation({
		...orpc.playbookRuns.launchManual.mutationOptions(),
		onSuccess: (data) => {
			router.push(
				`/${organizationSlug}/playbooks/${playbookId}/read?runId=${data.playbookRunId}`,
			);
		},
	});

	const runQuery = useQuery({
		...orpc.playbookRuns.get.queryOptions({ input: { runId: runId ?? "" } }),
		enabled: !!runId,
		// Refetch while the run is in flight so the countdown + status stay live.
		refetchInterval: runId ? 15_000 : false,
	});

	const cancelMut = useMutation({
		...orpc.playbookRuns.cancel.mutationOptions(),
		onSuccess: () => {
			if (runId) {
				void queryClient.invalidateQueries({
					queryKey: orpc.playbookRuns.get.queryKey({ input: { runId } }),
				});
			}
		},
	});

	if (getQuery.isLoading) {
		return <ReadSkeleton />;
	}
	if (getQuery.isError || !getQuery.data) {
		return (
			<Alert variant="error">
				<AlertDescription>
					Couldn't load playbook: {getQuery.error?.message ?? "unknown error"}
				</AlertDescription>
			</Alert>
		);
	}

	const { playbook, latestPublished, publishedSteps } = getQuery.data;

	return (
		<article className="mx-auto max-w-3xl gap-4 flex flex-col">
			<header className="rounded-lg border border-border bg-background p-4 gap-2 flex flex-col">
				<div className="flex items-center justify-between gap-3 flex-wrap">
					<div className="min-w-0">
						<div className="flex items-center gap-2 flex-wrap">
							<Link
								href={`/${organizationSlug}/playbooks`}
								className="text-xs text-foreground/60 hover:text-foreground"
							>
								Playbooks
							</Link>
							<span className="text-foreground/30">/</span>
							<h1 className="font-medium text-base">{playbook.name}</h1>
						</div>
						{playbook.description && (
							<p className="text-sm text-foreground/70 mt-1 whitespace-pre-wrap">
								{playbook.description}
							</p>
						)}
						<div className="mt-2 flex items-center gap-2 flex-wrap">
							{latestPublished ? (
								<Badge status="success">Published v{latestPublished.versionNumber}</Badge>
							) : (
								<Badge status="warning">No published version</Badge>
							)}
							<Badge status={playbook.isActive ? "success" : "info"}>
								{playbook.isActive ? "Active" : "Disabled"}
							</Badge>
							{latestPublished && (
								<span className="text-[11px] text-foreground/50">
									Triggers on{" "}
									<code className="px-1 py-0.5 bg-muted rounded text-[10px]">
										{latestPublished.triggerType === "manual"
											? "manual launch"
											: (latestPublished.triggerEvent ?? "event")}
									</code>
								</span>
							)}
						</div>
					</div>
					<div className="shrink-0 flex items-center gap-2">
						{latestPublished && !runId && (
							<Button
								variant="primary"
								size="sm"
								onClick={() => launchMut.mutate({ playbookId })}
								disabled={launchMut.isPending}
							>
								<Play className="size-3.5 mr-1" />
								{launchMut.isPending ? "Launching…" : "Run playbook"}
							</Button>
						)}
						{isAdminOrOwner && (
							<Link
								href={`/${organizationSlug}/playbooks/${playbookId}/builder`}
							>
								<Button variant="ghost" size="sm">
									<Pencil className="size-3.5 mr-1" />
									Open in Builder
								</Button>
							</Link>
						)}
					</div>
				</div>
			</header>

			{runId && runQuery.data && (
				<div className="rounded-lg border border-border bg-muted/20 p-4 flex items-center justify-between gap-3 flex-wrap">
					<div className="flex items-center gap-2 flex-wrap">
						<span className="text-[10px] uppercase tracking-wide text-foreground/50">
							Run
						</span>
						<Badge status={runStatusTone(runQuery.data.status)}>
							{runQuery.data.status}
						</Badge>
						{runQuery.data.status === "waiting" && runQuery.data.nextWakeAt && (
							<span className="text-[11px] text-foreground/60 flex items-center gap-1">
								<Clock className="size-3" aria-hidden="true" />
								next wake {formatWake(runQuery.data.nextWakeAt)}
							</span>
						)}
					</div>
					{["pending", "active", "waiting"].includes(runQuery.data.status) && (
						<Button
							variant="ghost"
							size="sm"
							onClick={() => cancelMut.mutate({ runId })}
							disabled={cancelMut.isPending}
						>
							{cancelMut.isPending ? "Cancelling…" : "Cancel run"}
						</Button>
					)}
				</div>
			)}

			{!latestPublished ? (
				<div className="rounded-lg border border-border bg-background p-6 text-sm text-foreground/60 text-center">
					This playbook hasn't been published yet.{" "}
					{isAdminOrOwner ? "Open the builder to draft + publish a version." : "An admin needs to publish a version first."}
				</div>
			) : publishedSteps.length === 0 ? (
				<div className="rounded-lg border border-border bg-background p-6 text-sm text-foreground/60 text-center">
					Published version has no steps. (This shouldn't normally happen --
					publish refuses on empty versions.)
				</div>
			) : (
				<ol className="rounded-lg border border-border bg-background overflow-hidden">
					{publishedSteps.map((s, idx) => (
						<TimelineStep
							key={s.id}
							step={s}
							index={idx}
							isLast={idx === publishedSteps.length - 1}
						/>
					))}
				</ol>
			)}
		</article>
	);
}

interface TimelineStepData {
	id: string;
	position: number;
	type: string;
	config: unknown;
	branchLabel: string | null;
	parentStepId: string | null;
	provenance: "ai_generated" | "manually_edited";
}

function TimelineStep({
	step,
	index,
	isLast,
}: {
	step: TimelineStepData;
	index: number;
	isLast: boolean;
}) {
	const Icon = STEP_TYPE_ICONS[step.type] ?? Clock;
	return (
		<li className="px-4 py-4 flex items-start gap-3 relative">
			{/* Connector line down to the next step (timeline visual). */}
			{!isLast && (
				<div className="absolute left-[27px] top-[44px] bottom-0 w-px bg-border" />
			)}
			<div className="size-8 rounded-full bg-muted/50 flex items-center justify-center text-foreground/60 shrink-0 relative z-10">
				<Icon className="size-3.5" />
			</div>
			<div className="flex-1 min-w-0 pb-2">
				<div className="flex items-baseline gap-2 flex-wrap">
					<span className="text-[10px] uppercase tracking-wide text-foreground/50 tabular-nums">
						Step {String(index + 1).padStart(2, "0")}
					</span>
					<span className="font-medium text-sm">
						{STEP_TYPE_LABELS[step.type] ?? step.type}
					</span>
					{step.provenance === "ai_generated" && (
						<Badge status="info" className="!px-2 !py-0.5 !text-[10px] !normal-case">
							AI
						</Badge>
					)}
				</div>
				<pre className="text-[11px] text-foreground/60 mt-1 font-mono whitespace-pre-wrap break-all">
					{JSON.stringify(step.config, null, 2)}
				</pre>
			</div>
		</li>
	);
}

function ReadSkeleton() {
	return (
		<div className="mx-auto max-w-3xl gap-3 flex flex-col">
			<Skeleton className="h-24 w-full" />
			<Skeleton className="h-40 w-full" />
		</div>
	);
}

function runStatusTone(status: string): "success" | "warning" | "info" | "error" {
	switch (status) {
		case "completed":
			return "success";
		case "failed":
			return "error";
		case "cancelled":
			return "info";
		default:
			return "warning"; // pending / active / waiting
	}
}

/** Relative future time for the next-wake countdown ("in 4h", "in 3d"). */
function formatWake(value: Date | string, now: Date = new Date()): string {
	const then = value instanceof Date ? value : new Date(value);
	const diffMs = then.getTime() - now.getTime();
	if (diffMs <= 0) return "imminently";
	const mins = Math.round(diffMs / 60_000);
	if (mins < 60) return `in ${mins}m`;
	const hours = Math.round(mins / 60);
	if (hours < 24) return `in ${hours}h`;
	return `in ${Math.round(hours / 24)}d`;
}
