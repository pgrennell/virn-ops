"use client";

// Phase 10 / v1.5c (PRD §6.4) -- two-button segmented toggle between
// Author and Read views on the workflow detail page.
//
// Rendered in both BuilderTopBar (Author active) and ReadView header
// (Read active) for admin/owner sessions. Members never see the toggle:
// their detail-page entry always lands them on Read, and exposing an
// Author button that would silently 403 every write is dishonest UI.
//
// Uses plain anchor tags rather than next/link because the destination is
// always a sibling page under the same dynamic route segment -- a hard
// navigation is fine and keeps the component server/client-agnostic.

import { cn } from "@virn/ui";
import { BookOpen, Pencil } from "lucide-react";

interface WorkflowViewToggleProps {
	organizationSlug: string;
	workflowId: string;
	/** Which segment is highlighted. `"other"` (Phase 14) is used when the
	 * toggle is rendered on a sibling route like /runs -- neither segment
	 * highlights, but the user can still bounce back to either view. */
	active: "author" | "read" | "other";
}

export function WorkflowViewToggle({
	organizationSlug,
	workflowId,
	active,
}: WorkflowViewToggleProps) {
	const base = `/${organizationSlug}/library/workflows/${workflowId}`;
	return (
		<div
			role="group"
			aria-label="Workflow view"
			className="inline-flex items-center rounded-md border border-border bg-background p-0.5 text-xs font-medium"
		>
			<SegmentLink
				href={`${base}/builder`}
				active={active === "author"}
				label="Author"
				icon={<Pencil className="size-3" />}
			/>
			<SegmentLink
				href={`${base}/read`}
				active={active === "read"}
				label="Read"
				icon={<BookOpen className="size-3" />}
			/>
		</div>
	);
}

function SegmentLink({
	href,
	active,
	label,
	icon,
}: {
	href: string;
	active: boolean;
	label: string;
	icon: React.ReactNode;
}) {
	return (
		<a
			href={href}
			aria-current={active ? "page" : undefined}
			className={cn(
				"inline-flex items-center gap-1.5 rounded px-2 py-1 transition-colors",
				active
					? "bg-muted text-foreground"
					: "text-foreground/60 hover:text-foreground hover:bg-muted/40",
			)}
		>
			{icon}
			{label}
		</a>
	);
}
