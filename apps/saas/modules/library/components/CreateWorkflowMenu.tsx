"use client";

// + Create ▾ menu. Renders one entry per workflow.type (UX_SPEC §4.2 "+ Create menu:
// Workflow / SOP or Policy / Form"). Iterates LIBRARY_CREATE_MENU so the menu can't
// drift from the type tabs -- both read the same source.
//
// On select: calls workflows.create with the chosen type, redirects to the Builder
// using the returned workflowId (not draftVersionId -- the Builder URL is workflow-
// scoped). Disabled for non-admin members; the parent already hides the trigger when
// the caller isn't admin, but the per-item disabled state is belt + suspenders.

import { Button } from "@virn/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@virn/ui/components/dropdown-menu";
import { Spinner } from "@virn/ui/components/spinner";
import { useMutation } from "@tanstack/react-query";
import { ChevronDown, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { orpc } from "@shared/lib/orpc-query-utils";

import { LIBRARY_CREATE_MENU, type WorkflowType } from "../lib/library-types";

interface CreateWorkflowMenuProps {
	organizationSlug: string;
	onError: (message: string) => void;
}

export function CreateWorkflowMenu({ organizationSlug, onError }: CreateWorkflowMenuProps) {
	const router = useRouter();
	const [pending, setPending] = useState<WorkflowType | null>(null);

	const createMutation = useMutation(orpc.workflows.create.mutationOptions());

	const handleCreate = (type: WorkflowType, label: string) => {
		setPending(type);
		// `label` becomes the new workflow's title; the user renames it in the Builder.
		// "New workflow" / "New SOP" / "New policy" / "New form" -- discoverable defaults.
		createMutation.mutate(
			{ title: label, type },
			{
				onSuccess: ({ workflowId }) => {
					// Workflow-scoped URL (not version-scoped) -- BuilderView decides which
					// version to open (draft if any, else latest published).
					router.push(`/${organizationSlug}/library/workflows/${workflowId}/builder`);
				},
				onError: (err) => {
					setPending(null);
					onError(err.message ?? "Couldn't create the workflow.");
				},
			},
		);
	};

	return (
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
			<DropdownMenuContent align="end" className="w-48">
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
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
