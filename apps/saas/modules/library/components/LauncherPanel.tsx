"use client";

// LauncherPanel -- the drawer wrapping LauncherForm.
//
// Per the Launcher plan turn: drawer for MVP momentum (reuses BuilderConfigPanel
// pattern, keeps Library context, no new route). LauncherForm is container-agnostic
// by construction -- if the deferred features (schedule-for-later, launch-as-
// another-user) eventually demand more vertical space, swapping this drawer wrapper
// for a /launch/[workflowId] route is the trivial migration the plan promised.

import { Button } from "@virn/ui/components/button";
import { cn } from "@virn/ui";
import { X } from "lucide-react";
import { useEffect } from "react";

import { LauncherForm } from "./LauncherForm";

interface LauncherPanelProps {
	open: boolean;
	workflow: {
		id: string;
		title: string;
		latestPublishedVersionId: string;
	} | null;
	organizationSlug: string;
	/** Phase 8 step 3 -- threaded down to LauncherForm to gate the mode selector. */
	agentStepsEnabled: boolean;
	onClose: () => void;
}

export function LauncherPanel({
	open,
	workflow,
	organizationSlug,
	agentStepsEnabled,
	onClose,
}: LauncherPanelProps) {
	// ESC to dismiss. Same affordance the Builder config panel exposes.
	useEffect(() => {
		if (!open) return;
		const handler = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [open, onClose]);

	return (
		<aside
			aria-hidden={!open}
			className={cn(
				"shrink-0 border-l border-border bg-background flex flex-col min-h-0 transition-[width] duration-200",
				open ? "w-[420px]" : "w-0 overflow-hidden",
			)}
		>
			<header className="px-4 py-2.5 border-b border-border flex items-center gap-2">
				<h3 className="flex-1 truncate text-sm font-medium">Launch</h3>
				<Button
					variant="ghost"
					size="sm"
					onClick={onClose}
					className="size-7 p-0 text-foreground/40 hover:text-foreground"
					aria-label="Close launcher"
				>
					<X className="size-3.5" />
				</Button>
			</header>
			<div className="flex-1 min-h-0 overflow-y-auto">
				{open && workflow ? (
					<LauncherForm
						workflow={workflow}
						organizationSlug={organizationSlug}
						agentStepsEnabled={agentStepsEnabled}
						onLaunched={onClose}
					/>
				) : null}
			</div>
		</aside>
	);
}
