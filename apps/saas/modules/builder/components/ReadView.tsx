"use client";

// Phase 10 / v1.5c (PRD §6.4) -- Read view of a published workflow rendered
// as an SOP/KB article. Static, read-only. The same workflow_version row
// the Author view edits is what renders here -- three-views unification
// per the 2026-05-26 pivot (D-021).
//
// What renders:
//   - Workflow header (title, version chip, AI chip if applicable, read badge)
//   - Description (workflow-level)
//   - Sections + steps as a numbered timeline
//     - Section title (h2)
//     - Step number + title
//     - Role, due-rule summary
//     - Description
//     - Fields (read-only: label, type, required flag, select options)
//   - Footer: Mark as read button / "Read on <date>" badge
//   - For admins: receipt count + a link to the full receipt list (Phase 15
//     will surface that list as a separate route)
//
// What does NOT render:
//   - "Start a run" button. Runs launch from listings / triggers / runs
//     index per PRD §6.4 -- the Read view is reference-only.
//   - The Workflow Assistant chat panel. That's an authoring surface;
//     reading doesn't need it.
//   - The kickoff field editor. Kickoff fields render in the Read view as
//     "Required at run start: <list>" -- the author sees them on launch,
//     not in the SOP.

import { Alert, AlertDescription } from "@virn/ui/components/alert";
import { Button } from "@virn/ui/components/button";
import { Spinner } from "@virn/ui/components/spinner";
import { cn } from "@virn/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, CheckCircle2, Eye, Pencil, Sparkles } from "lucide-react";

import { orpc } from "@shared/lib/orpc-query-utils";

import { WorkflowViewToggle } from "./WorkflowViewToggle";

interface ReadViewProps {
	workflowId: string;
	organizationSlug: string;
	/** Admin/owner sees the read-receipt count + an "Edit" affordance back
	 * to the Author view. */
	isAdminOrOwner: boolean;
}

export function ReadView({
	workflowId,
	organizationSlug,
	isAdminOrOwner,
}: ReadViewProps) {
	const workflowQuery = useQuery(
		orpc.workflows.get.queryOptions({ input: { workflowId } }),
	);

	if (workflowQuery.isLoading) {
		return <CenteredSpinner label="Loading workflow…" />;
	}
	if (workflowQuery.isError || !workflowQuery.data) {
		return (
			<EmptyState
				icon={<BookOpen className="size-8 text-foreground/40" />}
				title="Workflow not found"
				description="This workflow may have been archived or moved."
			/>
		);
	}

	const latestPublished = workflowQuery.data.latestPublished;

	if (!latestPublished) {
		return (
			<EmptyState
				icon={<Eye className="size-8 text-foreground/40" />}
				title="No published version yet"
				description="This workflow hasn't been published. Once an admin publishes a version it'll appear here as an SOP."
				cta={
					isAdminOrOwner ? (
						<a
							href={`/${organizationSlug}/library/workflows/${workflowId}/builder`}
							className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
						>
							<Pencil className="size-3.5" /> Open in Builder
						</a>
					) : null
				}
			/>
		);
	}

	return (
		<ReadInner
			workflow={{
				id: workflowQuery.data.workflow.id,
				title: workflowQuery.data.workflow.title,
				description: workflowQuery.data.workflow.description,
				type: workflowQuery.data.workflow.type,
				latestPublishedVersionNumber: latestPublished.versionNumber,
				aiAuthoring: workflowQuery.data.aiAuthoring,
			}}
			workflowVersionId={latestPublished.id}
			organizationSlug={organizationSlug}
			isAdminOrOwner={isAdminOrOwner}
		/>
	);
}

interface WorkflowReadHeader {
	id: string;
	title: string;
	description: string | null;
	type: "procedure" | "document" | "policy" | "form";
	latestPublishedVersionNumber: number | null;
	aiAuthoring: { promptId: string; model: string; createdAt: string | Date } | null;
}

function ReadInner({
	workflow,
	workflowVersionId,
	organizationSlug,
	isAdminOrOwner,
}: {
	workflow: WorkflowReadHeader;
	workflowVersionId: string;
	organizationSlug: string;
	isAdminOrOwner: boolean;
}) {
	const queryClient = useQueryClient();

	const bundleQuery = useQuery(
		orpc.workflows.getVersionBundle.queryOptions({
			input: { versionId: workflowVersionId },
		}),
	);
	const readStatusQuery = useQuery(
		orpc.workflows.getMyReadStatus.queryOptions({
			input: { workflowVersionId },
		}),
	);
	// Receipt list is admin-only. The query is gated client-side via `enabled`;
	// non-admin members would 403 if they tried.
	const receiptsQuery = useQuery({
		...orpc.workflows.listReadReceipts.queryOptions({
			input: { workflowVersionId },
		}),
		enabled: isAdminOrOwner,
	});

	const markAsRead = useMutation({
		...orpc.workflows.markAsRead.mutationOptions(),
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: orpc.workflows.getMyReadStatus.queryKey({
					input: { workflowVersionId },
				}),
			});
			if (isAdminOrOwner) {
				void queryClient.invalidateQueries({
					queryKey: orpc.workflows.listReadReceipts.queryKey({
						input: { workflowVersionId },
					}),
				});
			}
		},
	});

	if (bundleQuery.isLoading) {
		return <CenteredSpinner label="Loading SOP…" />;
	}
	if (bundleQuery.isError || !bundleQuery.data) {
		return (
			<EmptyState
				icon={<BookOpen className="size-8 text-foreground/40" />}
				title="Couldn't load this SOP"
				description={
					bundleQuery.error instanceof Error
						? bundleQuery.error.message
						: "Something went wrong loading the published version."
				}
			/>
		);
	}

	const bundle = bundleQuery.data;
	const hasRead = readStatusQuery.data?.hasRead ?? false;
	const readAt = readStatusQuery.data?.readAt ?? null;

	// Order sections by position, then group steps + fields under each.
	const stepsBySectionId = new Map<string | null, typeof bundle.steps>();
	for (const s of bundle.steps) {
		const key = s.sectionId ?? null;
		const arr = stepsBySectionId.get(key) ?? [];
		arr.push(s);
		stepsBySectionId.set(key, arr);
	}
	for (const arr of stepsBySectionId.values()) {
		arr.sort((a, b) => a.position - b.position);
	}
	const fieldsByStepId = new Map<string, typeof bundle.fields>();
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

	const sortedSections = [...bundle.sections].sort((a, b) => a.position - b.position);
	const ungroupedSteps = stepsBySectionId.get(null) ?? [];

	return (
		<article className="mx-auto max-w-3xl px-4 py-6 flex flex-col gap-6">
			<header className="flex flex-col gap-3">
				<div className="flex items-start justify-between gap-3">
					<div className="min-w-0 flex-1">
						<h1 className="text-2xl font-semibold">{workflow.title}</h1>
						<div className="mt-2 gap-2 flex flex-wrap items-center">
							<VersionChip
								versionNumber={workflow.latestPublishedVersionNumber}
								type={workflow.type}
							/>
							{workflow.aiAuthoring && (
								<span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] uppercase tracking-wide font-medium rounded bg-violet-100 text-violet-900 dark:bg-violet-900/30 dark:text-violet-300">
									<Sparkles className="size-3" /> AI-authored
								</span>
							)}
							{hasRead && readAt && (
								<span
									className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] uppercase tracking-wide font-medium rounded bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-300"
									title={`Marked read at ${new Date(readAt).toLocaleString()}`}
								>
									<CheckCircle2 className="size-3" /> Read
								</span>
							)}
							{isAdminOrOwner && receiptsQuery.data && (
								<span className="text-[10px] uppercase tracking-wide text-foreground/50">
									{receiptsQuery.data.length}{" "}
									{receiptsQuery.data.length === 1 ? "reader" : "readers"}
								</span>
							)}
						</div>
					</div>
					{isAdminOrOwner && (
						<div className="shrink-0">
							<WorkflowViewToggle
								organizationSlug={organizationSlug}
								workflowId={workflow.id}
								active="read"
							/>
						</div>
					)}
				</div>
				{workflow.description && (
					<p className="text-sm text-foreground/70 whitespace-pre-wrap">
						{workflow.description}
					</p>
				)}
			</header>

			{kickoffFields.length > 0 && (
				<section className="rounded-lg border border-border bg-muted/20 p-4">
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
				</section>
			)}

			<div className="flex flex-col gap-8">
				{sortedSections.map((section) => {
					const steps = stepsBySectionId.get(section.id) ?? [];
					if (steps.length === 0) return null;
					return (
						<SectionBlock
							key={section.id}
							title={section.title}
							steps={steps}
							fieldsByStepId={fieldsByStepId}
						/>
					);
				})}
				{ungroupedSteps.length > 0 && (
					<SectionBlock
						title={sortedSections.length > 0 ? "Other steps" : "Steps"}
						steps={ungroupedSteps}
						fieldsByStepId={fieldsByStepId}
					/>
				)}
			</div>

			<footer className="border-t border-border pt-4 flex items-center justify-between">
				{hasRead && readAt ? (
					<span className="text-xs text-foreground/60">
						Marked read on {new Date(readAt).toLocaleDateString()}.
					</span>
				) : (
					<Button
						size="sm"
						variant="primary"
						onClick={() => markAsRead.mutate({ workflowVersionId })}
						disabled={markAsRead.isPending}
					>
						<CheckCircle2 className="size-3.5 mr-1.5" />
						{markAsRead.isPending ? "Marking…" : "Mark as read"}
					</Button>
				)}
				{markAsRead.isError && (
					<Alert variant="error" className="ml-3">
						<AlertDescription className="text-xs">
							{markAsRead.error instanceof Error
								? markAsRead.error.message
								: "Couldn't mark as read."}
						</AlertDescription>
					</Alert>
				)}
			</footer>
		</article>
	);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionBlock({
	title,
	steps,
	fieldsByStepId,
}: {
	title: string;
	steps: ReadonlyArray<{
		id: string;
		title: string;
		description: string | null;
		position: number;
		isRequired: boolean;
		isStopTask: boolean;
		dueType: string;
		dueOffsetDays: number | null;
	}>;
	fieldsByStepId: ReadonlyMap<
		string,
		ReadonlyArray<{
			id: string;
			label: string;
			fieldType: string;
			isRequired: boolean;
			config: Record<string, unknown> | null;
		}>
	>;
}) {
	return (
		<section className="flex flex-col gap-3">
			<h2 className="text-lg font-semibold border-b border-border pb-1">
				{title}
			</h2>
			<ol className="flex flex-col gap-4 list-none">
				{steps.map((step, idx) => {
					const stepFields = fieldsByStepId.get(step.id) ?? [];
					return (
						<li key={step.id} className="flex gap-3">
							<span className="shrink-0 size-7 rounded-full bg-muted text-foreground/70 text-xs font-medium flex items-center justify-center mt-0.5">
								{idx + 1}
							</span>
							<div className="flex-1 min-w-0">
								<div className="flex flex-wrap items-center gap-2">
									<h3 className="text-base font-medium">{step.title}</h3>
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
								</div>
								{step.description && (
									<p className="mt-1 text-sm text-foreground/70 whitespace-pre-wrap">
										{step.description}
									</p>
								)}
								{stepFields.length > 0 && (
									<ul className="mt-2 flex flex-col gap-1 pl-3 border-l-2 border-border">
										{stepFields.map((f) => (
											<li key={f.id} className="text-xs text-foreground/70 flex items-center gap-1.5">
												<span className="font-medium">{f.label}</span>
												<FieldTypeChip type={f.fieldType} />
												{f.isRequired && (
													<span className="text-[9px] uppercase tracking-wide text-destructive">
														required
													</span>
												)}
												{f.fieldType === "select" || f.fieldType === "multiselect"
													? (() => {
														const options = (f.config?.options as
															| Array<{ value: string; label: string }>
															| undefined) ?? null;
														if (!options || options.length === 0) return null;
														return (
															<span className="text-foreground/50 italic">
																{`(${options.map((o) => o.label).join(" / ")})`}
															</span>
														);
													})()
													: null}
											</li>
										))}
									</ul>
								)}
							</div>
						</li>
					);
				})}
			</ol>
		</section>
	);
}

function VersionChip({
	versionNumber,
	type,
}: {
	versionNumber: number | null;
	type: "procedure" | "document" | "policy" | "form";
}) {
	const typeLabel: Record<typeof type, string> = {
		procedure: "Procedure",
		document: "Document",
		policy: "Policy",
		form: "Form",
	};
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] uppercase tracking-wide font-medium rounded",
				"bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-300",
			)}
		>
			<span>{typeLabel[type]}</span>
			{versionNumber !== null && (
				<span className="font-mono">v{versionNumber}</span>
			)}
		</span>
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
