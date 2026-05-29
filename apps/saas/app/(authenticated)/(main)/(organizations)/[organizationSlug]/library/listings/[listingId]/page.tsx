// Phase 10 / v1.5c (PRD §6.5 / R6 lift) -- listing detail page.
//
// Minimum-viable entity-context surface for the v1 STR pack. Ships the
// Active Run right-rail card promised by R6; the listing header + address
// block exist so the right-rail card has a real surface to hang off of.
//
// Gating: same `NAV_AREAS.library` as the listings index. Listings are
// authoring/admin content -- operators don't need to browse them (the SOP
// surface at /sop is where operators go). Cross-org access refuses with a
// not-found-shaped 404 via assertCanSee.

import { ListingDetailView } from "@listings/components/ListingDetailView";
import { assertCanSee } from "@shared/lib/gating-server";
import { NAV_AREAS } from "@shared/lib/nav";

export const dynamic = "force-dynamic";
export const metadata = { title: "Listing" };

export default async function ListingDetailPage({
	params,
}: {
	params: Promise<{ organizationSlug: string; listingId: string }>;
}) {
	const { organizationSlug, listingId } = await params;
	await assertCanSee(organizationSlug, NAV_AREAS.library);

	return (
		<div className="h-full min-h-0 p-4">
			<ListingDetailView
				listingId={listingId}
				organizationSlug={organizationSlug}
			/>
		</div>
	);
}
