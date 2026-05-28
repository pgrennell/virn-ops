"use client";

// AuthorWithAiDialog -- prompt-driven workflow generation (Phase 12.1 UI).
//
// Captures a free-text request from the admin, posts to agents.authorWorkflow, and
// hands the resulting workflowId back to the parent so it can navigate the user into
// the Builder for the new draft.
//
// Three things this dialog deliberately doesn't do:
//   1. It doesn't preview the generated structure -- the next surface for the user is
//      the Builder itself, which is a richer review/edit affordance than any preview
//      we'd render here.
//   2. It doesn't disable submit on the optional source text. Source text is opt-in;
//      a missing source is the common path.
//   3. It doesn't try to recover from validator refusals with a "regenerate" button --
//      that's Phase 12.2. Today, a refusal surfaces the structured error and the user
//      can edit + resubmit.
//
// The parent owns navigation + the "AI is building..." pending UX outside this dialog.

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
import { Textarea } from "@virn/ui/components/textarea";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { useState } from "react";

import { orpc } from "@shared/lib/orpc-query-utils";

interface AuthorWithAiDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Fired with the newly created workflow id + draft version id after the model
	 * returns and the build succeeds. Parent navigates into the Builder. */
	onAuthored: (result: { workflowId: string; draftVersionId: string; title: string }) => void;
}

// Match the procedure's 8-char minimum so a too-short prompt fails locally before the
// roundtrip rather than coming back as a 400.
const MIN_PROMPT_CHARS = 8;
const MAX_PROMPT_CHARS = 8000;
const MAX_SOURCE_CHARS = 50_000;

export function AuthorWithAiDialog({
	open,
	onOpenChange,
	onAuthored,
}: AuthorWithAiDialogProps) {
	const queryClient = useQueryClient();
	const [prompt, setPrompt] = useState("");
	const [sourceText, setSourceText] = useState("");
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [errorIssues, setErrorIssues] = useState<Array<{ path: string; message: string }>>(
		[],
	);

	const authorMutation = useMutation(orpc.agents.authorWorkflow.mutationOptions());

	const trimmedPrompt = prompt.trim();
	const submitDisabled =
		trimmedPrompt.length < MIN_PROMPT_CHARS || authorMutation.isPending;

	const reset = () => {
		setPrompt("");
		setSourceText("");
		setErrorMessage(null);
		setErrorIssues([]);
		authorMutation.reset();
	};

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (submitDisabled) return;

		setErrorMessage(null);
		setErrorIssues([]);

		authorMutation.mutate(
			{
				prompt: trimmedPrompt,
				sourceText: sourceText.trim().length > 0 ? sourceText.trim() : null,
			},
			{
				onSuccess: (result) => {
					// Invalidate the library list so the new draft appears immediately when
					// the user navigates back. The Builder route will fetch its own bundle.
					queryClient.invalidateQueries({
						queryKey: orpc.workflows.list.queryKey({ input: {} }),
					});
					onAuthored({
						workflowId: result.workflowId,
						draftVersionId: result.draftVersionId,
						title: result.title,
					});
					reset();
				},
				onError: (err) => {
					// The lib returns structured issues on AI_AUTHORING_INVALID_OUTPUT via
					// ORPCError.data.issues; surface them so the user can see WHY the model's
					// output was rejected (and write a better prompt or retry).
					const data = (err as { data?: { issues?: Array<{ path: string; message: string }> } })
						.data;
					if (data?.issues) setErrorIssues(data.issues);
					setErrorMessage(err.message ?? "AI authoring failed. Try again.");
				},
			},
		);
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (authorMutation.isPending) return; // don't close mid-generate
				if (!next) reset();
				onOpenChange(next);
			}}
		>
			<DialogContent className="max-w-xl">
				<form onSubmit={handleSubmit}>
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2">
							<Sparkles className="size-4 text-primary" />
							Author with AI
						</DialogTitle>
						<DialogDescription>
							Describe the workflow you want. The AI drafts it; you can edit anything
							before publishing.
						</DialogDescription>
					</DialogHeader>

					<div className="mt-4 gap-4 flex flex-col">
						<div>
							<label className="text-sm font-medium mb-1.5 block" htmlFor="ai-prompt">
								What workflow do you need?
							</label>
							<Textarea
								id="ai-prompt"
								value={prompt}
								onChange={(e) => setPrompt(e.target.value)}
								placeholder="e.g. A mid-stay inspection for STR units that runs the day before guest arrival. Three sections: kitchen, bathroom, common areas. Capture photos at each step and a final manager sign-off."
								maxLength={MAX_PROMPT_CHARS}
								rows={5}
								required
								autoFocus
								disabled={authorMutation.isPending}
							/>
							<p className="text-[11px] text-foreground/50 mt-1.5 flex justify-between">
								<span>
									{trimmedPrompt.length < MIN_PROMPT_CHARS
										? `Add at least ${MIN_PROMPT_CHARS - trimmedPrompt.length} more characters.`
										: "The more specific, the better the draft."}
								</span>
								<span>
									{prompt.length} / {MAX_PROMPT_CHARS}
								</span>
							</p>
						</div>

						<details className="text-sm">
							<summary className="cursor-pointer font-medium text-foreground/70 hover:text-foreground select-none">
								Paste an existing SOP, doc, or transcript{" "}
								<span className="text-foreground/50 font-normal">(optional)</span>
							</summary>
							<div className="mt-2">
								<Textarea
									id="ai-source"
									value={sourceText}
									onChange={(e) => setSourceText(e.target.value)}
									placeholder="Paste source content here. The AI will use it as the structural source of truth; your request above clarifies scope."
									maxLength={MAX_SOURCE_CHARS}
									rows={6}
									disabled={authorMutation.isPending}
								/>
								<p className="text-[11px] text-foreground/50 mt-1.5 text-right">
									{sourceText.length} / {MAX_SOURCE_CHARS}
								</p>
							</div>
						</details>
					</div>

					{errorMessage && (
						<div className="mt-4 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
							<p className="font-medium text-destructive">{errorMessage}</p>
							{errorIssues.length > 0 && (
								<ul className="mt-1.5 text-xs text-destructive/90 list-disc list-inside space-y-0.5">
									{errorIssues.slice(0, 5).map((issue, i) => (
										<li key={`${issue.path}-${i}`}>
											<span className="font-mono">{issue.path || "(root)"}</span>:{" "}
											{issue.message}
										</li>
									))}
									{errorIssues.length > 5 && (
										<li className="italic">
											+{errorIssues.length - 5} more — try a more specific prompt.
										</li>
									)}
								</ul>
							)}
						</div>
					)}

					<DialogFooter className="mt-6">
						<Button
							type="button"
							variant="ghost"
							onClick={() => onOpenChange(false)}
							disabled={authorMutation.isPending}
						>
							Cancel
						</Button>
						<Button type="submit" variant="primary" disabled={submitDisabled}>
							{authorMutation.isPending ? (
								<>
									<Spinner className="size-3.5 mr-1.5" />
									Generating draft…
								</>
							) : (
								<>
									<Sparkles className="size-3.5 mr-1.5" />
									Generate workflow
								</>
							)}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
