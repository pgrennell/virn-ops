"use client";

// Phase 18a -- Playbook Builder view. Vertical step list + header with
// Publish/Discard/Active toggle. Per-step edit lives in a Dialog with a
// type-aware JSON config form (v1 keeps the form minimal -- type-specific
// config UIs land in a polish pass).
//
// Resume-or-fork: when the playbook has no current draft (just-published
// state), the "Edit" button calls `playbooks.editPublished` to fork a new
// draft, then refetches. Idempotent.

import { orpc } from "@shared/lib/orpc-query-utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@virn/ui";
import { Alert, AlertDescription } from "@virn/ui/components/alert";
import { Badge } from "@virn/ui/components/badge";
import { Button } from "@virn/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@virn/ui/components/dialog";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@virn/ui/components/select";
import { Skeleton } from "@virn/ui/components/skeleton";
import { Switch } from "@virn/ui/components/switch";
import { Textarea } from "@virn/ui/components/textarea";
import {
	Clock,
	GitBranch,
	Pencil,
	Plus,
	Save,
	Send,
	Trash2,
	UploadCloud,
	Zap,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

const STEP_TYPES = [
	"wait_for_duration",
	"wait_for_event",
	"launch_workflow",
	"send_notification",
	"branch_on_data_set",
	"write_to_data_set",
] as const;
type StepType = (typeof STEP_TYPES)[number];

const STEP_TYPE_LABELS: Record<StepType, string> = {
	wait_for_duration: "Wait (duration)",
	wait_for_event: "Wait (event)",
	launch_workflow: "Launch workflow",
	send_notification: "Send notification",
	branch_on_data_set: "Branch on data set",
	write_to_data_set: "Write to data set",
};

const STEP_TYPE_ICONS: Record<StepType, typeof Clock> = {
	wait_for_duration: Clock,
	wait_for_event: Clock,
	launch_workflow: Zap,
	send_notification: Send,
	branch_on_data_set: GitBranch,
	write_to_data_set: Save,
};

interface PlaybookBuilderViewProps {
	playbookId: string;
	organizationSlug: string;
	isAdminOrOwner: boolean;
}

export function PlaybookBuilderView({
	playbookId,
	organizationSlug,
	isAdminOrOwner,
}: PlaybookBuilderViewProps) {
	const queryClient = useQueryClient();
	const router = useRouter();

	const getQuery = useQuery(
		orpc.playbooks.get.queryOptions({ input: { playbookId } }),
	);

	const invalidate = () => {
		void queryClient.invalidateQueries({
			queryKey: orpc.playbooks.get.queryKey({ input: { playbookId } }),
		});
		void queryClient.invalidateQueries({ queryKey: orpc.playbooks.list.key() });
	};

	const editPublishedMut = useMutation({
		...orpc.playbooks.editPublished.mutationOptions(),
		onSuccess: invalidate,
	});
	const publishMut = useMutation({
		...orpc.playbooks.publishVersion.mutationOptions(),
		onSuccess: invalidate,
	});
	const discardMut = useMutation({
		...orpc.playbooks.discardDraft.mutationOptions(),
		onSuccess: invalidate,
	});
	const setActiveMut = useMutation({
		...orpc.playbooks.setActive.mutationOptions(),
		onSuccess: invalidate,
	});
	const deleteStepMut = useMutation({
		...orpc.playbooks.deleteStep.mutationOptions(),
		onSuccess: invalidate,
	});

	const [editingStep, setEditingStep] = useState<null | "new" | string>(null);

	if (getQuery.isLoading) {
		return <BuilderSkeleton />;
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

	const { playbook, currentDraft, draftSteps, latestPublished } = getQuery.data;
	const hasDraft = currentDraft !== null;
	const hasPublished = latestPublished !== null;
	const stepsToRender = hasDraft ? draftSteps : (getQuery.data.publishedSteps ?? []);

	return (
		<div className="rounded-lg border border-border bg-background overflow-hidden flex flex-col h-full min-h-0">
			<header className="px-4 py-3 border-b border-border flex items-start justify-between gap-3">
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2 flex-wrap">
						<Link
							href={`/${organizationSlug}/playbooks`}
							className="text-xs text-foreground/60 hover:text-foreground"
						>
							Playbooks
						</Link>
						<span className="text-foreground/30">/</span>
						<h1 className="font-medium text-sm">{playbook.name}</h1>
					</div>
					<div className="mt-1 flex items-center gap-2 flex-wrap">
						{currentDraft ? (
							<Badge status="warning">Draft v{currentDraft.versionNumber}</Badge>
						) : latestPublished ? (
							<Badge status="success">Published v{latestPublished.versionNumber}</Badge>
						) : (
							<Badge status="info">No version yet</Badge>
						)}
						<Badge status={playbook.isActive ? "success" : "info"}>
							{playbook.isActive ? "Active" : "Disabled"}
						</Badge>
					</div>
				</div>
				<div className="shrink-0 flex items-center gap-2">
					{isAdminOrOwner && (
						<label className="text-xs text-foreground/70 flex items-center gap-2 cursor-pointer select-none">
							<Switch
								checked={playbook.isActive}
								onCheckedChange={(next) =>
									setActiveMut.mutate({ playbookId, isActive: next })
								}
								disabled={setActiveMut.isPending}
								aria-label="Enable playbook"
							/>
							<span className="uppercase tracking-wide font-medium">
								{playbook.isActive ? "Enabled" : "Disabled"}
							</span>
						</label>
					)}
					{hasDraft && isAdminOrOwner && (
						<>
							<Button
								variant="ghost"
								size="sm"
								onClick={() => discardMut.mutate({ playbookId })}
								disabled={discardMut.isPending}
							>
								<Trash2 className="size-3.5 mr-1" />
								{discardMut.isPending ? "Discarding…" : "Discard draft"}
							</Button>
							<Button
								variant="primary"
								size="sm"
								onClick={() =>
									publishMut.mutate({ versionId: currentDraft.id })
								}
								disabled={publishMut.isPending || draftSteps.length === 0}
							>
								<UploadCloud className="size-3.5 mr-1" />
								{publishMut.isPending ? "Publishing…" : "Publish"}
							</Button>
						</>
					)}
					{!hasDraft && hasPublished && isAdminOrOwner && (
						<Button
							variant="primary"
							size="sm"
							onClick={() => editPublishedMut.mutate({ playbookId })}
							disabled={editPublishedMut.isPending}
						>
							<Pencil className="size-3.5 mr-1" />
							{editPublishedMut.isPending ? "Forking…" : "Edit"}
						</Button>
					)}
				</div>
			</header>

			{(publishMut.isError || discardMut.isError || editPublishedMut.isError) && (
				<div className="px-4 py-2">
					<Alert variant="error">
						<AlertDescription className="text-xs">
							{(publishMut.error instanceof Error && publishMut.error.message) ||
								(discardMut.error instanceof Error && discardMut.error.message) ||
								(editPublishedMut.error instanceof Error &&
									editPublishedMut.error.message) ||
								"Action failed."}
						</AlertDescription>
					</Alert>
				</div>
			)}

			<div className="flex-1 min-h-0 overflow-y-auto">
				{stepsToRender.length === 0 ? (
					<div className="px-5 py-16 text-center">
						<div className="text-sm text-foreground/60 mb-3">
							{hasDraft
								? "No steps yet. Add the first step to give this playbook a body."
								: hasPublished
									? "This version is published and read-only. Click Edit to fork a new draft."
									: "No version yet."}
						</div>
						{hasDraft && isAdminOrOwner && (
							<Button
								variant="primary"
								size="sm"
								onClick={() => setEditingStep("new")}
							>
								<Plus className="size-3.5 mr-1" />
								Add step
							</Button>
						)}
					</div>
				) : (
					<ol className="divide-y divide-border">
						{stepsToRender.map((s, idx) => (
							<StepRow
								key={s.id}
								step={s}
								index={idx}
								editable={hasDraft && isAdminOrOwner}
								onEdit={() => setEditingStep(s.id)}
								onDelete={() => {
									if (confirm(`Delete step ${idx + 1}?`)) {
										deleteStepMut.mutate({ stepId: s.id });
									}
								}}
							/>
						))}
						{hasDraft && isAdminOrOwner && (
							<li className="px-4 py-3">
								<Button
									variant="ghost"
									size="sm"
									onClick={() => setEditingStep("new")}
								>
									<Plus className="size-3.5 mr-1" />
									Add step
								</Button>
							</li>
						)}
					</ol>
				)}
			</div>

			{editingStep && currentDraft && (
				<StepEditorDialog
					playbookVersionId={currentDraft.id}
					existingStep={
						editingStep === "new"
							? null
							: (draftSteps.find((s) => s.id === editingStep) ?? null)
					}
					nextPosition={draftSteps.length}
					onClose={() => setEditingStep(null)}
					onSaved={() => {
						setEditingStep(null);
						invalidate();
					}}
				/>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Step row
// ---------------------------------------------------------------------------

interface StepRowData {
	id: string;
	position: number;
	type: StepType;
	config: unknown;
	branchLabel: string | null;
	parentStepId: string | null;
	provenance: "ai_generated" | "manually_edited";
}

function StepRow({
	step,
	index,
	editable,
	onEdit,
	onDelete,
}: {
	step: StepRowData;
	index: number;
	editable: boolean;
	onEdit: () => void;
	onDelete: () => void;
}) {
	const Icon = STEP_TYPE_ICONS[step.type] ?? Clock;
	return (
		<li className="px-4 py-3 flex items-start gap-3">
			<div className="size-7 rounded-md bg-muted/50 flex items-center justify-center text-foreground/60 shrink-0">
				<Icon className="size-3.5" />
			</div>
			<div className="flex-1 min-w-0">
				<div className="flex items-baseline gap-2 flex-wrap">
					<span className="text-[10px] uppercase tracking-wide text-foreground/50 tabular-nums">
						{String(index + 1).padStart(2, "0")}
					</span>
					<span className="font-medium text-sm">{STEP_TYPE_LABELS[step.type]}</span>
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
			{editable && (
				<div className="shrink-0 flex items-center gap-1">
					<Button variant="ghost" size="sm" onClick={onEdit}>
						<Pencil className="size-3.5" />
					</Button>
					<Button variant="ghost" size="sm" onClick={onDelete}>
						<Trash2 className="size-3.5" />
					</Button>
				</div>
			)}
		</li>
	);
}

// ---------------------------------------------------------------------------
// Step editor dialog (create + edit)
// ---------------------------------------------------------------------------

function StepEditorDialog({
	playbookVersionId,
	existingStep,
	nextPosition,
	onClose,
	onSaved,
}: {
	playbookVersionId: string;
	existingStep: StepRowData | null;
	nextPosition: number;
	onClose: () => void;
	onSaved: () => void;
}) {
	const [type, setType] = useState<StepType>(existingStep?.type ?? "wait_for_duration");
	const [configText, setConfigText] = useState(() =>
		JSON.stringify(existingStep?.config ?? defaultConfigFor(type), null, 2),
	);
	const [parseError, setParseError] = useState<string | null>(null);

	const createMut = useMutation({
		...orpc.playbooks.createStep.mutationOptions(),
		onSuccess: onSaved,
	});
	const updateMut = useMutation({
		...orpc.playbooks.updateStep.mutationOptions(),
		onSuccess: onSaved,
	});

	const pending = createMut.isPending || updateMut.isPending;

	const onTypeChange = (next: StepType) => {
		setType(next);
		// Pre-fill the textarea with the new type's default config when the user
		// hasn't manually edited yet -- detect by comparing to the OLD type's default.
		try {
			const current = JSON.parse(configText);
			const oldDefault = defaultConfigFor(type);
			if (JSON.stringify(current) === JSON.stringify(oldDefault)) {
				setConfigText(JSON.stringify(defaultConfigFor(next), null, 2));
			}
		} catch {
			// Unparseable -- leave as-is.
		}
	};

	const onSave = () => {
		setParseError(null);
		let config: Record<string, unknown>;
		try {
			config = JSON.parse(configText);
			if (typeof config !== "object" || config === null || Array.isArray(config)) {
				setParseError("Config must be a JSON object.");
				return;
			}
		} catch (err) {
			setParseError(err instanceof Error ? err.message : "Invalid JSON.");
			return;
		}

		if (existingStep) {
			updateMut.mutate({
				stepId: existingStep.id,
				type,
				config,
			});
		} else {
			createMut.mutate({
				playbookVersionId,
				position: nextPosition,
				type,
				config,
			});
		}
	};

	return (
		<Dialog open onOpenChange={(o) => !o && onClose()}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>
						{existingStep ? "Edit step" : "Add step"}
					</DialogTitle>
				</DialogHeader>
				<div className="gap-3 flex flex-col">
					<div>
						<label className="text-[10px] uppercase tracking-wide text-foreground/50">
							Type
						</label>
						<Select value={type} onValueChange={(v) => onTypeChange(v as StepType)}>
							<SelectTrigger className="mt-1">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{STEP_TYPES.map((t) => (
									<SelectItem key={t} value={t}>
										{STEP_TYPE_LABELS[t]}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					<div>
						<label className="text-[10px] uppercase tracking-wide text-foreground/50">
							Config (JSON)
						</label>
						<Textarea
							value={configText}
							onChange={(e) => setConfigText(e.target.value)}
							rows={8}
							disabled={pending}
							className={cn("mt-1 font-mono text-xs", parseError && "border-destructive")}
						/>
					</div>
					{parseError && (
						<Alert variant="error">
							<AlertDescription className="text-xs">{parseError}</AlertDescription>
						</Alert>
					)}
					{(createMut.isError || updateMut.isError) && (
						<Alert variant="error">
							<AlertDescription className="text-xs">
								{(createMut.error instanceof Error && createMut.error.message) ||
									(updateMut.error instanceof Error && updateMut.error.message) ||
									"Couldn't save step."}
							</AlertDescription>
						</Alert>
					)}
				</div>
				<DialogFooter>
					<Button variant="ghost" size="sm" onClick={onClose} disabled={pending}>
						Cancel
					</Button>
					<Button variant="primary" size="sm" onClick={onSave} disabled={pending}>
						{pending ? "Saving…" : "Save"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function defaultConfigFor(type: StepType): Record<string, unknown> {
	switch (type) {
		case "wait_for_duration":
			return { amount: 1, unit: "days" };
		case "wait_for_event":
			return { eventName: "", timeoutDays: 30, onTimeout: "continue" };
		case "launch_workflow":
			return { workflowSlug: "" };
		case "send_notification":
			return { type: "ACKNOWLEDGMENT_DUE" };
		case "branch_on_data_set":
			return { dataSetId: "" };
		case "write_to_data_set":
			return { dataSetId: "", values: {} };
	}
}

function BuilderSkeleton() {
	return (
		<div className="p-4 gap-3 flex flex-col">
			<Skeleton className="h-12 w-full" />
			<Skeleton className="h-20 w-full" />
			<Skeleton className="h-20 w-full" />
			<Skeleton className="h-20 w-full" />
		</div>
	);
}
