"use client";

// Phase 12 follow-up (PRD §8.4) -- "View originating prompt" dialog rendered
// when the user clicks the AI chip on an AI-authored workflow's header
// (Builder or Read view).
//
// What the dialog renders:
//   - The free-text prompt the author submitted (the primary thing operators
//     want when they're trying to understand "why does this workflow look
//     like this?").
//   - Optional source text the author pasted, in a collapsible details
//     element so a long SOP doesn't dominate the dialog.
//   - Model id + author timestamp, mirroring the chip tooltip.
//   - Entity schema snapshot, collapsible. This is the forensically
//     interesting bit -- it captures which entities the AI saw at authoring
//     time, so "the AI made up a Booking field" can be cross-checked against
//     whether the org's entity adapter actually exposed a Booking.
//
// What the dialog does NOT render:
//   - The raw responseJson. The dialog is a request-side artifact ("what was
//     asked"); the workflow canvas is the response-side artifact ("what got
//     built"). Showing both at once would just be the canvas duplicated.
//   - An "Edit prompt and regenerate" affordance. That's the C5 / R1 surface
//     (per-step Regenerate + the Workflow Assistant chat panel). The dialog
//     is read-only; the regenerate verbs already exist on richer surfaces.

import { Alert, AlertDescription } from "@virn/ui/components/alert";
import { Button } from "@virn/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@virn/ui/components/dialog";
import { Spinner } from "@virn/ui/components/spinner";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy, Sparkles } from "lucide-react";
import { useState } from "react";

import { orpc } from "@shared/lib/orpc-query-utils";

interface AuthoringPromptDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	promptId: string;
}

export function AuthoringPromptDialog({
	open,
	onOpenChange,
	promptId,
}: AuthoringPromptDialogProps) {
	// Only fetch when the dialog is actually open. Avoids paying for the
	// roundtrip on every render of the parent chip surface.
	const query = useQuery({
		...orpc.agents.getAuthoringPrompt.queryOptions({ input: { promptId } }),
		enabled: open,
	});

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-2xl">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<Sparkles className="size-4 text-violet-600 dark:text-violet-400" />
						Originating prompt
					</DialogTitle>
					<DialogDescription>
						The request the AI was given when this workflow was authored, plus
						the entity schema snapshot it saw at the time.
					</DialogDescription>
				</DialogHeader>

				{query.isLoading && (
					<div className="flex items-center justify-center gap-2 py-12 text-sm text-foreground/60">
						<Spinner className="size-4" /> Loading prompt…
					</div>
				)}

				{query.isError && (
					<Alert variant="error" className="my-3">
						<AlertDescription>
							{query.error instanceof Error
								? query.error.message
								: "Couldn't load the originating prompt."}
						</AlertDescription>
					</Alert>
				)}

				{query.data && <PromptBody data={query.data} />}

				<DialogFooter className="mt-4">
					<Button variant="ghost" onClick={() => onOpenChange(false)}>
						Close
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

interface PromptBodyData {
	id: string;
	prompt: string;
	sourceText: string | null;
	entitySchemaSnapshot: Record<string, unknown>;
	model: string;
	createdAt: Date | string;
}

function PromptBody({ data }: { data: PromptBodyData }) {
	const createdAt =
		data.createdAt instanceof Date ? data.createdAt : new Date(data.createdAt);
	const formattedDate = Number.isNaN(createdAt.getTime())
		? null
		: createdAt.toLocaleString(undefined, {
				year: "numeric",
				month: "short",
				day: "numeric",
				hour: "2-digit",
				minute: "2-digit",
			});

	return (
		<div className="mt-2 flex flex-col gap-4">
			<MetaRow model={data.model} date={formattedDate} />

			<section>
				<SectionHeader label="Prompt" copyValue={data.prompt} />
				<pre className="mt-1.5 px-3 py-2 rounded-md border border-border bg-muted/30 text-xs whitespace-pre-wrap break-words max-h-64 overflow-y-auto">
					{data.prompt}
				</pre>
			</section>

			{data.sourceText && data.sourceText.length > 0 && (
				<details className="text-sm">
					<summary className="cursor-pointer font-medium text-foreground/70 hover:text-foreground select-none">
						Source text{" "}
						<span className="text-foreground/50 font-normal">
							({data.sourceText.length.toLocaleString()} chars)
						</span>
					</summary>
					<div className="mt-2">
						<SectionHeader label="Source text" copyValue={data.sourceText} />
						<pre className="mt-1.5 px-3 py-2 rounded-md border border-border bg-muted/30 text-xs whitespace-pre-wrap break-words max-h-72 overflow-y-auto">
							{data.sourceText}
						</pre>
					</div>
				</details>
			)}

			<details className="text-sm">
				<summary className="cursor-pointer font-medium text-foreground/70 hover:text-foreground select-none">
					Entity schema snapshot{" "}
					<span className="text-foreground/50 font-normal">
						(what the AI saw at authoring time)
					</span>
				</summary>
				<div className="mt-2">
					<pre className="px-3 py-2 rounded-md border border-border bg-muted/30 text-[11px] font-mono whitespace-pre-wrap break-words max-h-72 overflow-y-auto">
						{JSON.stringify(data.entitySchemaSnapshot, null, 2)}
					</pre>
				</div>
			</details>
		</div>
	);
}

function MetaRow({ model, date }: { model: string; date: string | null }) {
	return (
		<div className="flex items-center gap-2 text-[10px] uppercase tracking-wider font-medium text-foreground/50">
			<span className="px-1.5 py-0.5 rounded bg-violet-100 text-violet-900 dark:bg-violet-900/30 dark:text-violet-300 font-mono normal-case">
				{model}
			</span>
			{date && <span>{date}</span>}
		</div>
	);
}

function SectionHeader({
	label,
	copyValue,
}: {
	label: string;
	copyValue: string;
}) {
	const [copied, setCopied] = useState(false);

	const handleCopy = async () => {
		try {
			await navigator.clipboard.writeText(copyValue);
			setCopied(true);
			window.setTimeout(() => setCopied(false), 1500);
		} catch {
			// Clipboard write can fail in iframes / non-secure contexts; the
			// failure is intentionally silent -- the text is selectable in the
			// pre block as a fallback. No noisy toast.
		}
	};

	return (
		<div className="flex items-center justify-between">
			<span className="text-[10px] uppercase tracking-wider font-semibold text-foreground/60">
				{label}
			</span>
			<button
				type="button"
				onClick={handleCopy}
				className="inline-flex items-center gap-1 text-[10px] text-foreground/50 hover:text-foreground transition-colors"
				aria-label={`Copy ${label.toLowerCase()}`}
			>
				{copied ? (
					<>
						<Check className="size-3" /> Copied
					</>
				) : (
					<>
						<Copy className="size-3" /> Copy
					</>
				)}
			</button>
		</div>
	);
}
