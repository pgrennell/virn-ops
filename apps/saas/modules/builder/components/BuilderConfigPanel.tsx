"use client";

// Slide-in config drawer for the Workflow Builder (Pass 3 of UX_SPEC §4.3).
//
// The author selects a step in the left rail; the center editor shows quick-edits
// (label, description, inline field rows). Clicking "Configure step" opens THIS
// panel for dense per-step settings (type, role, due rule, dependencies, conditions).
// Clicking a field's row opens this panel for the field's settings (label, key with
// lock state, type, options, required, help). One panel at a time -- mutually
// exclusive between step + field focus.
//
// Render: fixed slide-in from the right. Width is bounded so the canvas stays
// usable behind it. ESC + the explicit close button both dismiss. Closing without
// "save" is fine because every form field commits inline (the same pattern Pass 2
// uses for inline label editing).

import { Button } from "@virn/ui/components/button";
import { cn } from "@virn/ui";
import { X } from "lucide-react";
import { useEffect } from "react";

interface BuilderConfigPanelProps {
	open: boolean;
	title: string;
	onClose: () => void;
	children: React.ReactNode;
}

export function BuilderConfigPanel({ open, title, onClose, children }: BuilderConfigPanelProps) {
	// ESC closes. Same affordance the user expects from any modal-ish surface.
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
				open ? "w-[360px]" : "w-0 overflow-hidden",
			)}
		>
			<header className="px-4 py-2.5 border-b border-border flex items-center gap-2">
				<h3 className="flex-1 truncate text-sm font-medium">{title}</h3>
				<Button
					variant="ghost"
					size="sm"
					onClick={onClose}
					className="size-7 p-0 text-foreground/40 hover:text-foreground"
					aria-label="Close settings"
				>
					<X className="size-3.5" />
				</Button>
			</header>
			<div className="flex-1 min-h-0 overflow-y-auto">{children}</div>
		</aside>
	);
}
