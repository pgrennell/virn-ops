"use client";

// KickoffRailEntry -- the left-rail entry for the kickoff form, sitting above the
// section/step list in author mode. UX_SPEC §4.3 specs the rail's spine as
// "kickoff form + sections + steps" with the kickoff form first. Click selects the
// kickoff editor in the center pane; the section/step list stays unchanged below.
//
// Composed by AuthorBody (not RunStepList) so the rail-list primitive stays focused
// on sections + steps -- which is what it knows about. Kickoff is a builder-only
// concept; bolting it into RunStepList would push runtime-vs-author awareness into
// a primitive that should be ignorant of which mode it's in.

import { cn } from "@virn/ui";
import { ClipboardList, Plus } from "lucide-react";

interface KickoffRailEntryProps {
	active: boolean;
	kickoffFieldCount: number;
	onSelect: () => void;
}

export function KickoffRailEntry({ active, kickoffFieldCount, onSelect }: KickoffRailEntryProps) {
	return (
		<button
			type="button"
			onClick={onSelect}
			aria-current={active ? "step" : undefined}
			className={cn(
				"gap-2 flex items-center text-sm text-left px-2 py-1.5 mb-1 rounded-md transition-colors w-full",
				active
					? "bg-background border border-border shadow-sm"
					: "hover:bg-muted/50",
			)}
		>
			<ClipboardList className="size-4 text-foreground/40 shrink-0" aria-hidden />
			<span className="flex-1 min-w-0 truncate">Kickoff form</span>
			{kickoffFieldCount > 0 ? (
				<span
					className="shrink-0 px-1.5 py-0.5 text-[9px] uppercase tracking-wide font-medium rounded bg-muted text-muted-foreground"
					title={`${kickoffFieldCount} kickoff field${kickoffFieldCount === 1 ? "" : "s"}`}
				>
					{kickoffFieldCount}
				</span>
			) : (
				<Plus className="size-3 text-foreground/30 shrink-0" aria-hidden />
			)}
		</button>
	);
}
