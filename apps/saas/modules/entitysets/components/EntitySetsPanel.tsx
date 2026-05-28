"use client";

// EntitySetsPanel — top-level client component for /library/entity-sets. Mirrors
// the ListingsPanel pattern: list query, loading/empty/error states, create
// button + dialog, per-row menu. Phase 9.5f admin-side surface for the Layer-1
// entity-set primitive (PRD §6.1, §6.3).
//
// Reads via `entitySets.list` (filtered to entity_type='listing' for v1.5 since
// that's the only registered EntityAdapter). When future packs add more entity
// types, this UI extends with a type-filter pill rail above the list -- no
// schema change.

import { Button } from "@virn/ui/components/button";
import { Spinner } from "@virn/ui/components/spinner";
import { useQuery } from "@tanstack/react-query";
import { Plus, Tag } from "lucide-react";
import { useState } from "react";

import { orpc } from "@shared/lib/orpc-query-utils";

import { CreateEntitySetDialog } from "./CreateEntitySetDialog";
import { EntitySetRowMenu } from "./EntitySetRowMenu";

interface EntitySetsPanelProps {
	organizationSlug: string;
}

export function EntitySetsPanel({ organizationSlug }: EntitySetsPanelProps) {
	// v1.5 only has 'listing' as a registered entity type, so we filter for it
	// directly. When more types land, this becomes a tabbed surface or a filter
	// pill rail; the query already accepts an optional entityType arg.
	const setsQuery = useQuery(
		orpc.entitySets.list.queryOptions({ input: { entityType: "listing" } }),
	);
	const [createOpen, setCreateOpen] = useState(false);

	const sets = setsQuery.data ?? [];

	return (
		<>
			<div className="gap-4 flex items-start justify-between mb-6">
				<div>
					<h2 className="font-medium text-lg mb-1">Listing sets</h2>
					<p className="text-sm text-foreground/60 max-w-2xl leading-relaxed">
						Group listings into reusable cohorts. Workflows can scope themselves to
						one or more sets — when a run launches from a listing, only workflows
						whose scope intersects the listing's sets surface in the picker.
					</p>
				</div>
				<Button
					variant="primary"
					size="sm"
					onClick={() => setCreateOpen(true)}
					className="shrink-0"
				>
					<Plus className="size-3.5 mr-1.5" />
					New set
				</Button>
			</div>

			{setsQuery.isLoading && (
				<div className="py-12 text-foreground/50 gap-2 flex items-center justify-center">
					<Spinner className="size-4" />
					<span className="text-sm">Loading entity sets…</span>
				</div>
			)}

			{setsQuery.isError && (
				<div className="py-8 text-sm text-destructive">
					Couldn't load entity sets. {setsQuery.error?.message}
				</div>
			)}

			{!setsQuery.isLoading && !setsQuery.isError && sets.length === 0 && (
				<div className="py-16 px-6 rounded-md border border-dashed border-border gap-3 flex flex-col items-center text-center">
					<Tag className="size-8 text-foreground/40" />
					<div>
						<p className="font-medium text-sm">No entity sets yet</p>
						<p className="mt-1 text-xs text-foreground/60 max-w-sm">
							Create a set like "STR penthouses" or "Class-A office" and then add
							listings to it. Workflows can then scope themselves to that set.
						</p>
					</div>
					<Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
						<Plus className="size-3.5 mr-1.5" />
						Create your first set
					</Button>
				</div>
			)}

			{sets.length > 0 && (
				<ul className="divide-y divide-border border border-border rounded-md overflow-hidden">
					{sets.map((s) => (
						<li
							key={s.id}
							className="px-4 py-3 gap-3 flex items-center bg-background"
						>
							<div
								className="size-9 shrink-0 rounded-md gap-0 flex items-center justify-center"
								style={{
									backgroundColor: s.color ?? undefined,
									// Fallback color when none set: muted background that matches the
									// "no color" picker option. Inline rather than via cn() because the
									// dynamic color overrides Tailwind.
									...(s.color ? {} : { backgroundColor: "var(--muted)" }),
								}}
							>
								<Tag className="size-4 text-foreground/70" />
							</div>
							<div className="flex-1 min-w-0 gap-0.5 flex flex-col">
								<div className="gap-2 flex items-center">
									<span className="font-medium text-sm truncate">{s.name}</span>
									<span className="shrink-0 px-1.5 py-0.5 text-[10px] rounded bg-muted text-foreground/70 font-medium uppercase tracking-wide">
										{s.entityType}
									</span>
								</div>
								{s.description && (
									<p className="text-xs text-foreground/60 truncate">
										{s.description}
									</p>
								)}
								<p className="text-[11px] text-foreground/40">
									{s.memberCount} {s.memberCount === 1 ? "member" : "members"}
								</p>
							</div>
							<EntitySetRowMenu
								entitySetId={s.id}
								entitySetName={s.name}
								color={s.color}
								description={s.description}
								organizationSlug={organizationSlug}
							/>
						</li>
					))}
				</ul>
			)}

			<CreateEntitySetDialog open={createOpen} onOpenChange={setCreateOpen} />
		</>
	);
}
