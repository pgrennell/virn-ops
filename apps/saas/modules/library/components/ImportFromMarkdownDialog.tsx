"use client";

// Phase 13 slice B (PRD §11) -- Tango/Scribe/numbered-markdown deterministic
// import dialog. Paired with the "Import from markdown…" item under
// CreateWorkflowMenu. Distinct from AuthorWithAiDialog because:
//
//   - It calls workflows.importFromMarkdown (deterministic, no LLM cost).
//   - It has a single textarea + optional title override; no prompt, no
//     entity-set hints, no template, no two-pane review afterwards.
//   - On parse refusal (IMPORT_NO_RECOGNIZABLE_STRUCTURE) it offers a one-
//     click bridge to AuthorWithAiDialog ("AI can handle freeform sources")
//     so the user isn't stuck.
//
// Successful imports route straight to the Builder -- no review surface,
// because the structure mirrors the source verbatim. The user reviews by
// reading their own export, not a pane of generated content.

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
import { Input } from "@virn/ui/components/input";
import { Spinner } from "@virn/ui/components/spinner";
import { Textarea } from "@virn/ui/components/textarea";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileDown, Sparkles } from "lucide-react";
import { useState } from "react";

import { orpc } from "@shared/lib/orpc-query-utils";

interface ImportFromMarkdownDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Fired with the newly created workflow id + draft version id on
	 * successful import. Parent navigates into the Builder. */
	onImported: (result: { workflowId: string; draftVersionId: string; title: string }) => void;
	/** Bridge: when the user hits a parse refusal and wants AI fallback, this
	 * fires with their current source so the parent can pre-fill
	 * AuthorWithAiDialog. */
	onFallbackToAi?: (source: string) => void;
}

const MAX_SOURCE_CHARS = 200_000;
const MAX_TITLE_CHARS = 200;

export function ImportFromMarkdownDialog({
	open,
	onOpenChange,
	onImported,
	onFallbackToAi,
}: ImportFromMarkdownDialogProps) {
	const queryClient = useQueryClient();
	const [source, setSource] = useState("");
	const [titleOverride, setTitleOverride] = useState("");
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [parseRefused, setParseRefused] = useState(false);

	const importMutation = useMutation(
		orpc.workflows.importFromMarkdown.mutationOptions(),
	);

	const submitDisabled = source.trim().length === 0 || importMutation.isPending;

	const reset = () => {
		setSource("");
		setTitleOverride("");
		setErrorMessage(null);
		setParseRefused(false);
		importMutation.reset();
	};

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (submitDisabled) return;
		setErrorMessage(null);
		setParseRefused(false);

		const trimmedTitle = titleOverride.trim();
		importMutation.mutate(
			{
				source,
				titleOverride: trimmedTitle.length > 0 ? trimmedTitle : null,
			},
			{
				onSuccess: (result) => {
					void queryClient.invalidateQueries({
						queryKey: orpc.workflows.list.queryKey({ input: {} }),
					});
					onImported({
						workflowId: result.workflowId,
						draftVersionId: result.draftVersionId,
						title: result.title,
					});
					reset();
				},
				onError: (err) => {
					const data = (err as { data?: { code?: string } }).data;
					if (data?.code === "IMPORT_NO_RECOGNIZABLE_STRUCTURE") {
						setParseRefused(true);
					}
					setErrorMessage(err.message ?? "Import failed.");
				},
			},
		);
	};

	const handleFallback = () => {
		const currentSource = source;
		reset();
		onOpenChange(false);
		onFallbackToAi?.(currentSource);
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (importMutation.isPending) return;
				if (!next) reset();
				onOpenChange(next);
			}}
		>
			<DialogContent className="max-w-xl">
				<form onSubmit={handleSubmit}>
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2">
							<FileDown className="size-4 text-primary" />
							Import from markdown
						</DialogTitle>
						<DialogDescription>
							Paste a Tango, Scribe, or numbered-markdown export. The
							structure becomes a draft workflow directly -- no AI, no token
							cost. Use this when your source is already structured;
							freeform docs go through &quot;Author with AI&quot; instead.
						</DialogDescription>
					</DialogHeader>

					<div className="mt-4 gap-4 flex flex-col">
						<div>
							<label
								className="text-sm font-medium mb-1.5 block"
								htmlFor="import-source"
							>
								Source markdown
							</label>
							<Textarea
								id="import-source"
								value={source}
								onChange={(e) => setSource(e.target.value)}
								placeholder={`Paste the export here. Recognized formats:

## Step 1: Title  (Tango)
**1.** Step description  (Scribe)
## 1. Title  (numbered markdown)`}
								maxLength={MAX_SOURCE_CHARS}
								rows={10}
								required
								autoFocus
								disabled={importMutation.isPending}
							/>
							<p className="text-[11px] text-foreground/50 mt-1.5 text-right">
								{source.length.toLocaleString()} /{" "}
								{MAX_SOURCE_CHARS.toLocaleString()}
							</p>
						</div>

						<div>
							<label
								className="text-sm font-medium mb-1.5 block"
								htmlFor="import-title"
							>
								Title{" "}
								<span className="text-foreground/50 font-normal">(optional)</span>
							</label>
							<Input
								id="import-title"
								value={titleOverride}
								onChange={(e) => setTitleOverride(e.target.value)}
								placeholder="Defaults to the # heading in the source (or 'Imported workflow')."
								maxLength={MAX_TITLE_CHARS}
								disabled={importMutation.isPending}
							/>
						</div>
					</div>

					{errorMessage && (
						<div className="mt-4 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
							<p className="font-medium text-destructive">{errorMessage}</p>
							{parseRefused && (
								<div className="mt-2 flex flex-col gap-2">
									<p className="text-xs text-destructive/80">
										The parser needs at least two recognizable steps to import
										deterministically. Freeform prose works through AI authoring.
									</p>
									{onFallbackToAi && (
										<Button
											type="button"
											variant="secondary"
											size="sm"
											onClick={handleFallback}
										>
											<Sparkles className="size-3.5 mr-1.5" />
											Author with AI instead
										</Button>
									)}
								</div>
							)}
						</div>
					)}

					<DialogFooter className="mt-6">
						<Button
							type="button"
							variant="ghost"
							onClick={() => onOpenChange(false)}
							disabled={importMutation.isPending}
						>
							Cancel
						</Button>
						<Button type="submit" variant="primary" disabled={submitDisabled}>
							{importMutation.isPending ? (
								<>
									<Spinner className="size-3.5 mr-1.5" />
									Importing…
								</>
							) : (
								<>
									<FileDown className="size-3.5 mr-1.5" />
									Import
								</>
							)}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
