"use client";

// Workflow-level settings for the Builder Pass-3 config panel (D-034 / PRD §6.3).
//
// First consumer: the **Scope** panel (Phase 9.5e). Authors pick which entity sets a
// workflow is scoped to; the `runs.launch` per-entity picker then filters this workflow
// in/out per the set-intersection rule (PRD §6.2). Empty selection means "applies to any
// entity" -- the pre-v1.5 default, preserved.
//
// Designed for extension: later workflow-level surfaces (title/description rename,
// review state submit-for-review, type pivot) slot in as additional <Section> blocks
// here without restructuring. Keeping them in one panel beats scattering workflow-level
// controls across multiple drawers.
//
// Why a multi-select chip strip (not <Select multiple>): orgs typically have 5-20 entity
// sets in v1.5; a chip strip is denser, scans faster, and avoids the dropdown's
// "select-and-close" friction that hurts when authors want to toggle several sets.

import { orpc } from "@shared/lib/orpc-query-utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription } from "@virn/ui/components/alert";
import { Button } from "@virn/ui/components/button";
import { Spinner } from "@virn/ui/components/spinner";
import { cn } from "@virn/ui";
import { Check } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

interface WorkflowConfigFormProps {
	workflowId: string;
	workflowTitle: string;
	/** Current scope from the workflow row. `null` is normalized to `[]` for the toggle
	 * state -- the schema default is `'{}'` so null shouldn't appear, but defensive. */
	entitySetIds: string[];
	/** The org's slug, for the deep-link to /library/entity-sets when there are none yet. */
	organizationSlug: string;
	disabled: boolean;
}

export function WorkflowConfigForm({
	workflowId,
	workflowTitle,
	entitySetIds,
	organizationSlug,
	disabled,
}: WorkflowConfigFormProps) {
	return (
		<div className="px-4 py-4 gap-6 flex flex-col">
			<div>
				<p className="text-[11px] uppercase tracking-wide text-foreground/40 font-medium">
					Workflow settings
				</p>
				<p className="text-sm text-foreground/80 mt-1 truncate">{workflowTitle}</p>
			</div>

			<ScopePanel
				workflowId={workflowId}
				entitySetIds={entitySetIds}
				organizationSlug={organizationSlug}
				disabled={disabled}
			/>
		</div>
	);
}

// ---------------------------------------------------------------------------
// ScopePanel -- the entity-set multi-select (Phase 9.5e core)
// ---------------------------------------------------------------------------

interface ScopePanelProps {
	workflowId: string;
	entitySetIds: string[];
	organizationSlug: string;
	disabled: boolean;
}

function ScopePanel({ workflowId, entitySetIds, organizationSlug, disabled }: ScopePanelProps) {
	const queryClient = useQueryClient();

	// Local toggle state. Mirrors `entitySetIds` until the user changes it; the mutation
	// commits on every toggle (no save button -- consistent with the rest of the Builder's
	// instant-save model). On server success we invalidate the workflow query so the next
	// reopen of the panel reflects authoritative state.
	const [selected, setSelected] = useState<Set<string>>(() => new Set(entitySetIds));
	useEffect(() => {
		setSelected(new Set(entitySetIds));
	}, [entitySetIds]);

	const setsQuery = useQuery({
		...orpc.entitySets.list.queryOptions({ input: { entityType: "listing" } }),
	});

	const updateMutation = useMutation({
		...orpc.workflows.update.mutationOptions(),
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: orpc.workflows.get.queryKey({ input: { workflowId } }),
			});
		},
	});

	const isPending = updateMutation.isPending;

	function toggle(id: string) {
		if (disabled || isPending) return;
		const next = new Set(selected);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		setSelected(next);
		updateMutation.mutate({
			workflowId,
			entitySetIds: Array.from(next),
		});
	}

	const sets = setsQuery.data ?? [];

	return (
		<section className="gap-3 flex flex-col">
			<div className="gap-1.5 flex flex-col">
				<div className="gap-2 flex items-center">
					<h4 className="text-xs uppercase tracking-wide text-foreground/60 font-medium">
						Scope
					</h4>
					{isPending && (
						<span className="gap-1 flex items-center text-[11px] text-foreground/50">
							<Spinner className="size-3" /> Saving
						</span>
					)}
					{!isPending && updateMutation.isSuccess && (
						<span className="gap-1 flex items-center text-[11px] text-emerald-700 dark:text-emerald-400">
							<Check className="size-3" /> Saved
						</span>
					)}
				</div>
				<p className="text-xs text-foreground/60 leading-relaxed">
					Pick the entity sets this workflow applies to. The launcher only surfaces
					this workflow when launched from an entity whose set memberships overlap
					this list. Leave empty for "applies to any entity."
				</p>
			</div>

			{updateMutation.isError && (
				<Alert variant="error" className="py-1.5 px-2">
					<AlertDescription className="text-xs">
						Couldn't save scope. {String(updateMutation.error)}
					</AlertDescription>
				</Alert>
			)}

			{setsQuery.isLoading ? (
				<div className="gap-1.5 flex items-center text-xs text-foreground/50">
					<Spinner className="size-3" /> Loading entity sets…
				</div>
			) : setsQuery.isError ? (
				<Alert variant="error" className="py-1.5 px-2">
					<AlertDescription className="text-xs">
						Couldn't load entity sets.
					</AlertDescription>
				</Alert>
			) : sets.length === 0 ? (
				<Alert variant="default" className="py-1.5 px-2">
					<AlertDescription className="text-xs">
						No entity sets exist yet. Create some at{" "}
						<Link
							href={`/${organizationSlug}/library/entity-sets`}
							className="underline hover:text-foreground"
						>
							/library/entity-sets
						</Link>
						{" "}
						and they'll appear here.
					</AlertDescription>
				</Alert>
			) : (
				<div className="gap-1.5 flex flex-wrap">
					{sets.map((s) => {
						const on = selected.has(s.id);
						return (
							<button
								key={s.id}
								type="button"
								onClick={() => toggle(s.id)}
								disabled={disabled || isPending}
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
			)}

			{disabled && (
				<p className="text-[11px] text-foreground/50">
					Edit the draft to change workflow scope.
				</p>
			)}

			{!disabled && sets.length > 0 && selected.size === 0 && (
				<p className="text-[11px] text-foreground/50">
					Empty selection = applies to any entity (preserves pre-v1.5 behavior).
				</p>
			)}

			{!disabled && selected.size > 0 && (
				<div className="gap-1.5 flex">
					<Button
						variant="ghost"
						size="sm"
						onClick={() => {
							setSelected(new Set());
							updateMutation.mutate({ workflowId, entitySetIds: [] });
						}}
						disabled={isPending}
						className="text-foreground/60 hover:text-foreground text-xs"
					>
						Clear scope
					</Button>
				</div>
			)}
		</section>
	);
}
