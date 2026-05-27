"use client";

// Fresh-org empty state. Honest about what the user's missing + points them at the
// Create menu rather than rendering a blank table. For members, the message acknowledges
// they can't create but explains where workflows will appear once an admin authors one.

import { Sparkles } from "lucide-react";

import { CreateWorkflowMenu } from "./CreateWorkflowMenu";

interface LibraryEmptyStateProps {
	isAdminOrOwner: boolean;
	organizationSlug: string;
	onError: (message: string) => void;
}

export function LibraryEmptyState({
	isAdminOrOwner,
	organizationSlug,
	onError,
}: LibraryEmptyStateProps) {
	return (
		<div className="flex flex-col items-center text-center px-5 py-16">
			<div className="size-12 rounded-full bg-muted flex items-center justify-center mb-4">
				<Sparkles className="size-5 text-foreground/50" />
			</div>
			<h2 className="font-medium text-base">
				{isAdminOrOwner ? "Create your first workflow" : "No workflows yet"}
			</h2>
			<p className="text-sm text-foreground/60 max-w-sm mt-1.5">
				{isAdminOrOwner
					? "Author a procedure, SOP, policy, or form. The Builder opens with a blank draft you can publish when it's ready."
					: "An admin will author workflows here. They'll show up in this list once published."}
			</p>
			{isAdminOrOwner && (
				<div className="mt-5">
					<CreateWorkflowMenu
						organizationSlug={organizationSlug}
						onError={onError}
					/>
				</div>
			)}
		</div>
	);
}
