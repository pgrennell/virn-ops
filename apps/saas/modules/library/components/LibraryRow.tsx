"use client";

// One Library row. Thin painter of the resolver's row-action descriptor (UX_SPEC §4.2).
// All correctness lives in resolveLibraryRowAction; this file only translates the
// descriptor into the primary button + optional kebab secondary + status / type pills.

import { cn } from "@virn/ui";
import { Button } from "@virn/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@virn/ui/components/dropdown-menu";
import { BookOpen, MoreVertical, Pencil, Play, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";

import { orpc } from "@shared/lib/orpc-query-utils";
import { useMutation } from "@tanstack/react-query";

import {
	deriveStatusPill,
	resolveLibraryRowAction,
	type RowPermissions,
	type WorkflowListRow,
} from "../lib/library-row-action";
import { LIBRARY_TYPE_CHIPS } from "../lib/library-types";

interface LibraryRowProps {
	row: WorkflowListRow;
	perms: RowPermissions;
	organizationSlug: string;
	onError: (message: string) => void;
	/** Open the launcher drawer scoped to this workflow. The Library's `run` action
	 * routes here (NOT to /runs?launch=...) -- the row's responsibility is to surface
	 * the affordance; LibraryView owns the panel state + the actual launch. */
	onOpenLauncher: (workflow: {
		id: string;
		title: string;
		latestPublishedVersionId: string;
	}) => void;
}

export function LibraryRow({
	row,
	perms,
	organizationSlug,
	onError,
	onOpenLauncher,
}: LibraryRowProps) {
	const router = useRouter();
	const action = resolveLibraryRowAction(row, perms);
	const pill = deriveStatusPill(row);
	const chip = LIBRARY_TYPE_CHIPS[row.type];

	// editPublished is the only mutation a row triggers directly (Continue editing /
	// draft-only resume both route through it -- D-018 says it's resume-or-fork, so it
	// safely returns the existing draft when one's open and only forks when there isn't).
	const editPublishedMutation = useMutation(
		orpc.workflows.editPublished.mutationOptions(),
	);

	const goToBuilder = (workflowId: string) => {
		router.push(`/${organizationSlug}/library/workflows/${workflowId}/builder`);
	};

	const handleContinueEdit = () => {
		editPublishedMutation.mutate(
			{ workflowId: row.id },
			{
				onSuccess: () => goToBuilder(row.id),
				onError: (err) =>
					onError(err.message ?? "Couldn't open the workflow for editing."),
			},
		);
	};

	const handleRun = () => {
		// Opens the launcher drawer. The resolver's `run` kind only fires for rows
		// with latestPublishedVersionId !== null (it requires latestPublishedVersionNumber
		// to be non-null, and the payload fills both together), so the assertion is
		// safe by construction; the bang acknowledges that.
		if (row.latestPublishedVersionId === null) {
			onError("Workflow has no published version to launch.");
			return;
		}
		onOpenLauncher({
			id: row.id,
			title: row.title,
			latestPublishedVersionId: row.latestPublishedVersionId,
		});
	};

	const handleOpen = () => {
		// For document / policy, Open routes to the Builder's view mode. Integrity #4
		// (the known UX compromise -- the reader-facing KB is S-03).
		goToBuilder(row.id);
	};

	return (
		<li className="px-4 py-3 border-b border-border hover:bg-muted/30 transition-colors">
			<div className="gap-3 flex items-center">
				<div className="flex-1 min-w-0">
					<div className="gap-2 flex items-center">
						<span
							className={cn(
								"shrink-0 px-1.5 py-0.5 text-[10px] uppercase tracking-wide font-medium rounded",
								chip.className,
							)}
						>
							{chip.label}
						</span>
						<span className="font-medium text-sm truncate">{row.title}</span>
						{pill && (
							<span
								className={cn(
									"shrink-0 px-1.5 py-0.5 text-[10px] font-medium rounded",
									pill.tone === "published" &&
										"bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-300",
									(pill.tone === "draft" || pill.tone === "draft-only") &&
										"bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-300",
								)}
							>
								{pill.label}
							</span>
						)}
						{!row.isActive && (
							<span
								className="shrink-0 px-1.5 py-0.5 text-[10px] font-medium rounded bg-muted text-muted-foreground"
								title="Workflow is inactive — no new runs can be launched. Edit the workflow to reactivate."
							>
								Inactive
							</span>
						)}
						{row.aiAuthored && (
							<span
								className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded bg-violet-100 text-violet-900 dark:bg-violet-900/30 dark:text-violet-300"
								title="This workflow was authored via AI. Open it in the Builder to see the originating prompt."
							>
								<Sparkles className="size-2.5" /> AI
							</span>
						)}
					</div>
					{row.description && (
						<p className="text-xs text-foreground/60 truncate mt-1">
							{row.description}
						</p>
					)}
				</div>

				<RowAction
					action={action}
					editPending={editPublishedMutation.isPending}
					onRun={handleRun}
					onOpen={handleOpen}
					onContinueEdit={handleContinueEdit}
				/>
			</div>
		</li>
	);
}

interface RowActionProps {
	action: ReturnType<typeof resolveLibraryRowAction>;
	editPending: boolean;
	onRun: () => void;
	onOpen: () => void;
	onContinueEdit: () => void;
}

function RowAction({
	action,
	editPending,
	onRun,
	onOpen,
	onContinueEdit,
}: RowActionProps) {
	switch (action.kind) {
		case "run":
			return (
				<div className="gap-1 flex items-center shrink-0">
					<Button variant="secondary" size="sm" onClick={onRun}>
						<Play className="size-3.5 mr-1.5" />
						Run…
					</Button>
					{action.secondary === "continue-edit" && (
						<SecondaryKebab
							onContinueEdit={onContinueEdit}
							pending={editPending}
						/>
					)}
				</div>
			);

		case "run-disabled":
			return (
				<div className="gap-1 flex items-center shrink-0">
					<Button
						variant="secondary"
						size="sm"
						disabled
						title="Workflow is inactive — reactivate to launch new runs."
					>
						<Play className="size-3.5 mr-1.5" />
						Run…
					</Button>
					{action.secondary === "continue-edit" && (
						<SecondaryKebab
							onContinueEdit={onContinueEdit}
							pending={editPending}
						/>
					)}
				</div>
			);

		case "open":
			return (
				<div className="gap-1 flex items-center shrink-0">
					<Button variant="secondary" size="sm" onClick={onOpen}>
						<BookOpen className="size-3.5 mr-1.5" />
						Open
					</Button>
					{action.secondary === "continue-edit" && (
						<SecondaryKebab
							onContinueEdit={onContinueEdit}
							pending={editPending}
						/>
					)}
				</div>
			);

		case "continue-edit":
			return (
				<Button
					variant="secondary"
					size="sm"
					onClick={onContinueEdit}
					loading={editPending}
					className="shrink-0"
				>
					<Pencil className="size-3.5 mr-1.5" />
					Continue editing
				</Button>
			);

		case "none":
			// Member viewing a draft-only row, or a no-run-permission published row.
			// Render a muted hint -- honest about state, no button that would bounce.
			return (
				<span className="text-xs text-foreground/40 shrink-0">
					{noneReasonCopy(action.reason)}
				</span>
			);
	}
}

function noneReasonCopy(reason: "draft-only-for-member" | "no-run-permission" | "inactive-no-published"): string {
	switch (reason) {
		case "draft-only-for-member":
			return "Drafted — not yet published";
		case "no-run-permission":
			return "Run permission required";
		case "inactive-no-published":
			return "Inactive — no published version";
	}
}

function SecondaryKebab({
	onContinueEdit,
	pending,
}: {
	onContinueEdit: () => void;
	pending: boolean;
}) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					size="sm"
					className="size-7 p-0 text-foreground/50"
					aria-label="More actions"
					disabled={pending}
				>
					<MoreVertical className="size-3.5" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-48">
				<DropdownMenuItem onClick={onContinueEdit}>
					<Pencil className="size-3.5 mr-2" />
					Continue editing
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
