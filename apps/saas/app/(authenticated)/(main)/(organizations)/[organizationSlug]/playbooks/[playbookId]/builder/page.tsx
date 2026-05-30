// Phase 18a -- Playbook Builder route. Renders the open draft of a playbook
// for editing. Admin-only via NAV_AREAS.playbooks (builder/admin/owner). The
// client view handles the resume-or-fork dance via `playbooks.editPublished`
// when the playbook has no current draft (e.g. it was just published and the
// admin clicks Edit).

import { PlaybookBuilderView } from "@playbooks/components/PlaybookBuilderView";
import { assertCanSee } from "@shared/lib/gating-server";
import { NAV_AREAS } from "@shared/lib/nav";

export const dynamic = "force-dynamic";
export const metadata = { title: "Playbook Builder" };

export default async function PlaybookBuilderPage({
	params,
}: {
	params: Promise<{ organizationSlug: string; playbookId: string }>;
}) {
	const { organizationSlug, playbookId } = await params;
	const { snapshot } = await assertCanSee(organizationSlug, NAV_AREAS.playbooks);

	return (
		<div className="h-full min-h-0 p-4">
			<PlaybookBuilderView
				playbookId={playbookId}
				organizationSlug={organizationSlug}
				isAdminOrOwner={snapshot.isAdminSuperset}
			/>
		</div>
	);
}
