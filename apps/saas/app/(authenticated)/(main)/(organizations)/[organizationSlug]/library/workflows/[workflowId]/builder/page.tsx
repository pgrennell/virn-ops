// Workflow Builder canvas (Pass 2 of UX_SPEC §4.3).
//
// Routing intent: the URL is workflow-scoped, not version-scoped. The BuilderView
// client decides which version to open (draft if one exists, latest published
// otherwise) and threads the "Edit" action through workflows.editPublished, which
// resumes-or-forks per D-018. Discarding a draft / publishing it / forking a fresh
// draft never changes the URL.

import { BuilderView } from "@builder/components/BuilderView";
import { assertCanSee } from "@shared/lib/gating-server";
import { NAV_AREAS } from "@shared/lib/nav";

export const dynamic = "force-dynamic";
export const metadata = { title: "Workflow Builder" };

export default async function WorkflowBuilderPage({
	params,
}: {
	params: Promise<{ organizationSlug: string; workflowId: string }>;
}) {
	const { organizationSlug, workflowId } = await params;
	// Gated under the Build area (Library is the Build entry; the Builder sits inside).
	// adminOrgProcedure on the API layer further rejects writes from non-admin/owner
	// callers, but the page itself is reachable by any user who can see Library --
	// they get the view-only render with no Edit button (canEdit gates on the action).
	await assertCanSee(organizationSlug, NAV_AREAS.library);

	return (
		<div className="h-full min-h-0 p-4">
			<BuilderView workflowId={workflowId} />
		</div>
	);
}
