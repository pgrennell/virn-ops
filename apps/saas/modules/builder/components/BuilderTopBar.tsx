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
import { Eye, Pencil, Settings, Trash2, UploadCloud } from "lucide-react";

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
}: BuilderTopBarProps) {
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
				{canDiscard && (
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
				{canPublish && (
					<Button variant="primary" size="sm" onClick={onPublish} loading={publishPending}>
						<UploadCloud className="size-3.5 mr-1.5" />
						Publish
					</Button>
				)}
			</div>
		</header>
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
