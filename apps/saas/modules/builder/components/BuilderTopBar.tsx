"use client";

// Top bar of the Workflow Builder canvas. Reads the workflow + version state and
// renders the appropriate primary actions:
//
//   draft, no published yet      Publish + Discard
//   draft, with published parent Publish + Discard + version chip "Draft vN · from vM"
//   published, no draft          Edit (calls editPublished → resume/fork) + version chip
//
// The Preview toggle lives here too -- it pivots the canvas into the preview adapter
// without leaving the page.

import { Button } from "@virn/ui/components/button";
import { cn } from "@virn/ui";
import {
	CheckCircle2,
	Eye,
	Pencil,
	RotateCcw,
	Send,
	Settings,
	Sparkles,
	Trash2,
	UploadCloud,
} from "lucide-react";

interface BuilderTopBarProps {
	workflowTitle: string;
	versionNumber: number;
	versionStatus: "draft" | "published" | "archived";
	/** versionNumber of the latest published, when this row is a draft FORKED from one.
	 * null when this draft is v1 (no parent) or when the active version IS the latest
	 * published. */
	forkedFromVersionNumber: number | null;
	/** Whether the Preview toggle should be shown at all. Computed by the parent from
	 * (isAdminOrOwner && isDraft) -- preview is an authoring rehearsal, not an operator
	 * view, so we hide the toggle for non-admins. */
	previewAvailable: boolean;
	previewActive: boolean;
	onTogglePreview: () => void;
	canEdit: boolean;
	editPending: boolean;
	onEdit: () => void;
	canPublish: boolean;
	publishPending: boolean;
	onPublish: () => void;
	canDiscard: boolean;
	discardPending: boolean;
	onDiscard: () => void;
	/** Phase 9.5e -- opens the workflow-level config panel (Scope + future workflow
	 * settings). Optional so callers that don't have the wiring yet just omit it. */
	onConfigureWorkflow?: () => void;
	// Phase 9.5g -- concierge-review state. When `reviewState` is omitted (preview /
	// view shells), the review-state UI is not rendered. When present, the Publish
	// button's behavior depends on requireConciergeReview + reviewState:
	//   flag off OR reviewState='draft' (flag off)        -> Publish button (existing)
	//   flag on  AND reviewState='draft'                  -> "Submit for review" button
	//   flag on  AND reviewState='in_review'              -> "Review pending" badge +
	//                                                        Approve + Send-back buttons
	//   reviewState='published'                           -> standard published view
	reviewState?: "draft" | "in_review" | "published" | "archived";
	requireConciergeReview?: boolean;
	submitForReviewPending?: boolean;
	onSubmitForReview?: () => void;
	approveReviewPending?: boolean;
	onApproveReview?: () => void;
	sendBackToDraftPending?: boolean;
	onSendBackToDraft?: () => void;
	/** Phase 12.1 -- AI authoring provenance. When present, renders a small chip
	 * next to the version status indicating this workflow originated from
	 * `agents.authorWorkflow`. The chip's title carries the model + date so a
	 * hover reveals "claude-sonnet-4-6 · 2026-05-27" without crowding the header. */
	aiAuthoring?: { model: string; createdAt: string | Date } | null;
}

export function BuilderTopBar({
	workflowTitle,
	versionNumber,
	versionStatus,
	forkedFromVersionNumber,
	previewAvailable,
	previewActive,
	onTogglePreview,
	canEdit,
	editPending,
	onEdit,
	canPublish,
	publishPending,
	onPublish,
	canDiscard,
	discardPending,
	onDiscard,
	onConfigureWorkflow,
	reviewState,
	requireConciergeReview,
	submitForReviewPending,
	onSubmitForReview,
	approveReviewPending,
	onApproveReview,
	sendBackToDraftPending,
	onSendBackToDraft,
	aiAuthoring,
}: BuilderTopBarProps) {
	// Phase 9.5g -- choose which publish-area button(s) to render based on the
	// concierge-review state machine. Flag off OR review_state is draft (flag off
	// case) -> direct Publish. Flag on + draft -> Submit for review. In review ->
	// Approve + Send back (no direct Publish; the flag forces the review gate).
	const inReviewBranch =
		reviewState === "in_review" && requireConciergeReview === true;
	const submitForReviewBranch =
		reviewState === "draft" &&
		requireConciergeReview === true &&
		!!onSubmitForReview;
	const directPublishBranch = canPublish && !inReviewBranch && !submitForReviewBranch;

	return (
		<header className="gap-3 flex items-center px-4 py-2.5 border-b border-border bg-background">
			<div className="flex-1 min-w-0">
				<h1 className="font-medium text-sm truncate">{workflowTitle}</h1>
				<div className="gap-2 flex items-center mt-0.5">
					<VersionChip
						versionNumber={versionNumber}
						status={versionStatus}
						forkedFromVersionNumber={forkedFromVersionNumber}
					/>
					{inReviewBranch && (
						<span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] uppercase tracking-wide font-medium rounded bg-indigo-100 text-indigo-900 dark:bg-indigo-900/30 dark:text-indigo-300">
							<Send className="size-3" /> In review
						</span>
					)}
					{aiAuthoring && <AiAuthoringChip aiAuthoring={aiAuthoring} />}
				</div>
			</div>

			<div className="gap-2 flex items-center">
				{onConfigureWorkflow && (
					<Button
						variant="ghost"
						size="sm"
						onClick={onConfigureWorkflow}
						className="size-8 p-0 text-foreground/60 hover:text-foreground"
						aria-label="Workflow settings"
						title="Workflow settings (Scope, etc.)"
					>
						<Settings className="size-3.5" />
					</Button>
				)}
				{previewAvailable && (
					<Button
						variant={previewActive ? "secondary" : "ghost"}
						size="sm"
						onClick={onTogglePreview}
					>
						<Eye className="size-3.5 mr-1.5" />
						{previewActive ? "Editing" : "Preview"}
					</Button>
				)}
				{canEdit && (
					<Button variant="secondary" size="sm" onClick={onEdit} loading={editPending}>
						<Pencil className="size-3.5 mr-1.5" />
						Edit
					</Button>
				)}
				{canDiscard && !inReviewBranch && (
					<Button
						variant="ghost"
						size="sm"
						onClick={onDiscard}
						loading={discardPending}
						className="text-foreground/60 hover:text-destructive"
					>
						<Trash2 className="size-3.5 mr-1.5" />
						Discard draft
					</Button>
				)}
				{/* In-review state: approve + send-back instead of publish/discard. */}
				{inReviewBranch && onSendBackToDraft && (
					<Button
						variant="ghost"
						size="sm"
						onClick={onSendBackToDraft}
						loading={sendBackToDraftPending}
						className="text-foreground/70"
					>
						<RotateCcw className="size-3.5 mr-1.5" />
						Send back
					</Button>
				)}
				{inReviewBranch && onApproveReview && (
					<Button
						variant="primary"
						size="sm"
						onClick={onApproveReview}
						loading={approveReviewPending}
					>
						<CheckCircle2 className="size-3.5 mr-1.5" />
						Approve &amp; publish
					</Button>
				)}
				{/* Draft + flag on: submit for review (replaces Publish). */}
				{submitForReviewBranch && (
					<Button
						variant="primary"
						size="sm"
						onClick={onSubmitForReview}
						loading={submitForReviewPending}
					>
						<Send className="size-3.5 mr-1.5" />
						Submit for review
					</Button>
				)}
				{/* Default: direct publish (flag off, or pre-9.5g caller). */}
				{directPublishBranch && (
					<Button variant="primary" size="sm" onClick={onPublish} loading={publishPending}>
						<UploadCloud className="size-3.5 mr-1.5" />
						Publish
					</Button>
				)}
			</div>
		</header>
	);
}

function AiAuthoringChip({
	aiAuthoring,
}: {
	aiAuthoring: { model: string; createdAt: string | Date };
}) {
	const date =
		aiAuthoring.createdAt instanceof Date
			? aiAuthoring.createdAt
			: new Date(aiAuthoring.createdAt);
	const formattedDate = Number.isNaN(date.getTime())
		? null
		: date.toLocaleDateString(undefined, {
				year: "numeric",
				month: "short",
				day: "numeric",
			});
	// Tooltip carries the model id + full date; chip body stays compact so the
	// header doesn't grow on long titles. Background is a soft violet -- distinct
	// from the version-status palette (amber/emerald/muted) and the review-state
	// indigo -- so the indicator is unambiguous at a glance.
	const tooltip = formattedDate
		? `Authored with AI -- ${aiAuthoring.model} on ${formattedDate}`
		: `Authored with AI -- ${aiAuthoring.model}`;
	return (
		<span
			className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] uppercase tracking-wide font-medium rounded bg-violet-100 text-violet-900 dark:bg-violet-900/30 dark:text-violet-300"
			title={tooltip}
		>
			<Sparkles className="size-3" /> AI-authored
		</span>
	);
}

function VersionChip({
	versionNumber,
	status,
	forkedFromVersionNumber,
}: {
	versionNumber: number;
	status: "draft" | "published" | "archived";
	forkedFromVersionNumber: number | null;
}) {
	const statusLabel: Record<typeof status, string> = {
		draft: "Draft",
		published: "Published",
		archived: "Archived",
	};
	const statusClass: Record<typeof status, string> = {
		draft: "bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-300",
		published: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-300",
		archived: "bg-muted text-muted-foreground",
	};
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] uppercase tracking-wide font-medium rounded",
				statusClass[status],
			)}
		>
			<span>{statusLabel[status]}</span>
			<span className="font-mono">v{versionNumber}</span>
			{forkedFromVersionNumber !== null && status === "draft" && (
				<span className="font-normal normal-case opacity-70">
					· forked from v{forkedFromVersionNumber}
				</span>
			)}
		</span>
	);
}
