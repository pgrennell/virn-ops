"use client";

// + Create ▾ menu. Renders one entry per workflow.type (UX_SPEC §4.2 "+ Create menu:
// Workflow / SOP or Policy / Form"). Iterates LIBRARY_CREATE_MENU so the menu can't
// drift from the type tabs -- both read the same source.
//
// On select: calls workflows.create with the chosen type, redirects to the Builder
// using the returned workflowId (not draftVersionId -- the Builder URL is workflow-
// scoped). Disabled for non-admin members; the parent already hides the trigger when
// the caller isn't admin, but the per-item disabled state is belt + suspenders.
//
// Phase 12.1: a "Author with AI" entry sits below a divider in the same menu. It
// opens the AuthorWithAiDialog instead of calling workflows.create -- the dialog
// performs its own agents.authorWorkflow call and returns a fully-built draft that
// we route into the Builder the same way as a hand-authored create.

import { Button } from "@virn/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@virn/ui/components/dropdown-menu";
import { Spinner } from "@virn/ui/components/spinner";
import { useMutation } from "@tanstack/react-query";
import { ChevronDown, FileDown, Plus, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { orpc } from "@shared/lib/orpc-query-utils";

import { LIBRARY_CREATE_MENU, type WorkflowType } from "../lib/library-types";
import { AuthorWithAiDialog } from "./AuthorWithAiDialog";
import { ImportFromMarkdownDialog } from "./ImportFromMarkdownDialog";

interface CreateWorkflowMenuProps {
	organizationSlug: string;
	onError: (message: string) => void;
}

export function CreateWorkflowMenu({ organizationSlug, onError }: CreateWorkflowMenuProps) {
	const router = useRouter();
	const [pending, setPending] = useState<WorkflowType | null>(null);
	const [aiDialogOpen, setAiDialogOpen] = useState(false);
	const [importDialogOpen, setImportDialogOpen] = useState(false);

	const createMutation = useMutation(orpc.workflows.create.mutationOptions());

	const navigateToBuilder = (workflowId: string) => {
		// Workflow-scoped URL (not version-scoped) -- BuilderView decides which
		// version to open (draft if any, else latest published).
		router.push(`/${organizationSlug}/library/workflows/${workflowId}/builder`);
	};

	const handleCreate = (type: WorkflowType, label: string) => {
		setPending(type);
		// `label` becomes the new workflow's title; the user renames it in the Builder.
		// "New workflow" / "New SOP" / "New policy" / "New form" -- discoverable defaults.
		createMutation.mutate(
			{ title: label, type },
			{
				onSuccess: ({ workflowId }) => navigateToBuilder(workflowId),
				onError: (err) => {
					setPending(null);
					onError(err.message ?? "Couldn't create the workflow.");
				},
			},
		);
	};

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button variant="primary" size="sm" disabled={createMutation.isPending}>
						{createMutation.isPending ? (
							<Spinner className="size-3.5 mr-1.5" />
						) : (
							<Plus className="size-3.5 mr-1.5" />
						)}
						Create
						<ChevronDown className="size-3.5 ml-1.5 -mr-0.5" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="w-52">
					{LIBRARY_CREATE_MENU.map((entry) => (
						<DropdownMenuItem
							key={entry.type}
							onClick={() => handleCreate(entry.type, entry.label)}
							disabled={createMutation.isPending}
						>
							{pending === entry.type && createMutation.isPending && (
								<Spinner className="size-3 mr-2" />
							)}
							{entry.label}
						</DropdownMenuItem>
					))}
					<DropdownMenuSeparator />
					<DropdownMenuItem
						onClick={() => setAiDialogOpen(true)}
						disabled={createMutation.isPending}
					>
						<Sparkles className="size-3.5 mr-2 text-primary" />
						Author with AI…
					</DropdownMenuItem>
					<DropdownMenuItem
						onClick={() => setImportDialogOpen(true)}
						disabled={createMutation.isPending}
					>
						<FileDown className="size-3.5 mr-2 text-foreground/70" />
						Import from markdown…
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>

			<AuthorWithAiDialog
				open={aiDialogOpen}
				onOpenChange={setAiDialogOpen}
				onAuthored={({ workflowId }) => {
					setAiDialogOpen(false);
					// Phase 12 follow-up (two-pane review) -- newly authored
					// drafts route into the review surface, not straight to
					// /builder. The builder page reads ?aiAuthored=1 and renders
					// AiReviewView (prompt on the left, read-only structure on
					// the right with per-step Edit + Regenerate). Clicking
					// "Finish review" drops the flag and lands in the normal
					// Builder.
					router.push(
						`/${organizationSlug}/library/workflows/${workflowId}/builder?aiAuthored=1`,
					);
				}}
			/>

			<ImportFromMarkdownDialog
				open={importDialogOpen}
				onOpenChange={setImportDialogOpen}
				onImported={({ workflowId }) => {
					setImportDialogOpen(false);
					// Phase 13 slice B -- imports route straight to /builder, no
					// review surface. The structure mirrors the source
					// verbatim; the user already reviewed by reading their
					// own export before pasting.
					router.push(
						`/${organizationSlug}/library/workflows/${workflowId}/builder`,
					);
				}}
				onFallbackToAi={(currentSource) => {
					// Bridge: parse refused. Close the import dialog and open
					// AuthorWithAiDialog so the user keeps their pasted text.
					// AuthorWithAiDialog's source-text field is local state, so
					// we can't pre-fill from here -- in v1 the user re-pastes.
					// A future polish slice can lift source-text to a shared
					// context if the re-paste friction proves annoying.
					void currentSource;
					setAiDialogOpen(true);
				}}
			/>
		</>
	);
}
