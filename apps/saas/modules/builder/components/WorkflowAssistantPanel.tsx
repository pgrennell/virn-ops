"use client";

// Phase 12 / PRD §6.3 R1 -- persistent right-rail Workflow Assistant chat
// panel. Always-on during authoring; the primary surface for mid-edit
// refinement once the workflow has landed. Pairs with the per-step
// "Regenerate" button (shipped in `7ed368d`) -- both route to the same
// `agents.regenerateStep` procedure but the chat takes natural-language
// step references ("step 3", "the first step", "Inspect kitchen") and
// dispatches to the right step automatically.
//
// What v1 supports:
//   - Structured edit requests parsed into regenerateStep calls.
//   - Inline assistant responses for unrouted / no-target / ambiguous
//     prompts -- the panel never silently no-ops.
//   - In-memory message history (resets on workflow switch; persistence is a
//     follow-on).
//
// What v1 does NOT support:
//   - Free-form documentation Q&A ("explain offset_from_step"). The PRD
//     describes a documentation-aware backend for this; out of scope here.
//   - Multi-turn context ("now add a vendor field" referring to a prior
//     step). v1 treats each message as self-contained; the operator
//     re-references the step explicitly.
//   - File / image attachments.
//   - Streaming responses -- the regenerate procedure isn't streamed today.

import { Alert, AlertDescription } from "@virn/ui/components/alert";
import { Button } from "@virn/ui/components/button";
import { cn } from "@virn/ui";
import { Send, Sparkles, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import {
	type AssistantContextStep,
	parseAssistantPrompt,
} from "../lib/workflow-assistant-parser";

// ---------------------------------------------------------------------------
// Message model
// ---------------------------------------------------------------------------

type AssistantMessage =
	| { id: string; role: "user"; text: string }
	| {
			id: string;
			role: "assistant";
			text: string;
			kind: "info" | "success" | "error" | "pending";
	  };

interface WorkflowAssistantPanelProps {
	steps: ReadonlyArray<AssistantContextStep>;
	activeStepId: string | null;
	/** Resolves on regenerate success with the before/after titles so the
	 * panel can render a confirmation. Rejects with an Error whose message is
	 * surfaced verbatim in the assistant's error response message. */
	onInvokeRegenerate: (
		targetStepId: string,
		refinementPrompt: string | null,
	) => Promise<{ previousTitle: string; newTitle: string }>;
}

let counter = 0;
function nextId(): string {
	counter += 1;
	return `msg_${counter}`;
}

const INITIAL_GREETING: AssistantMessage = {
	id: "msg_greeting",
	role: "assistant",
	kind: "info",
	text:
		"Hi! I can refine any step in this workflow. Try something like " +
		'"make step 3 terser" or "add a vendor coordination field to step 5". ' +
		"I leave any step you've manually edited untouched (D-040).",
};

export function WorkflowAssistantPanel({
	steps,
	activeStepId,
	onInvokeRegenerate,
}: WorkflowAssistantPanelProps) {
	const [messages, setMessages] = useState<AssistantMessage[]>([INITIAL_GREETING]);
	const [draft, setDraft] = useState("");
	const [pending, setPending] = useState(false);
	const composeId = useId();
	const scrollRef = useRef<HTMLDivElement>(null);

	// Auto-scroll to the latest message on every update. Smooth on user
	// messages (feels like the panel responded), instant on initial mount.
	useEffect(() => {
		if (!scrollRef.current) return;
		scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
	}, [messages]);

	const handleSubmit = async () => {
		const trimmed = draft.trim();
		if (trimmed.length === 0 || pending) return;

		const userMsgId = nextId();
		const pendingMsgId = nextId();
		setMessages((m) => [
			...m,
			{ id: userMsgId, role: "user", text: trimmed },
		]);
		setDraft("");

		// Parse the prompt. All four kinds are non-destructive -- the panel
		// surfaces the reason inline.
		const parsed = parseAssistantPrompt({
			prompt: trimmed,
			steps,
			activeStepId,
		});

		if (parsed.kind === "unrouted") {
			setMessages((m) => [
				...m,
				{ id: nextId(), role: "assistant", kind: "info", text: parsed.reason },
			]);
			return;
		}
		if (parsed.kind === "ambiguous") {
			setMessages((m) => [
				...m,
				{ id: nextId(), role: "assistant", kind: "error", text: parsed.reason },
			]);
			return;
		}
		if (parsed.kind === "no-target") {
			setMessages((m) => [
				...m,
				{ id: nextId(), role: "assistant", kind: "error", text: parsed.reason },
			]);
			return;
		}

		// Structured edit: dispatch to regenerateStep.
		setMessages((m) => [
			...m,
			{
				id: pendingMsgId,
				role: "assistant",
				kind: "pending",
				text: `Regenerating "${parsed.targetStepTitle}"…`,
			},
		]);
		setPending(true);

		try {
			const result = await onInvokeRegenerate(
				parsed.targetStepId,
				parsed.refinementPrompt.length > 0 ? parsed.refinementPrompt : null,
			);
			setMessages((m) =>
				m.map((msg) =>
					msg.id === pendingMsgId
						? {
								id: msg.id,
								role: "assistant",
								kind: "success",
								text: `Updated step: "${result.previousTitle}" → "${result.newTitle}".`,
							}
						: msg,
				),
			);
		} catch (err) {
			const message =
				err instanceof Error ? err.message : "Couldn't regenerate that step.";
			setMessages((m) =>
				m.map((msg) =>
					msg.id === pendingMsgId
						? {
								id: msg.id,
								role: "assistant",
								kind: "error",
								text: message,
							}
						: msg,
				),
			);
		} finally {
			setPending(false);
		}
	};

	const handleReset = () => {
		setMessages([INITIAL_GREETING]);
	};

	return (
		<aside
			className="w-80 shrink-0 border-l border-border bg-muted/30 flex flex-col"
			aria-label="Workflow Assistant"
		>
			<header className="px-3 py-2 border-b border-border bg-background/60 flex items-center gap-2">
				<Sparkles className="size-4 text-primary" aria-hidden />
				<div className="flex-1 min-w-0">
					<h3 className="text-xs font-semibold uppercase tracking-wider">
						Workflow Assistant
					</h3>
					<p className="text-[10px] text-foreground/60">
						Refine any step with AI · D-040 safe
					</p>
				</div>
				<Button
					variant="ghost"
					size="sm"
					onClick={handleReset}
					className="size-7 p-0 text-foreground/50 hover:text-foreground"
					aria-label="Reset conversation"
					title="Reset conversation"
				>
					<X className="size-3.5" />
				</Button>
			</header>

			<div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-3 flex flex-col gap-2">
				{messages.map((msg) => (
					<AssistantMessageRow key={msg.id} message={msg} />
				))}
			</div>

			<form
				className="border-t border-border bg-background p-2 flex flex-col gap-2"
				onSubmit={(e) => {
					e.preventDefault();
					void handleSubmit();
				}}
			>
				<label htmlFor={composeId} className="sr-only">
					Refinement request
				</label>
				<textarea
					id={composeId}
					value={draft}
					onChange={(e) => setDraft(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter" && !e.shiftKey) {
							e.preventDefault();
							void handleSubmit();
						}
					}}
					placeholder='e.g. "make step 3 terser" — Enter to send'
					rows={2}
					maxLength={2000}
					disabled={pending}
					className="resize-none border border-border rounded-md px-2 py-1.5 text-xs bg-background focus:outline-none focus:ring-1 focus:ring-primary"
				/>
				<div className="flex items-center justify-between">
					<span className="text-[10px] text-foreground/50">
						{draft.length > 0 ? `${draft.length} / 2000` : "Shift+Enter for newline"}
					</span>
					<Button
						type="submit"
						size="sm"
						variant="primary"
						disabled={pending || draft.trim().length === 0}
					>
						<Send className="size-3 mr-1.5" />
						{pending ? "Sending…" : "Send"}
					</Button>
				</div>
			</form>
		</aside>
	);
}

// ---------------------------------------------------------------------------
// Message row -- role + kind specific styling
// ---------------------------------------------------------------------------

function AssistantMessageRow({ message }: { message: AssistantMessage }) {
	if (message.role === "user") {
		return (
			<div className="flex justify-end">
				<div className="max-w-[85%] rounded-lg bg-primary text-primary-foreground px-2.5 py-1.5 text-xs whitespace-pre-wrap break-words">
					{message.text}
				</div>
			</div>
		);
	}
	// assistant -- info / success / error / pending
	if (message.kind === "error") {
		return (
			<Alert variant="error">
				<AlertDescription className="text-xs">{message.text}</AlertDescription>
			</Alert>
		);
	}
	return (
		<div className="flex justify-start">
			<div
				className={cn(
					"max-w-[85%] rounded-lg px-2.5 py-1.5 text-xs whitespace-pre-wrap break-words",
					message.kind === "success"
						? "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200"
						: message.kind === "pending"
							? "bg-muted text-foreground/70 italic"
							: "bg-background border border-border text-foreground",
				)}
			>
				{message.text}
			</div>
		</div>
	);
}
