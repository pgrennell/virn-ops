"use client";

// AgentsPanel -- top-level client component for the /settings/agents page. Orchestrates the
// agent list + create button + the shared CredentialRevealDialog (which surfaces the
// plaintext credential returned by both create + rotate).

import { Button } from "@virn/ui/components/button";
import { Spinner } from "@virn/ui/components/spinner";
import { useQuery } from "@tanstack/react-query";
import { Bot, Plus } from "lucide-react";
import { useState } from "react";

import { orpc } from "@shared/lib/orpc-query-utils";

import { AgentRowMenu } from "./AgentRowMenu";
import { CreateAgentDialog } from "./CreateAgentDialog";
import { CredentialRevealDialog } from "./CredentialRevealDialog";

interface RevealState {
	credential: string;
	agentName: string;
	mode: "created" | "rotated";
}

export function AgentsPanel() {
	const agentsQuery = useQuery(orpc.agents.list.queryOptions({ input: {} }));
	const [createOpen, setCreateOpen] = useState(false);
	const [reveal, setReveal] = useState<RevealState | null>(null);

	const agents = agentsQuery.data ?? [];

	return (
		<>
			<div className="gap-4 flex items-start justify-between mb-6">
				<div>
					<h2 className="font-medium text-lg mb-1">Agents</h2>
					<p className="text-sm text-foreground/60 max-w-2xl leading-relaxed">
						AI principals that can act on this organization's workflows via the MCP surface.
						Each agent has its own credential and capability grants — actions land in the audit
						log attributed to the agent, not to a human user.
					</p>
				</div>
				<Button
					variant="primary"
					size="sm"
					onClick={() => setCreateOpen(true)}
					className="shrink-0"
				>
					<Plus className="size-3.5 mr-1.5" />
					New agent
				</Button>
			</div>

			{agentsQuery.isLoading && (
				<div className="py-12 text-foreground/50 gap-2 flex items-center justify-center">
					<Spinner className="size-4" />
					<span className="text-sm">Loading agents…</span>
				</div>
			)}

			{agentsQuery.isError && (
				<div className="py-8 text-sm text-destructive">
					Couldn't load agents. {agentsQuery.error?.message}
				</div>
			)}

			{!agentsQuery.isLoading && !agentsQuery.isError && agents.length === 0 && (
				<div className="py-16 px-6 rounded-md border border-dashed border-border gap-3 flex flex-col items-center text-center">
					<Bot className="size-8 text-foreground/40" />
					<div>
						<p className="font-medium text-sm">No agents yet</p>
						<p className="mt-1 text-xs text-foreground/60 max-w-sm">
							Create an agent to let an AI principal drive workflow runs via the MCP
							surface. You'll see the credential once on creation.
						</p>
					</div>
					<Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
						<Plus className="size-3.5 mr-1.5" />
						Create your first agent
					</Button>
				</div>
			)}

			{agents.length > 0 && (
				<ul className="divide-y divide-border border border-border rounded-md overflow-hidden">
					{agents.map((a) => (
						<li key={a.id} className="px-4 py-3 gap-3 flex items-center bg-background">
							<div className="size-9 shrink-0 rounded-md bg-muted gap-0 flex items-center justify-center">
								<Bot className={`size-4 ${a.isActive ? "text-foreground/70" : "text-foreground/30"}`} />
							</div>
							<div className="flex-1 min-w-0 gap-0.5 flex flex-col">
								<div className="gap-2 flex items-center">
									<span className="font-medium text-sm truncate">{a.name}</span>
									{!a.isActive && (
										<span className="shrink-0 px-1.5 py-0.5 text-[10px] rounded bg-muted text-foreground/60 font-medium uppercase tracking-wide">
											Disabled
										</span>
									)}
								</div>
								{a.description && (
									<p className="text-xs text-foreground/60 truncate">{a.description}</p>
								)}
								<p className="text-[11px] text-foreground/40">
									Credential{" "}
									<span className="font-mono">…{a.credentialLastFour ?? "????"}</span>
									{a.credentialRotatedAt && (
										<>
											{" · rotated "}
											{new Date(a.credentialRotatedAt).toLocaleDateString()}
										</>
									)}
									{a.createdByUserName && <> · created by {a.createdByUserName}</>}
								</p>
							</div>
							<AgentRowMenu
								agentId={a.id}
								agentName={a.name}
								isActive={a.isActive}
								onCredentialRotated={(r) =>
									setReveal({
										credential: r.plaintextCredential,
										agentName: r.agentName,
										mode: "rotated",
									})
								}
							/>
						</li>
					))}
				</ul>
			)}

			<CreateAgentDialog
				open={createOpen}
				onOpenChange={setCreateOpen}
				onCreated={(r) => {
					setCreateOpen(false);
					setReveal({
						credential: r.plaintextCredential,
						agentName: r.name,
						mode: "created",
					});
				}}
			/>

			<CredentialRevealDialog
				open={reveal !== null}
				credential={reveal?.credential ?? null}
				agentName={reveal?.agentName ?? ""}
				mode={reveal?.mode ?? "created"}
				onConfirm={() => setReveal(null)}
			/>
		</>
	);
}
