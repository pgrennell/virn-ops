"use client";

// Phase 10 / v1.5c (PRD §6.5 / R6 lift) -- listing detail page.
//
// Minimum-viable listing detail view: identifying header (name, property
// type chip, external-id), description, address block, audit footer, plus
// the Active Run right-rail card that surfaces in-flight runs whose
// entity context matches this listing.
//
// What this is NOT (deliberately deferred):
//
// - Launcher button. Wiring a "Launch a workflow on this listing" CTA to
//   pre-populate runs.launch.entityContext={type:'listing', id} is a
//   follow-up slice. Until it lands, the Active Run card will show empty
//   for any listing because no existing runs were stamped with entity
//   context. That's honest -- the card surface and the launcher surface
//   are independent investments and we're shipping the card first so the
//   Read view + per-run timeline get an in-product entry point as soon as
//   anyone DOES launch a run with entity context (via the API directly
//   or via PM's cross-product launch path, both of which already accept
//   entityContext as of R6).
// - Edit affordance (UpsertListingDialog wiring). The listings index page
//   has Create/Edit/Delete dialogs; replicating them here is a copy task,
//   not a design task, so it's deferred until there's a real ergonomic
//   need.
// - Entity-set membership chips. Coming with the v1.5a entity-set picker
//   surface.

import { Alert, AlertDescription } from "@virn/ui/components/alert";
import { Button } from "@virn/ui/components/button";
import { Spinner } from "@virn/ui/components/spinner";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Home, MapPin } from "lucide-react";

import { orpc } from "@shared/lib/orpc-query-utils";

import { ActiveRunCard } from "./ActiveRunCard";

interface ListingDetailViewProps {
	listingId: string;
	organizationSlug: string;
}

export function ListingDetailView({
	listingId,
	organizationSlug,
}: ListingDetailViewProps) {
	const query = useQuery(orpc.listings.get.queryOptions({ input: { id: listingId } }));

	if (query.isLoading) {
		return (
			<div className="flex items-center justify-center gap-3 py-24 text-foreground/60">
				<Spinner className="size-4" /> Loading listing…
			</div>
		);
	}
	if (query.isError || !query.data) {
		return (
			<div className="mx-auto max-w-md px-5 py-16 text-center flex flex-col items-center gap-3">
				<Home className="size-8 text-foreground/30" />
				<h1 className="text-lg font-semibold">Listing not found</h1>
				<p className="text-sm text-foreground/60">
					This listing may have been deleted or moved.
				</p>
				<Button asChild variant="ghost" size="sm">
					<a href={`/${organizationSlug}/library/listings`}>
						<ArrowLeft className="size-3.5 mr-1.5" />
						Back to Listings
					</a>
				</Button>
			</div>
		);
	}

	const listing = query.data;
	const address = formatAddress(listing.address);

	return (
		<article className="mx-auto max-w-6xl px-4 py-6 flex flex-col gap-6">
			<nav className="text-xs text-foreground/50">
				<a
					href={`/${organizationSlug}/library/listings`}
					className="inline-flex items-center gap-1 hover:text-foreground/70 transition-colors"
				>
					<ArrowLeft className="size-3" /> Listings
				</a>
			</nav>

			<header className="flex flex-col gap-2">
				<div className="flex items-center gap-2 flex-wrap">
					<h1 className="text-2xl font-semibold">{listing.name}</h1>
					{listing.propertyType && (
						<span className="px-2 py-0.5 text-[10px] uppercase tracking-wide font-medium rounded bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-300">
							{listing.propertyType}
						</span>
					)}
					{listing.externalListingId && (
						<span
							className="px-2 py-0.5 text-[10px] font-mono rounded bg-foreground/5 text-foreground/60"
							title="External system identifier (Hospitable, Guesty, OwnerRez, etc.)"
						>
							ext: {listing.externalListingId}
						</span>
					)}
				</div>
				{listing.description && (
					<p className="text-sm text-foreground/70 whitespace-pre-wrap">
						{listing.description}
					</p>
				)}
			</header>

			<div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
				<div className="flex flex-col gap-6 min-w-0">
					{address && (
						<section className="rounded-lg border border-border bg-background p-4">
							<h2 className="text-xs uppercase tracking-wider font-semibold text-foreground/60 flex items-center gap-1.5 mb-2">
								<MapPin className="size-3.5" /> Address
							</h2>
							<address className="not-italic text-sm text-foreground/80 whitespace-pre-line">
								{address}
							</address>
						</section>
					)}

					<Alert>
						<AlertDescription className="text-xs leading-relaxed">
							Workflows launched against this listing with entity context will
							appear on the right. Use <code>runs.launch</code> with
							<code> entityContext: {`{ entityType: "listing", entityId: "${listing.id}" }`}</code>
							{" "}to bind a new run to this listing (the in-product launcher
							button is a follow-up slice).
						</AlertDescription>
					</Alert>

					<section className="text-[10px] uppercase tracking-wide text-foreground/40 flex flex-col gap-0.5">
						<span>
							Created{" "}
							{new Date(listing.createdAt).toLocaleDateString()}
							{listing.createdByUserName && ` by ${listing.createdByUserName}`}
						</span>
						<span>
							Updated {new Date(listing.updatedAt).toLocaleDateString()}
						</span>
					</section>
				</div>

				<aside className="flex flex-col gap-4">
					<ActiveRunCard
						organizationSlug={organizationSlug}
						entityType="listing"
						entityId={listing.id}
					/>
				</aside>
			</div>
		</article>
	);
}

/** Format a JSON address shape into multi-line plain text. The address column
 * is `jsonb` and the shape isn't locked (PRD §6.5 says "iterate as customers
 * tell us which fields matter"); we read the common keys and skip missing
 * ones. Returns null when there's nothing renderable. */
function formatAddress(address: Record<string, unknown> | null | undefined): string | null {
	if (!address || typeof address !== "object") return null;
	const street = typeof address.street === "string" ? address.street : null;
	const city = typeof address.city === "string" ? address.city : null;
	const region = typeof address.region === "string" ? address.region : null;
	const postal = typeof address.postal === "string" ? address.postal : null;
	const country = typeof address.country === "string" ? address.country : null;
	const lines: string[] = [];
	if (street) lines.push(street);
	const cityRegionPostal = [city, region, postal].filter(Boolean).join(", ");
	if (cityRegionPostal) lines.push(cityRegionPostal);
	if (country) lines.push(country);
	return lines.length > 0 ? lines.join("\n") : null;
}
