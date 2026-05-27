// Library (UX_SPEC §4.2) -- the builder's home for authored content.
//
// Replaces the placeholder. Two-axis gating per UX_SPEC §2:
//   - assertCanSee(NAV_AREAS.library) handles capability + role visibility.
//   - snapshot.isAdminSuperset gates Create / Continue editing / (future) Archive.
//   - canSee(NAV_AREAS.runs, snapshot) gates the Run row action. Threaded as a
//     separate flag so the resolver's permission contract holds when the custom-
//     role layer (ADR-004) lands -- today every preset role that can see Library
//     can also run, so the flag is true for every reachable caller.
//
// The page stays a thin server shell: snapshot reconstruction + thread flags down.
// All the matrix logic lives in modules/library/lib (testable without React) and
// modules/library/components (the client tree).

import { LibraryView } from "@library/components/LibraryView";
import { canSee } from "@shared/lib/gating";
import { assertCanSee } from "@shared/lib/gating-server";
import { NAV_AREAS } from "@shared/lib/nav";

export const dynamic = "force-dynamic";
export const metadata = { title: "Library" };

export default async function LibraryPage({
	params,
}: {
	params: Promise<{ organizationSlug: string }>;
}) {
	const { organizationSlug } = await params;
	const { snapshot } = await assertCanSee(organizationSlug, NAV_AREAS.library);

	return (
		<div className="h-full min-h-0 p-4">
			<LibraryView
				organizationSlug={organizationSlug}
				isAdminOrOwner={snapshot.isAdminSuperset}
				canRun={canSee(NAV_AREAS.runs, snapshot)}
			/>
		</div>
	);
}
