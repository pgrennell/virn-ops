"use client";

// ListingsPanel — top-level client component for /library/listings. Mirrors the
// VendorsPanel pattern: list query, loading/empty/error states, create button +
// dialog, per-row menu. v1.5a Day 1-2 minimum surface — entity-set assignment
// chips, cohort filter pills, and the launcher integration land in days 3-5.

import { Button } from "@virn/ui/components/button";
import { Spinner } from "@virn/ui/components/spinner";
import { useQuery } from "@tanstack/react-query";
import { Home, Plus } from "lucide-react";
import { useMemo, useState } from "react";

import { orpc } from "@shared/lib/orpc-query-utils";

import { CreateListingDialog } from "./CreateListingDialog";
import { ListingRowMenu } from "./ListingRowMenu";

interface ListingsPanelProps {
	canMutate: boolean;
	organizationSlug: string;
}

const PROPERTY_TYPE_LABELS: Record<string, string> = {
	str: "STR",
	ltr: "Long-term residential",
	commercial: "Commercial",
	multifamily: "Multifamily",
	mixed_use: "Mixed-use",
};

function propertyTypeLabel(value: string | null): string | null {
	if (!value) return null;
	return PROPERTY_TYPE_LABELS[value] ?? value;
}

export function ListingsPanel({ canMutate, organizationSlug }: ListingsPanelProps) {
	const listingsQuery = useQuery(orpc.listings.list.queryOptions({ input: {} }));
	const [createOpen, setCreateOpen] = useState(false);

	const listings = listingsQuery.data ?? [];

	// Phase 9.5f: batched chip badges. One query per listings-list render,
	// returning the set memberships keyed by listing id. Enabled only when we
	// actually have listings to look up (avoids a no-op POST on an empty page).
	const listingIds = useMemo(() => listings.map((l) => l.id), [listings]);
	const tagsQuery = useQuery({
		...orpc.entitySets.listForEntities.queryOptions({
			input: { entityType: "listing", entityIds: listingIds },
		}),
		enabled: listingIds.length > 0,
	});
	const tagsByListing = tagsQuery.data ?? {};

	return (
		<>
			<div className="gap-4 flex items-start justify-between mb-6">
				<div>
					<h2 className="font-medium text-lg mb-1">Listings</h2>
					<p className="text-sm text-foreground/60 max-w-2xl leading-relaxed">
						Properties this organization manages. Each listing can later belong to one
						or more entity sets (e.g. "Pet-Friendly Homes", "Beachfront", "Class A
						Office") so workflows can scope themselves to the right subset.
					</p>
				</div>
				{canMutate && (
					<Button
						variant="primary"
						size="sm"
						onClick={() => setCreateOpen(true)}
						className="shrink-0"
					>
						<Plus className="size-3.5 mr-1.5" />
						New listing
					</Button>
				)}
			</div>

			{listingsQuery.isLoading && (
				<div className="py-12 text-foreground/50 gap-2 flex items-center justify-center">
					<Spinner className="size-4" />
					<span className="text-sm">Loading listings…</span>
				</div>
			)}

			{listingsQuery.isError && (
				<div className="py-8 text-sm text-destructive">
					Couldn't load listings. {listingsQuery.error?.message}
				</div>
			)}

			{!listingsQuery.isLoading &&
				!listingsQuery.isError &&
				listings.length === 0 && (
					<div className="py-16 px-6 rounded-md border border-dashed border-border gap-3 flex flex-col items-center text-center">
						<Home className="size-8 text-foreground/40" />
						<div>
							<p className="font-medium text-sm">No listings yet</p>
							<p className="mt-1 text-xs text-foreground/60 max-w-sm">
								Add a listing for each property you manage. Workflows will be launchable
								from a listing context (e.g. "run turnover for 123 Beach Dr").
							</p>
						</div>
						{canMutate && (
							<Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
								<Plus className="size-3.5 mr-1.5" />
								Add your first listing
							</Button>
						)}
					</div>
				)}

			{listings.length > 0 && (
				<ul className="divide-y divide-border border border-border rounded-md overflow-hidden">
					{listings.map((l) => {
						const typeLabel = propertyTypeLabel(l.propertyType);
						const tags = tagsByListing[l.id] ?? [];
						return (
							<li
								key={l.id}
								className="px-4 py-3 gap-3 flex items-center bg-background hover:bg-muted/30 transition-colors"
							>
								<a
									href={`/${organizationSlug}/library/listings/${l.id}`}
									className="size-9 shrink-0 rounded-md bg-muted gap-0 flex items-center justify-center"
									aria-label={`Open ${l.name}`}
								>
									<Home className="size-4 text-foreground/70" />
								</a>
								<a
									href={`/${organizationSlug}/library/listings/${l.id}`}
									className="flex-1 min-w-0 gap-0.5 flex flex-col"
								>
									<div className="gap-2 flex items-center flex-wrap">
										<span className="font-medium text-sm truncate">{l.name}</span>
										{typeLabel && (
											<span className="shrink-0 px-1.5 py-0.5 text-[10px] rounded bg-muted text-foreground/70 font-medium uppercase tracking-wide">
												{typeLabel}
											</span>
										)}
										{tags.map((t) => (
											<span
												key={t.id}
												className="shrink-0 px-1.5 py-0.5 text-[10px] rounded font-medium gap-1 inline-flex items-center"
												style={{
													backgroundColor: t.color
														? `${t.color}20` // 12.5% opacity tint
														: "var(--muted)",
													color: "var(--foreground)",
												}}
												title={`Entity set: ${t.name}`}
											>
												<span
													className="size-1.5 rounded-full"
													style={{
														backgroundColor: t.color ?? "var(--foreground)",
													}}
												/>
												{t.name}
											</span>
										))}
									</div>
									{l.description && (
										<p className="text-xs text-foreground/60 truncate">
											{l.description}
										</p>
									)}
									<p className="text-[11px] text-foreground/40">
										{l.externalListingId && (
											<>
												<span className="font-mono">{l.externalListingId}</span>
												{l.createdByUserName && " · "}
											</>
										)}
										{l.createdByUserName && <>added by {l.createdByUserName}</>}
									</p>
								</a>
								{canMutate && (
									<ListingRowMenu
										listingId={l.id}
										listingName={l.name}
										description={l.description}
										propertyType={l.propertyType}
										externalListingId={l.externalListingId}
										organizationSlug={organizationSlug}
									/>
								)}
							</li>
						);
					})}
				</ul>
			)}

			{canMutate && (
				<CreateListingDialog open={createOpen} onOpenChange={setCreateOpen} />
			)}
		</>
	);
}
