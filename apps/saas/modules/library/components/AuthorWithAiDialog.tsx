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
import { cn } from "@virn/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
	const [entitySetHints, setEntitySetHints] = useState<Set<string>>(new Set());
	const [templateHintId, setTemplateHintId] = useState<string | null>(null);
	const [templateMode, setTemplateMode] = useState<"reference" | "adapt">(
		"reference",
	);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [errorIssues, setErrorIssues] = useState<Array<{ path: string; message: string }>>(
		[],
	);

	const authorMutation = useMutation(orpc.agents.authorWorkflow.mutationOptions());

	// Phase 12 follow-up -- entity-set scope hint picker. Mirror the picker
	// pattern from WorkflowConfigForm.tsx; v1.5 only registers 'listing'.
	const setsQuery = useQuery({
		...orpc.entitySets.list.queryOptions({ input: { entityType: "listing" } }),
		// Don't pay for the round-trip until the dialog actually opens.
		enabled: open,
	});

	// Phase 12 follow-up (slice B) -- template hint dropdown. Lists the
	// caller's published workflows so the user can say "start from this
	// shape." Filtered client-side to executable types (procedure / form);
	// documents / policies could be valid references too but most users
	// reach for a procedure when seeding a procedure.
	const workflowsQuery = useQuery({
		...orpc.workflows.list.queryOptions({ input: {} }),
		enabled: open,
	});

	const trimmedPrompt = prompt.trim();
	const submitDisabled =
		trimmedPrompt.length < MIN_PROMPT_CHARS || authorMutation.isPending;

	const reset = () => {
		setPrompt("");
		setSourceText("");
		setEntitySetHints(new Set());
		setTemplateHintId(null);
		setTemplateMode("reference");
		setErrorMessage(null);
		setErrorIssues([]);
		authorMutation.reset();
	};

	const toggleHint = (id: string) => {
		setEntitySetHints((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
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
				entitySetHints:
					entitySetHints.size > 0 ? Array.from(entitySetHints) : null,
				templateHintId,
				// Slice C -- only send templateMode when there's a template to
				// apply it to; "adapt" without a hint is server-side rejected.
				templateMode: templateHintId !== null ? templateMode : null,
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

						<details className="text-sm">
							<summary className="cursor-pointer font-medium text-foreground/70 hover:text-foreground select-none">
								Start from a template{" "}
								<span className="text-foreground/50 font-normal">(optional)</span>
								{templateHintId !== null && (
									<span className="ml-1.5 text-[10px] uppercase tracking-wider font-semibold text-primary">
										picked
									</span>
								)}
							</summary>
							<div className="mt-2 flex flex-col gap-3">
								<TemplateHintPicker
									workflows={workflowsQuery.data ?? []}
									selected={templateHintId}
									isLoading={workflowsQuery.isLoading}
									isError={workflowsQuery.isError}
									disabled={authorMutation.isPending}
									onChange={setTemplateHintId}
								/>
								{templateHintId !== null && (
									<TemplateModeRadio
										value={templateMode}
										onChange={setTemplateMode}
										disabled={authorMutation.isPending}
									/>
								)}
								<p className="text-[11px] text-foreground/50 leading-relaxed">
									The AI uses the picked workflow's shape as a starting point.
									&quot;Use as reference&quot; lets it restructure freely; &quot;Adapt this
									template&quot; keeps the structure intact except for what you
									explicitly ask for.
								</p>
							</div>
						</details>

						<details className="text-sm">
							<summary className="cursor-pointer font-medium text-foreground/70 hover:text-foreground select-none">
								Scope to entity sets{" "}
								<span className="text-foreground/50 font-normal">(optional)</span>
								{entitySetHints.size > 0 && (
									<span className="ml-1.5 text-[10px] uppercase tracking-wider font-semibold text-primary">
										{entitySetHints.size} selected
									</span>
								)}
							</summary>
							<div className="mt-2">
								<EntitySetHintPicker
									sets={setsQuery.data ?? []}
									selected={entitySetHints}
									isLoading={setsQuery.isLoading}
									isError={setsQuery.isError}
									disabled={authorMutation.isPending}
									onToggle={toggleHint}
								/>
								<p className="text-[11px] text-foreground/50 mt-2 leading-relaxed">
									Picked sets become the new workflow's scope. Launchers will only
									surface the workflow for entities in these sets. Leave empty for
									&quot;applies to any entity.&quot;
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

// ---------------------------------------------------------------------------
// Phase 12 follow-up -- entity-set hint multi-select.
// ---------------------------------------------------------------------------

interface EntitySetOption {
	id: string;
	name: string;
	color: string | null;
	description: string | null;
}

// Phase 12 follow-up (slice C) -- template mode toggle. Only rendered when
// a template is picked; "adapt" without a template is server-side rejected
// (AI_AUTHORING_TEMPLATE_MODE_REQUIRES_HINT) so hiding the picker until then
// keeps the wire payload + the UI in sync.
function TemplateModeRadio({
	value,
	onChange,
	disabled,
}: {
	value: "reference" | "adapt";
	onChange: (next: "reference" | "adapt") => void;
	disabled: boolean;
}) {
	return (
		<div className="flex gap-2" role="radiogroup" aria-label="Template mode">
			{(
				[
					{
						id: "reference" as const,
						label: "Use as reference",
						help: "AI restructures freely based on your request",
					},
					{
						id: "adapt" as const,
						label: "Adapt this template",
						help: "AI keeps the structure intact except where you ask",
					},
				]
			).map((opt) => {
				const on = value === opt.id;
				return (
					<button
						key={opt.id}
						type="button"
						role="radio"
						aria-checked={on}
						disabled={disabled}
						onClick={() => onChange(opt.id)}
						className={cn(
							"flex-1 text-left px-3 py-2 rounded-md border text-xs transition-colors disabled:opacity-50",
							on
								? "border-primary bg-primary/5"
								: "border-border hover:border-foreground/40",
						)}
					>
						<div className="font-medium">{opt.label}</div>
						<div className="mt-0.5 text-[10px] text-foreground/60">{opt.help}</div>
					</button>
				);
			})}
		</div>
	);
}

// Phase 12 follow-up (slice B) -- template hint dropdown. Filters to
// published procedures + forms only; documents and policies can be valid
// references but rarely seed a new procedural workflow well.
function TemplateHintPicker({
	workflows,
	selected,
	isLoading,
	isError,
	disabled,
	onChange,
}: {
	workflows: ReadonlyArray<{
		id: string;
		title: string;
		type: "procedure" | "document" | "policy" | "form";
		latestPublishedVersionNumber: number | null;
	}>;
	selected: string | null;
	isLoading: boolean;
	isError: boolean;
	disabled: boolean;
	onChange: (id: string | null) => void;
}) {
	if (isLoading) {
		return (
			<div className="flex items-center gap-2 py-2 text-xs text-foreground/60">
				<Spinner className="size-3.5" /> Loading workflows…
			</div>
		);
	}
	if (isError) {
		return (
			<p className="text-xs text-destructive">Couldn't load workflows.</p>
		);
	}
	const eligible = workflows.filter(
		(w) =>
			w.latestPublishedVersionNumber !== null &&
			(w.type === "procedure" || w.type === "form"),
	);
	if (eligible.length === 0) {
		return (
			<p className="text-xs text-foreground/60">
				No published procedures or forms exist yet. Publish one and it'll appear
				here as a template option.
			</p>
		);
	}
	return (
		<select
			value={selected ?? ""}
			disabled={disabled}
			onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
			className="w-full px-2.5 py-1.5 text-sm rounded-md border border-border bg-background disabled:opacity-50"
		>
			<option value="">— No template —</option>
			{eligible.map((w) => (
				<option key={w.id} value={w.id}>
					{w.title} (v{w.latestPublishedVersionNumber})
				</option>
			))}
		</select>
	);
}

function EntitySetHintPicker({
	sets,
	selected,
	isLoading,
	isError,
	disabled,
	onToggle,
}: {
	sets: ReadonlyArray<EntitySetOption>;
	selected: ReadonlySet<string>;
	isLoading: boolean;
	isError: boolean;
	disabled: boolean;
	onToggle: (id: string) => void;
}) {
	if (isLoading) {
		return (
			<div className="flex items-center gap-2 py-2 text-xs text-foreground/60">
				<Spinner className="size-3.5" /> Loading entity sets…
			</div>
		);
	}
	if (isError) {
		return (
			<p className="text-xs text-destructive">
				Couldn't load entity sets.
			</p>
		);
	}
	if (sets.length === 0) {
		return (
			<p className="text-xs text-foreground/60">
				No entity sets exist yet. Create some under Library &rarr; Entity Sets
				and they'll appear here.
			</p>
		);
	}
	return (
		<div className="flex flex-wrap gap-1.5">
			{sets.map((s) => {
				const on = selected.has(s.id);
				return (
					<button
						key={s.id}
						type="button"
						onClick={() => onToggle(s.id)}
						disabled={disabled}
						title={s.description ?? undefined}
						className={cn(
							"px-2.5 py-1 text-xs rounded border transition-colors disabled:opacity-50",
							on
								? "bg-primary text-primary-foreground border-primary"
								: "border-border hover:border-foreground/40",
						)}
					>
						<span
							className="inline-block size-2 rounded-full mr-1.5 align-middle"
							style={{ backgroundColor: s.color ?? "transparent" }}
						/>
						{s.name}
					</button>
				);
			})}
		</div>
	);
}
