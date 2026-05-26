// Workflow Builder canvas (UX_SPEC §4.3).
//
// Routing intent: the URL is workflow-scoped, not version-scoped. The BuilderView
// client decides which version to open (draft if one exists, latest published
// otherwise) and threads the "Edit" action through workflows.editPublished, which
// resumes-or-forks per D-018. Discarding a draft / publishing it / forking a fresh
// draft never changes the URL.
//
// Permission gating (two axes per UX_SPEC §2):
//   - assertCanSee(NAV_AREAS.library) covers the capability + role axes -- a non-
//     member, or a member of an org with library disabled, gets 404.
//   - snapshot.isAdminSuperset is threaded down so the client can render the page
//     HONESTLY for the admin-vs-member axis: members see view-mode with no Edit
//     button; admins see author mode on drafts + the Edit button on published
//     versions. The API's adminOrgProcedure refuses non-admin writes anyway, but
//     the UI must not show controls that silently 403.

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
	const { snapshot } = await assertCanSee(organizationSlug, NAV_AREAS.library);

	return (
		<div className="h-full min-h-0 p-4">
			<BuilderView workflowId={workflowId} isAdminOrOwner={snapshot.isAdminSuperset} />
		</div>
	);
}
