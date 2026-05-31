// Phase 18a -- Playbook Read view. Renders the latest published version as
// a chronological timeline. Distinct from the Workflow Read view (which is
// SOP markdown + flowchart) because Playbooks are inherently time-staged --
// the timeline metaphor matches the data shape (PRD_PLAYBOOKS §6.5).
//
// Gated on NAV_AREAS.playbooks (builder/admin/owner) today. When the /sop
// integration ships, operators reach the same view via /sop -> click playbook.

import { PlaybookReadView } from "@playbooks/components/PlaybookReadView";
import { assertCanSee } from "@shared/lib/gating-server";
import { NAV_AREAS } from "@shared/lib/nav";

export const dynamic = "force-dynamic";
export const metadata = { title: "Playbook" };

export default async function PlaybookReadPage({
	params,
	searchParams,
}: {
	params: Promise<{ organizationSlug: string; playbookId: string }>;
	searchParams: Promise<{ runId?: string }>;
}) {
	const { organizationSlug, playbookId } = await params;
	const { runId } = await searchParams;
	const { snapshot } = await assertCanSee(organizationSlug, NAV_AREAS.playbooks);

	return (
		<div className="h-full min-h-0 p-4">
			<PlaybookReadView
				playbookId={playbookId}
				organizationSlug={organizationSlug}
				isAdminOrOwner={snapshot.isAdminSuperset}
				runId={runId ?? null}
			/>
		</div>
	);
}
