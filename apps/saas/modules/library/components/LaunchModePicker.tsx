"use client";

// LaunchModePicker -- the S-07 wedge UX (Phase 8 step 3). Three cards: Human / AI-assisted
// / Automated. When an agent mode is selected, an agent picker + step preview appears
// underneath.
//
// Card-disable semantics (the picker REFUSES to silently pick a broken mode, matching
// UX_SPEC §2's "show disabled with reason; never hide options silently"):
//   - ai_assisted disabled when:  (a) no active agents, OR  (b) workflow has zero ai-typed steps
//   - automated   disabled when:  no active agents
//   - human       always enabled
//
// The agent picker shows ONLY agents where `isActive=true`. Disabled agents created via
// /settings/agents are excluded -- the launcher would otherwise let you pick an agent that
// the server would then refuse via AGENT_INACTIVE.

import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@virn/ui/components/select";
import { cn } from "@virn/ui";
import { useQuery } from "@tanstack/react-query";
import { Bot, Check, User, Workflow } from "lucide-react";

import { orpc } from "@shared/lib/orpc-query-utils";

import type { LaunchMode } from "../lib/launcher-types";

interface LaunchModePickerProps {
	mode: LaunchMode;
	onChangeMode: (mode: LaunchMode) => void;
	selectedAgentId: string | null;
	onChangeAgentId: (id: string | null) => void;
	/** Step bundle (used for the preview: "Steps 1, 3 will be handled by X"). */
	steps: ReadonlyArray<{ id: string; title: string; type: string; position: number }>;
}

interface ModeCardDef {
	id: LaunchMode;
	icon: typeof User;
	title: string;
	description: string;
}

const MODE_CARDS: readonly ModeCardDef[] = [
	{
		id: "human",
		icon: User,
		title: "Human",
		description: "Operators run every step. The default — same behavior as a regular launch.",
	},
	{
		id: "ai_assisted",
		icon: Bot,
		title: "AI-assisted",
		description: "An agent handles the AI-shaped steps. Humans handle the rest.",
	},
	{
		id: "automated",
		icon: Workflow,
		title: "Automated",
		description: "An agent handles every step. Humans monitor.",
	},
];

export function LaunchModePicker({
	mode,
	onChangeMode,
	selectedAgentId,
	onChangeAgentId,
	steps,
}: LaunchModePickerProps) {
	const agentsQuery = useQuery(orpc.agents.list.queryOptions({ input: {} }));
	const allAgents = agentsQuery.data ?? [];
	const activeAgents = allAgents.filter((a) => a.isActive);
	const hasActiveAgents = activeAgents.length > 0;

	const aiStepsCount = steps.filter((s) => s.type === "ai").length;
	const hasAiSteps = aiStepsCount > 0;

	// Per-mode disabled-reason resolution. Hint copy mirrors the UX_SPEC §2 pattern:
	// "tell the user WHY this is off, not just that it's off."
	function disabledReason(m: LaunchMode): string | null {
		if (m === "human") return null;
		if (!hasActiveAgents) {
			return "No active agents in this org. Create one in Settings → Agents.";
		}
		if (m === "ai_assisted" && !hasAiSteps) {
			return "This workflow has no AI-shaped steps. Mark a step as AI in the Builder to use this mode.";
		}
		return null;
	}

	const aiStepRows = steps
		.filter((s) => s.type === "ai")
		.sort((a, b) => a.position - b.position);
	const allStepRows = [...steps].sort((a, b) => a.position - b.position);

	const selectedAgent = activeAgents.find((a) => a.id === selectedAgentId) ?? null;

	return (
		<section>
			<p className="text-xs uppercase tracking-wide font-medium text-foreground/50 mb-2">
				Launch mode
			</p>
			<div className="gap-2 flex flex-col">
				{MODE_CARDS.map((card) => {
					const reason = disabledReason(card.id);
					const isDisabled = reason !== null;
					const isSelected = mode === card.id;
					const Icon = card.icon;
					return (
						<button
							key={card.id}
							type="button"
							disabled={isDisabled}
							onClick={() => onChangeMode(card.id)}
							className={cn(
								"text-left p-3 rounded-md border transition-colors",
								isDisabled && "opacity-50 cursor-not-allowed",
								!isDisabled && isSelected && "border-primary bg-primary/5",
								!isDisabled && !isSelected && "border-border hover:border-foreground/30 cursor-pointer",
							)}
						>
							<div className="gap-2 flex items-start">
								<div
									className={cn(
										"size-7 shrink-0 rounded flex items-center justify-center",
										isSelected ? "bg-primary text-primary-foreground" : "bg-muted text-foreground/60",
									)}
								>
									<Icon className="size-3.5" />
								</div>
								<div className="flex-1 min-w-0">
									<div className="gap-2 flex items-center">
										<span className="font-medium text-sm">{card.title}</span>
										{isSelected && !isDisabled && (
											<Check className="size-3.5 text-primary" />
										)}
									</div>
									<p className="text-xs text-foreground/60 mt-0.5">{card.description}</p>
									{reason && (
										<p className="text-[11px] text-foreground/50 mt-1.5 italic">{reason}</p>
									)}
								</div>
							</div>
						</button>
					);
				})}
			</div>

			{mode !== "human" && (
				<div className="mt-4 gap-3 flex flex-col">
					<div>
						<label className="text-xs font-medium text-foreground/70 mb-1.5 block">
							Agent
						</label>
						<Select
							value={selectedAgentId ?? ""}
							onValueChange={(v) => onChangeAgentId(v === "__none__" ? null : v)}
							disabled={!hasActiveAgents}
						>
							<SelectTrigger>
								<SelectValue placeholder="Pick an agent…" />
							</SelectTrigger>
							<SelectContent>
								{activeAgents.length === 0 && (
									<SelectItem value="__none__" disabled>
										No active agents
									</SelectItem>
								)}
								{activeAgents.map((a) => (
									<SelectItem key={a.id} value={a.id}>
										{a.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					{selectedAgent && (
						<LaunchModePreview
							agentName={selectedAgent.name}
							mode={mode}
							aiSteps={aiStepRows}
							allSteps={allStepRows}
						/>
					)}
				</div>
			)}
		</section>
	);
}

// Preview block: "Steps 1, 3 will be handled by Turnover AI." Renders below the agent
// picker once both a mode and an agent are picked, so the author can confirm at-a-glance
// before launching.
function LaunchModePreview({
	agentName,
	mode,
	aiSteps,
	allSteps,
}: {
	agentName: string;
	mode: LaunchMode;
	aiSteps: ReadonlyArray<{ id: string; title: string; position: number }>;
	allSteps: ReadonlyArray<{ id: string; title: string; position: number }>;
}) {
	const handledSteps = mode === "automated" ? allSteps : aiSteps;
	if (handledSteps.length === 0) return null;

	return (
		<div className="px-3 py-2 rounded-md border border-dashed border-border bg-muted/30">
			<p className="text-xs text-foreground/70 leading-relaxed">
				<span className="font-medium">{agentName}</span>{" "}
				{mode === "automated" ? (
					<>will handle <span className="font-medium">all {handledSteps.length} steps</span>:</>
				) : (
					<>will handle <span className="font-medium">{handledSteps.length}</span>{" "}
					{handledSteps.length === 1 ? "AI step" : "AI steps"}:</>
				)}
			</p>
			<ul className="mt-1.5 gap-0.5 flex flex-col">
				{handledSteps.slice(0, 8).map((s) => (
					<li key={s.id} className="text-[11px] text-foreground/60 truncate">
						• {s.title}
					</li>
				))}
				{handledSteps.length > 8 && (
					<li className="text-[11px] text-foreground/50 italic">
						… and {handledSteps.length - 8} more
					</li>
				)}
			</ul>
		</div>
	);
}
