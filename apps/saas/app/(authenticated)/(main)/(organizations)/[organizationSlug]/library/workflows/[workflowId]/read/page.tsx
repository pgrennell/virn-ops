// Workflow Read view (Phase 10 / v1.5c, PRD §6.4).
//
// Three-views unification: the same workflow_version that the Author view
// edits and the run engine launches renders here as an SOP/KB article.
// Read-only -- no "Start a run" button per PRD §6.4 (runs launch from
// listings / triggers / runs index, not from the reader surface).
//
// Routing intent: sibling to `/builder`. URL is workflow-scoped, not
// version-scoped -- the ReadView client picks the latest published version.
// Drafts NEVER render here (they're editor state, not yet a publication
// per Invariant #4). If no published version exists, the view shows an
// empty state pointing back to the builder.
//
// Permission gating:
//   - assertCanSee(NAV_AREAS.library) -- same gate as the builder. The Read
//     view is part of the library surface; cross-org or no-library-access
//     users get 404.
//   - All org members see the Read view (no admin restriction).
//     `mark-as-read` is open to all members per PRD §6.4 (passive signal).

import { ReadView } from "@builder/components/ReadView";
import { assertCanSee } from "@shared/lib/gating-server";
import { NAV_AREAS } from "@shared/lib/nav";

export const dynamic = "force-dynamic";
export const metadata = { title: "Workflow (Read)" };

export default async function WorkflowReadPage({
	params,
}: {
	params: Promise<{ organizationSlug: string; workflowId: string }>;
}) {
	const { organizationSlug, workflowId } = await params;
	const { snapshot } = await assertCanSee(organizationSlug, NAV_AREAS.library);

	return (
		<div className="h-full min-h-0 p-4">
			<ReadView
				workflowId={workflowId}
				organizationSlug={organizationSlug}
				isAdminOrOwner={snapshot.isAdminSuperset}
			/>
		</div>
	);
}
