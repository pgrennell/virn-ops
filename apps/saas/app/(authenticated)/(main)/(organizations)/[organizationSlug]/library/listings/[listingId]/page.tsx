// Phase 10 / v1.5c (PRD §6.5 / R6 lift) -- listing detail page.
//
// Entity-context surface for the v1 STR pack. Ships:
//   - The Active Run right-rail card promised by R6, plus
//   - A "Launch a workflow on this listing" button that opens a dialog
//     pre-filtering to entity-scoped workflows and stamping entityContext
//     onto the new run.
//
// Gating: same `NAV_AREAS.library` as the listings index. Listings are
// authoring/admin content -- operators don't need to browse them (the SOP
// surface at /sop is where operators go). Cross-org access refuses with a
// not-found-shaped 404 via assertCanSee.

import { ListingDetailView } from "@listings/components/ListingDetailView";
import { canSee, isEnabled } from "@shared/lib/gating";
import { assertCanSee } from "@shared/lib/gating-server";
import { CAPABILITIES, NAV_AREAS } from "@shared/lib/nav";

export const dynamic = "force-dynamic";
export const metadata = { title: "Listing" };

export default async function ListingDetailPage({
	params,
}: {
	params: Promise<{ organizationSlug: string; listingId: string }>;
}) {
	const { organizationSlug, listingId } = await params;
	const { snapshot } = await assertCanSee(organizationSlug, NAV_AREAS.library);

	// Threading the same UX_SPEC §2 axes the /library page reads:
	//   - `canRun` gates the "Launch a workflow" button (members without run
	//     permission see the page but not the launcher entry).
	//   - `agentStepsEnabled` gates the LaunchModePicker inside LauncherForm.
	const canRun = canSee(NAV_AREAS.runs, snapshot);
	const agentStepsEnabled = isEnabled(CAPABILITIES.agentSteps, snapshot);

	return (
		<div className="h-full min-h-0 p-4">
			<ListingDetailView
				listingId={listingId}
				organizationSlug={organizationSlug}
				agentStepsEnabled={agentStepsEnabled}
				canRun={canRun}
			/>
		</div>
	);
}
