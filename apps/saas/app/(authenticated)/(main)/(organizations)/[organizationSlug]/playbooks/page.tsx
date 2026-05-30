// Phase 18a -- /playbooks list page. Mirrors the library page shape: thin
// server shell that gates + threads the snapshot down to the client view.

import { PlaybooksListView } from "@playbooks/components/PlaybooksListView";
import { assertCanSee } from "@shared/lib/gating-server";
import { NAV_AREAS } from "@shared/lib/nav";

export const dynamic = "force-dynamic";
export const metadata = { title: "Playbooks" };

export default async function PlaybooksPage({
	params,
}: {
	params: Promise<{ organizationSlug: string }>;
}) {
	const { organizationSlug } = await params;
	const { snapshot } = await assertCanSee(organizationSlug, NAV_AREAS.playbooks);

	return (
		<div className="h-full min-h-0 p-4">
			<PlaybooksListView
				organizationSlug={organizationSlug}
				isAdminOrOwner={snapshot.isAdminSuperset}
			/>
		</div>
	);
}
