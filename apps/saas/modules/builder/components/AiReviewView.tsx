"use client";

// Phase 12 follow-up (PRD §6.3 / §8.4) -- two-pane AI authoring review surface.
//
// Lands here after agents.authorWorkflow returns successfully (CreateWorkflowMenu
// redirects to /library/workflows/[id]/builder?aiAuthored=1). The builder page
// reads the flag and renders this view in place of BuilderView.
//
// Layout:
//   - Left pane (~40% on lg+): the originating prompt + optional source text
//     + a small chip showing model + author timestamp. Collapsible entity-
//     schema snapshot at the bottom for forensic value.
//   - Right pane (~60% on lg+): read-only rendering of the freshly authored
//     workflow's draft structure (kickoff fields, sections, steps + step
//     fields). Each step row carries two inline affordances:
//       * Edit: drops the review flag and lands in normal Builder with the
//         step focused.
//       * Regenerate: opens an inline refinement textarea + submit;
//         dispatches agents.regenerateStep with the prompt.
//   - Sticky footer with "Finish review" -- drops the ?aiAuthored=1 flag
//     and leaves the user in the normal Builder for continued editing
//     (or for clicking Publish).
//
// Out of scope for v1 (PRD G11 mentions both; deferred follow-ups):
//   - "Regenerate with addendum" (re-run the whole-workflow author with an
//     additional instruction). Per-step regenerate covers the most common
//     refinement need; the addendum path is its own slice with new
//     procedure shape.
//   - "Discard and start over" (delete the draft + re-open the AI dialog).
//     Same -- meaningful new infra (workflow delete during review) without
//     clear urgency.

import { Alert, AlertDescription } from "@virn/ui/components/alert";
import { Button } from "@virn/ui/components/button";
import { Spinner } from "@virn/ui/components/spinner";
import { Textarea } from "@virn/ui/components/textarea";
import { cn } from "@virn/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	ArrowLeft,
	BookOpen,
	Check,
	CheckCircle2,
	FileText,
	Pencil,
	Sparkles,
	X,
} from "lucide-react";
import { useState } from "react";

import { orpc } from "@shared/lib/orpc-query-utils";

interface AiReviewViewProps {
	workflowId: string;
	organizationSlug: string;
}

export function AiReviewView({ workflowId, organizationSlug }: AiReviewViewProps) {
	const workflowQuery = useQuery(
		orpc.workflows.get.queryOptions({ input: { workflowId } }),
	);

	if (workflowQuery.isLoading) {
		return <CenteredSpinner label="Loading workflow…" />;
	}
	if (workflowQuery.isError || !workflowQuery.data) {
		return (
			<EmptyState
				icon={<FileText className="size-8 text-foreground/40" />}
				title="Workflow not found"
				description="This workflow may have been archived or moved."
			/>
		);
	}

	const data = workflowQuery.data;
	const currentDraft = data.currentDraft;
	const aiAuthoring = data.aiAuthoring;

	// Two failure modes that drop us back to the normal builder:
	//   1. No draft exists. The author flow always produces a draft, but the
	//      user might land here on a stale link after a discard.
	//   2. No aiAuthoring provenance row. This means the user landed here on
	//      ?aiAuthored=1 for a workflow that wasn't actually AI-authored
	//      (a manually-created workflow whose URL was hand-edited).
	// Both surface a friendly "go to builder" affordance.
	if (!currentDraft) {
		return (
			<EmptyState
				icon={<FileText className="size-8 text-foreground/40" />}
				title="No draft to review"
				description="This workflow doesn't currently have a draft. The AI review surface only opens against a freshly authored draft."
				cta={
					<Button asChild variant="secondary" size="sm">
						<a href={`/${organizationSlug}/library/workflows/${workflowId}/builder`}>
							Open in Builder
						</a>
					</Button>
				}
			/>
		);
	}
	if (!aiAuthoring) {
		return (
			<EmptyState
				icon={<Sparkles className="size-8 text-foreground/40" />}
				title="Not an AI-authored workflow"
				description="This workflow wasn't created via AI authoring, so there's no originating prompt to review."
				cta={
					<Button asChild variant="secondary" size="sm">
						<a href={`/${organizationSlug}/library/workflows/${workflowId}/builder`}>
							Open in Builder
						</a>
					</Button>
				}
			/>
		);
	}

	return (
		<AiReviewInner
			workflowId={workflowId}
			organizationSlug={organizationSlug}
			workflowTitle={data.workflow.title}
			draftVersionId={currentDraft.id}
			promptId={aiAuthoring.promptId}
			model={aiAuthoring.model}
			authoredAt={aiAuthoring.createdAt}
		/>
	);
}

// ---------------------------------------------------------------------------
// Inner -- splits so the bundle + prompt queries only mount once we have a
// guaranteed draft + provenance row.
// ---------------------------------------------------------------------------

function AiReviewInner({
	workflowId,
	organizationSlug,
	workflowTitle,
	draftVersionId,
	promptId,
	model,
	authoredAt,
}: {
	workflowId: string;
	organizationSlug: string;
	workflowTitle: string;
	draftVersionId: string;
	promptId: string;
	model: string;
	authoredAt: Date | string;
}) {
	const promptQuery = useQuery(
		orpc.agents.getAuthoringPrompt.queryOptions({ input: { promptId } }),
	);
	const bundleQuery = useQuery(
		orpc.workflows.getVersionBundle.queryOptions({
			input: { versionId: draftVersionId },
		}),
	);

	const isLoading = promptQuery.isLoading || bundleQuery.isLoading;
	const error = promptQuery.error ?? bundleQuery.error;

	const builderUrl = `/${organizationSlug}/library/workflows/${workflowId}/builder`;

	return (
		<div className="h-full min-h-0 flex flex-col">
			<header className="px-4 py-2.5 border-b border-border bg-background flex items-center gap-3">
				<a
					href={`/${organizationSlug}/library`}
					className="inline-flex items-center gap-1 text-xs text-foreground/50 hover:text-foreground/70 transition-colors"
				>
					<ArrowLeft className="size-3" /> Library
				</a>
				<div className="flex-1 min-w-0">
					<h1 className="font-medium text-sm truncate">{workflowTitle}</h1>
					<div className="flex items-center gap-2 mt-0.5">
						<span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] uppercase tracking-wide font-medium rounded bg-violet-100 text-violet-900 dark:bg-violet-900/30 dark:text-violet-300">
							<Sparkles className="size-3" /> Reviewing AI draft
						</span>
						<ModelChip model={model} authoredAt={authoredAt} />
					</div>
				</div>
				<Button asChild variant="primary" size="sm">
					<a href={builderUrl}>
						<CheckCircle2 className="size-3.5 mr-1.5" />
						Finish review
					</a>
				</Button>
			</header>

			<div className="flex-1 min-h-0 overflow-y-auto">
				{isLoading && <CenteredSpinner label="Loading review…" />}
				{error && (
					<Alert variant="error" className="m-4">
						<AlertDescription className="text-xs">
							{error instanceof Error ? error.message : "Couldn't load the review."}
						</AlertDescription>
					</Alert>
				)}
				{!isLoading && !error && promptQuery.data && bundleQuery.data && (
					<div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
						<PromptPane data={promptQuery.data} />
						<StructurePane
							bundle={bundleQuery.data}
							workflowId={workflowId}
							organizationSlug={organizationSlug}
							draftVersionId={draftVersionId}
						/>
					</div>
				)}
			</div>
		</div>
	);
}

// ---------------------------------------------------------------------------
// Left pane: prompt + optional source text + entity schema snapshot
// ---------------------------------------------------------------------------

interface PromptData {
	prompt: string;
	sourceText: string | null;
	entitySchemaSnapshot: Record<string, unknown>;
}

function PromptPane({ data }: { data: PromptData }) {
	return (
		<aside className="flex flex-col gap-4 lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto">
			<section>
				<SectionHeader label="Prompt" />
				<pre className="mt-1.5 px-3 py-2 rounded-md border border-border bg-muted/30 text-xs whitespace-pre-wrap break-words max-h-72 overflow-y-auto">
					{data.prompt}
				</pre>
			</section>
			{data.sourceText && data.sourceText.length > 0 && (
				<section>
					<SectionHeader
						label="Source text"
						hint={`${data.sourceText.length.toLocaleString()} chars`}
					/>
					<pre className="mt-1.5 px-3 py-2 rounded-md border border-border bg-muted/30 text-xs whitespace-pre-wrap break-words max-h-72 overflow-y-auto">
						{data.sourceText}
					</pre>
				</section>
			)}
			<details className="text-sm">
				<summary className="cursor-pointer text-[11px] uppercase tracking-wider font-semibold text-foreground/50 hover:text-foreground select-none">
					Entity schema snapshot
				</summary>
				<pre className="mt-2 px-3 py-2 rounded-md border border-border bg-muted/30 text-[11px] font-mono whitespace-pre-wrap break-words max-h-64 overflow-y-auto">
					{JSON.stringify(data.entitySchemaSnapshot, null, 2)}
				</pre>
			</details>
		</aside>
	);
}

// ---------------------------------------------------------------------------
// Right pane: read-only structure rendering with per-step affordances
// ---------------------------------------------------------------------------

interface BundleStep {
	id: string;
	title: string;
	description: string | null;
	position: number;
	sectionId: string | null;
	isRequired: boolean;
	isStopTask: boolean;
	dueType: string;
	dueOffsetDays: number | null;
}

interface BundleSection {
	id: string;
	title: string;
	position: number;
}

interface BundleField {
	id: string;
	stepId: string | null;
	key: string;
	label: string;
	fieldType: string;
	isRequired: boolean;
	position: number;
}

interface BundleData {
	sections: BundleSection[];
	steps: BundleStep[];
	fields: BundleField[];
}

function StructurePane({
	bundle,
	workflowId,
	organizationSlug,
	draftVersionId,
}: {
	bundle: BundleData;
	workflowId: string;
	organizationSlug: string;
	draftVersionId: string;
}) {
	const sortedSections = [...bundle.sections].sort((a, b) => a.position - b.position);
	const stepsBySection = new Map<string | null, BundleStep[]>();
	for (const s of bundle.steps) {
		const key = s.sectionId ?? null;
		const arr = stepsBySection.get(key) ?? [];
		arr.push(s);
		stepsBySection.set(key, arr);
	}
	for (const arr of stepsBySection.values()) {
		arr.sort((a, b) => a.position - b.position);
	}
	const fieldsByStepId = new Map<string, BundleField[]>();
	for (const f of bundle.fields) {
		if (f.stepId === null) continue;
		const arr = fieldsByStepId.get(f.stepId) ?? [];
		arr.push(f);
		fieldsByStepId.set(f.stepId, arr);
	}
	for (const arr of fieldsByStepId.values()) {
		arr.sort((a, b) => a.position - b.position);
	}
	const kickoffFields = bundle.fields
		.filter((f) => f.stepId === null)
		.sort((a, b) => a.position - b.position);
	const ungroupedSteps = stepsBySection.get(null) ?? [];

	return (
		<section className="flex flex-col gap-6">
			{kickoffFields.length > 0 && (
				<div className="rounded-lg border border-border bg-muted/20 p-4">
					<h2 className="text-xs uppercase tracking-wider font-semibold text-foreground/60">
						Required at run start
					</h2>
					<ul className="mt-2 flex flex-col gap-1">
						{kickoffFields.map((f) => (
							<li
								key={f.id}
								className="text-sm text-foreground/80 flex items-center gap-2"
							>
								<span className="font-medium">{f.label}</span>
								<FieldTypeChip type={f.fieldType} />
								{f.isRequired && (
									<span className="text-[10px] uppercase tracking-wide text-destructive">
										required
									</span>
								)}
							</li>
						))}
					</ul>
				</div>
			)}

			{sortedSections.map((section) => {
				const steps = stepsBySection.get(section.id) ?? [];
				if (steps.length === 0) return null;
				return (
					<StepGroup
						key={section.id}
						title={section.title}
						steps={steps}
						fieldsByStepId={fieldsByStepId}
						workflowId={workflowId}
						organizationSlug={organizationSlug}
						draftVersionId={draftVersionId}
					/>
				);
			})}
			{ungroupedSteps.length > 0 && (
				<StepGroup
					title={sortedSections.length > 0 ? "Other steps" : "Steps"}
					steps={ungroupedSteps}
					fieldsByStepId={fieldsByStepId}
					workflowId={workflowId}
					organizationSlug={organizationSlug}
					draftVersionId={draftVersionId}
				/>
			)}
		</section>
	);
}

function StepGroup({
	title,
	steps,
	fieldsByStepId,
	workflowId,
	organizationSlug,
	draftVersionId,
}: {
	title: string;
	steps: BundleStep[];
	fieldsByStepId: ReadonlyMap<string, BundleField[]>;
	workflowId: string;
	organizationSlug: string;
	draftVersionId: string;
}) {
	return (
		<div className="flex flex-col gap-3">
			<h2 className="text-lg font-semibold border-b border-border pb-1">{title}</h2>
			<ol className="flex flex-col gap-3 list-none">
				{steps.map((step, idx) => (
					<StepRow
						key={step.id}
						step={step}
						index={idx}
						fields={fieldsByStepId.get(step.id) ?? []}
						workflowId={workflowId}
						organizationSlug={organizationSlug}
						draftVersionId={draftVersionId}
					/>
				))}
			</ol>
		</div>
	);
}

function StepRow({
	step,
	index,
	fields,
	workflowId,
	organizationSlug,
	draftVersionId,
}: {
	step: BundleStep;
	index: number;
	fields: BundleField[];
	workflowId: string;
	organizationSlug: string;
	draftVersionId: string;
}) {
	const [accepted, setAccepted] = useState(false);
	const [regenerateOpen, setRegenerateOpen] = useState(false);
	const [refinementPrompt, setRefinementPrompt] = useState("");
	const [regenerateError, setRegenerateError] = useState<string | null>(null);
	const queryClient = useQueryClient();

	const regenerateMutation = useMutation({
		...orpc.agents.regenerateStep.mutationOptions(),
		onSuccess: () => {
			// Refetch the bundle so the row re-renders with the new title +
			// description. The bundle query is keyed on versionId; the workflow
			// query carries the aiAuthoring chip + draft pointer.
			void queryClient.invalidateQueries({
				queryKey: orpc.workflows.get.queryKey({ input: { workflowId } }),
			});
			void queryClient.invalidateQueries({
				queryKey: orpc.workflows.getVersionBundle.queryKey({
					input: { versionId: draftVersionId },
				}),
			});
			setRegenerateOpen(false);
			setRefinementPrompt("");
		},
		onError: (err) => {
			setRegenerateError(
				err instanceof Error ? err.message : "Regenerate failed.",
			);
		},
	});

	const builderEditUrl = `/${organizationSlug}/library/workflows/${workflowId}/builder#step-${step.id}`;

	const handleRegenerate = () => {
		setRegenerateError(null);
		regenerateMutation.mutate({
			stepId: step.id,
			refinementPrompt: refinementPrompt.trim().length > 0 ? refinementPrompt.trim() : null,
		});
	};

	return (
		<li
			className={cn(
				"flex flex-col gap-2 px-3 py-3 rounded-md border transition-colors",
				accepted
					? "border-emerald-300/60 bg-emerald-50/40 dark:border-emerald-700/40 dark:bg-emerald-950/20"
					: "border-border bg-background",
			)}
		>
			<div className="flex gap-3 items-start">
				<span className="shrink-0 size-7 rounded-full bg-muted text-foreground/70 text-xs font-medium flex items-center justify-center mt-0.5">
					{index + 1}
				</span>
				<div className="flex-1 min-w-0 flex flex-col gap-1">
					<div className="flex items-center gap-2 flex-wrap">
						<h3 className="text-sm font-medium">{step.title}</h3>
						{!step.isRequired && (
							<span className="px-1.5 py-0.5 text-[9px] uppercase tracking-wide font-medium rounded bg-muted text-muted-foreground">
								Optional
							</span>
						)}
						{step.isStopTask && (
							<span className="px-1.5 py-0.5 text-[9px] uppercase tracking-wide font-medium rounded bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-300">
								Gate
							</span>
						)}
						{step.dueType !== "none" && (
							<DueRuleChip
								dueType={step.dueType}
								dueOffsetDays={step.dueOffsetDays}
							/>
						)}
						{accepted && (
							<span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] uppercase tracking-wide font-medium rounded bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-300">
								<Check className="size-2.5" /> Accepted
							</span>
						)}
					</div>
					{step.description && (
						<p className="text-xs text-foreground/70 whitespace-pre-wrap">
							{step.description}
						</p>
					)}
					{fields.length > 0 && (
						<ul className="mt-1 flex flex-col gap-1 pl-3 border-l-2 border-border">
							{fields.map((f) => (
								<li
									key={f.id}
									className="text-[11px] text-foreground/70 flex items-center gap-1.5"
								>
									<span className="font-medium">{f.label}</span>
									<FieldTypeChip type={f.fieldType} />
									{f.isRequired && (
										<span className="text-[9px] uppercase tracking-wide text-destructive">
											required
										</span>
									)}
								</li>
							))}
						</ul>
					)}
				</div>
				<div className="shrink-0 flex flex-col gap-1.5">
					<button
						type="button"
						onClick={() => setAccepted((a) => !a)}
						title={accepted ? "Un-accept" : "Mark as accepted"}
						className={cn(
							"inline-flex items-center gap-1 px-2 py-1 text-[10px] uppercase tracking-wide font-medium rounded border transition-colors",
							accepted
								? "border-emerald-300 bg-emerald-100 text-emerald-900 dark:border-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200"
								: "border-border hover:border-foreground/40 text-foreground/60",
						)}
					>
						<Check className="size-3" /> {accepted ? "Accepted" : "Accept"}
					</button>
					<a
						href={builderEditUrl}
						className="inline-flex items-center gap-1 px-2 py-1 text-[10px] uppercase tracking-wide font-medium rounded border border-border hover:border-foreground/40 text-foreground/60 hover:text-foreground transition-colors"
					>
						<Pencil className="size-3" /> Edit
					</a>
					<button
						type="button"
						onClick={() => setRegenerateOpen((o) => !o)}
						className={cn(
							"inline-flex items-center gap-1 px-2 py-1 text-[10px] uppercase tracking-wide font-medium rounded border transition-colors",
							regenerateOpen
								? "border-violet-400 bg-violet-100 text-violet-900 dark:border-violet-600 dark:bg-violet-900/30 dark:text-violet-300"
								: "border-border hover:border-foreground/40 text-foreground/60",
						)}
					>
						<Sparkles className="size-3" /> Regenerate
					</button>
				</div>
			</div>
			{regenerateOpen && (
				<div className="mt-1 flex flex-col gap-2 pl-10">
					<Textarea
						value={refinementPrompt}
						onChange={(e) => setRefinementPrompt(e.target.value)}
						placeholder="Optional refinement instructions (e.g. 'shorter', 'add a checklist for HVAC')."
						rows={2}
						disabled={regenerateMutation.isPending}
						className="text-xs"
						maxLength={2000}
					/>
					{regenerateError && (
						<Alert variant="error">
							<AlertDescription className="text-xs">{regenerateError}</AlertDescription>
						</Alert>
					)}
					<div className="flex items-center gap-2 justify-end">
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={() => {
								setRegenerateOpen(false);
								setRefinementPrompt("");
								setRegenerateError(null);
							}}
							disabled={regenerateMutation.isPending}
						>
							<X className="size-3.5 mr-1" /> Cancel
						</Button>
						<Button
							type="button"
							variant="primary"
							size="sm"
							onClick={handleRegenerate}
							loading={regenerateMutation.isPending}
						>
							<Sparkles className="size-3.5 mr-1" /> Regenerate
						</Button>
					</div>
				</div>
			)}
		</li>
	);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ModelChip({
	model,
	authoredAt,
}: {
	model: string;
	authoredAt: Date | string;
}) {
	const d = authoredAt instanceof Date ? authoredAt : new Date(authoredAt);
	const dateLabel = Number.isNaN(d.getTime())
		? null
		: d.toLocaleDateString(undefined, {
				year: "numeric",
				month: "short",
				day: "numeric",
			});
	return (
		<span className="text-[10px] uppercase tracking-wider font-medium text-foreground/50 inline-flex items-center gap-1">
			<span className="font-mono normal-case">{model}</span>
			{dateLabel && <span>· {dateLabel}</span>}
		</span>
	);
}

function SectionHeader({ label, hint }: { label: string; hint?: string }) {
	return (
		<div className="flex items-center justify-between">
			<span className="text-[10px] uppercase tracking-wider font-semibold text-foreground/60">
				{label}
			</span>
			{hint && (
				<span className="text-[10px] uppercase tracking-wide text-foreground/40">
					{hint}
				</span>
			)}
		</div>
	);
}

function FieldTypeChip({ type }: { type: string }) {
	return (
		<span className="px-1 py-0 text-[9px] uppercase tracking-wide font-medium rounded bg-foreground/5 text-foreground/60">
			{type}
		</span>
	);
}

function DueRuleChip({
	dueType,
	dueOffsetDays,
}: {
	dueType: string;
	dueOffsetDays: number | null;
}) {
	let text = "";
	if (dueType === "offset_from_start" && typeof dueOffsetDays === "number") {
		text = dueOffsetDays === 0 ? "due at start" : `due ${dueOffsetDays}d after start`;
	} else if (dueType === "offset_from_step") {
		text = `due ${dueOffsetDays ?? "?"}d after anchor step`;
	} else if (dueType === "from_date_field") {
		text = `due ${dueOffsetDays ?? "?"}d from date field`;
	} else {
		text = dueType;
	}
	return (
		<span className="px-1.5 py-0.5 text-[9px] uppercase tracking-wide font-medium rounded bg-blue-100 text-blue-900 dark:bg-blue-900/30 dark:text-blue-300">
			{text}
		</span>
	);
}

function EmptyState({
	icon,
	title,
	description,
	cta,
}: {
	icon: React.ReactNode;
	title: string;
	description: string;
	cta?: React.ReactNode;
}) {
	return (
		<div className="mx-auto max-w-md px-5 py-16 text-center flex flex-col items-center gap-3">
			<div>{icon}</div>
			<h1 className="text-lg font-semibold">{title}</h1>
			<p className="text-sm text-foreground/60">{description}</p>
			{cta && <div className="mt-2">{cta}</div>}
		</div>
	);
}

function CenteredSpinner({ label }: { label: string }) {
	return (
		<div className="flex items-center justify-center gap-3 py-24 text-foreground/60">
			<Spinner className="size-4" /> {label}
		</div>
	);
}
