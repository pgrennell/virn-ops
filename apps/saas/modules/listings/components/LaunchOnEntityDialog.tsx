"use client";

// Phase 10 / v1.5c R6 follow-up -- "Launch a workflow on this entity" dialog.
//
// Two-stage flow inside a single dialog:
//
//   Stage 1 (no workflow chosen) -- a list of workflows applicable to this
//   entity. Powered by workflows.listForEntity which already applies the
//   PRD §6.2 set-intersection filter ("workflow's entitySetIds is empty OR
//   intersects the entity's set memberships"). We further narrow to
//   executable types (procedure / form) since policy/document workflows
//   aren't runnable.
//
//   Stage 2 (workflow chosen) -- the existing LauncherForm, opened with the
//   chosen workflow + the entity context. On successful launch, runs.launch
//   stamps (entityType, entityId) onto the new run and ListingDetailView's
//   Active Run card surfaces it on the next render.
//
// Why a Dialog (vs. the LauncherPanel slide-in used on /library): the
// listing detail page doesn't have the flex-shell layout the Panel slides
// into. A modal sits cleanly on top of the article content without
// restructuring the page; the LauncherForm itself is container-agnostic
// (its file comment makes that promise explicit).

import { Alert, AlertDescription } from "@virn/ui/components/alert";
import { Button } from "@virn/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@virn/ui/components/dialog";
import { Spinner } from "@virn/ui/components/spinner";
import { cn } from "@virn/ui";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ChevronRight, Play, Sparkles } from "lucide-react";
import { useState } from "react";

import { LauncherForm } from "@library/components/LauncherForm";
import { orpc } from "@shared/lib/orpc-query-utils";

interface LaunchOnEntityDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	entityType: "listing";
	entityId: string;
	entityLabel: string;
	organizationSlug: string;
	agentStepsEnabled: boolean;
}

type ChosenWorkflow = {
	id: string;
	title: string;
	latestPublishedVersionId: string;
};

export function LaunchOnEntityDialog({
	open,
	onOpenChange,
	entityType,
	entityId,
	entityLabel,
	organizationSlug,
	agentStepsEnabled,
}: LaunchOnEntityDialogProps) {
	const [chosen, setChosen] = useState<ChosenWorkflow | null>(null);

	const reset = () => {
		setChosen(null);
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) reset();
				onOpenChange(next);
			}}
		>
			<DialogContent className="max-w-2xl">
				{chosen === null ? (
					<WorkflowPicker
						entityType={entityType}
						entityId={entityId}
						entityLabel={entityLabel}
						onPick={setChosen}
						onCancel={() => onOpenChange(false)}
					/>
				) : (
					<ChosenWorkflowLauncher
						workflow={chosen}
						entityType={entityType}
						entityId={entityId}
						organizationSlug={organizationSlug}
						agentStepsEnabled={agentStepsEnabled}
						onBack={() => setChosen(null)}
					/>
				)}
			</DialogContent>
		</Dialog>
	);
}

// ---------------------------------------------------------------------------
// Stage 1 -- pick a workflow
// ---------------------------------------------------------------------------

function WorkflowPicker({
	entityType,
	entityId,
	entityLabel,
	onPick,
	onCancel,
}: {
	entityType: "listing";
	entityId: string;
	entityLabel: string;
	onPick: (chosen: ChosenWorkflow) => void;
	onCancel: () => void;
}) {
	const query = useQuery(
		orpc.workflows.listForEntity.queryOptions({
			input: { entityType, entityId },
		}),
	);

	// Narrow to executable types (procedure / form). policy/document workflows
	// don't have a run engine surface; surfacing them in the launcher would be
	// a UX bug (the click would no-op or surface a confusing error).
	const runnable = (query.data ?? []).filter(
		(w) => w.type === "procedure" || w.type === "form",
	);

	return (
		<>
			<DialogHeader>
				<DialogTitle className="flex items-center gap-2">
					<Play className="size-4 text-emerald-600 dark:text-emerald-400" />
					Launch on {entityLabel}
				</DialogTitle>
				<DialogDescription>
					Pick a workflow to run on this listing. The list is filtered to
					workflows whose scope applies.
				</DialogDescription>
			</DialogHeader>

			{query.isLoading && (
				<div className="flex items-center justify-center gap-2 py-12 text-sm text-foreground/60">
					<Spinner className="size-4" /> Loading workflows…
				</div>
			)}

			{query.isError && (
				<Alert variant="error" className="my-3">
					<AlertDescription>
						{query.error instanceof Error
							? query.error.message
							: "Couldn't load workflows for this listing."}
					</AlertDescription>
				</Alert>
			)}

			{!query.isLoading && !query.isError && runnable.length === 0 && (
				<div className="px-3 py-10 text-center flex flex-col items-center gap-2 text-sm text-foreground/60">
					<Sparkles className="size-6 text-foreground/30" />
					<p>No runnable workflows apply to this listing.</p>
					<p className="text-xs">
						Workflows are filtered by their entity-set scope. Publish an
						unscoped workflow, or add this listing to a matching entity set.
					</p>
				</div>
			)}

			{runnable.length > 0 && (
				<ul className="flex flex-col gap-1 my-2 max-h-96 overflow-y-auto">
					{runnable.map((w) => {
						const disabled =
							!w.isActive || w.latestPublishedVersionId === null;
						return (
							<li key={w.id}>
								<button
									type="button"
									disabled={disabled}
									onClick={() => {
										if (disabled || w.latestPublishedVersionId === null) return;
										onPick({
											id: w.id,
											title: w.title,
											latestPublishedVersionId: w.latestPublishedVersionId,
										});
									}}
									className={cn(
										"w-full flex items-center gap-3 px-3 py-2.5 rounded-md border border-transparent text-left transition-colors",
										disabled
											? "opacity-50 cursor-not-allowed"
											: "hover:border-border hover:bg-muted/40",
									)}
									title={
										!w.isActive
											? "Workflow is disabled."
											: w.latestPublishedVersionId === null
												? "Workflow has no published version yet."
												: undefined
									}
								>
									<TypeChip type={w.type} />
									<div className="flex-1 min-w-0 flex flex-col gap-0.5">
										<span className="text-sm font-medium truncate">{w.title}</span>
										{w.description && (
											<span className="text-xs text-foreground/60 truncate">
												{w.description}
											</span>
										)}
									</div>
									{w.latestPublishedVersionNumber !== null && (
										<span className="text-[10px] font-mono text-foreground/50 shrink-0">
											v{w.latestPublishedVersionNumber}
										</span>
									)}
									<ChevronRight className="size-4 text-foreground/30 shrink-0" />
								</button>
							</li>
						);
					})}
				</ul>
			)}

			<DialogFooter>
				<Button variant="ghost" onClick={onCancel}>
					Cancel
				</Button>
			</DialogFooter>
		</>
	);
}

// ---------------------------------------------------------------------------
// Stage 2 -- launch the chosen workflow with entity context
// ---------------------------------------------------------------------------

function ChosenWorkflowLauncher({
	workflow,
	entityType,
	entityId,
	organizationSlug,
	agentStepsEnabled,
	onBack,
}: {
	workflow: ChosenWorkflow;
	entityType: "listing";
	entityId: string;
	organizationSlug: string;
	agentStepsEnabled: boolean;
	onBack: () => void;
}) {
	return (
		<>
			<DialogHeader>
				<DialogTitle className="flex items-center gap-2">
					<button
						type="button"
						onClick={onBack}
						className="inline-flex items-center justify-center size-6 rounded text-foreground/50 hover:text-foreground hover:bg-muted transition-colors"
						aria-label="Back to workflow picker"
					>
						<ArrowLeft className="size-3.5" />
					</button>
					Launch {workflow.title}
				</DialogTitle>
				<DialogDescription>
					Fill kickoff fields and assign roles. The run will be stamped with
					this listing as its entity context so it appears in the Active Run
					card.
				</DialogDescription>
			</DialogHeader>

			<div className="mt-2 max-h-[min(70vh,42rem)] overflow-y-auto">
				<LauncherForm
					workflow={workflow}
					organizationSlug={organizationSlug}
					agentStepsEnabled={agentStepsEnabled}
					entityContext={{ entityType, entityId }}
					// onLaunched: LauncherForm calls window.location.href on success,
					// so the dialog will be torn down by the hard nav. No explicit
					// close needed -- the redirect IS the close.
				/>
			</div>
		</>
	);
}

// ---------------------------------------------------------------------------
// Small bits
// ---------------------------------------------------------------------------

function TypeChip({
	type,
}: {
	type: "procedure" | "document" | "policy" | "form";
}) {
	const label: Record<typeof type, string> = {
		procedure: "Procedure",
		document: "Document",
		policy: "Policy",
		form: "Form",
	};
	const colorClass: Record<typeof type, string> = {
		procedure: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-300",
		document: "bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-300",
		policy: "bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-300",
		form: "bg-blue-100 text-blue-900 dark:bg-blue-900/30 dark:text-blue-300",
	};
	return (
		<span
			className={cn(
				"shrink-0 px-1.5 py-0.5 text-[9px] uppercase tracking-wide font-medium rounded",
				colorClass[type],
			)}
		>
			{label[type]}
		</span>
	);
}
