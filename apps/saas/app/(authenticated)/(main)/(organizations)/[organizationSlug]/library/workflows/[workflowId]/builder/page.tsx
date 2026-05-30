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

import { AiReviewView } from "@builder/components/AiReviewView";
import { BuilderView } from "@builder/components/BuilderView";
import { canSee } from "@shared/lib/gating";
import { assertCanSee } from "@shared/lib/gating-server";
import { NAV_AREAS } from "@shared/lib/nav";
import { getOrganizationById } from "@virn/database";

export const dynamic = "force-dynamic";
export const metadata = { title: "Workflow Builder" };

export default async function WorkflowBuilderPage({
	params,
	searchParams,
}: {
	params: Promise<{ organizationSlug: string; workflowId: string }>;
	searchParams: Promise<{ aiAuthored?: string | string[] }>;
}) {
	const { organizationSlug, workflowId } = await params;
	const { aiAuthored: aiAuthoredRaw } = await searchParams;
	const { organization, snapshot } = await assertCanSee(
		organizationSlug,
		NAV_AREAS.library,
	);

	// Phase 12 follow-up (two-pane review) -- when the URL carries
	// `?aiAuthored=1`, render the review surface instead of the normal
	// Builder. Treat any non-empty value as truthy so future variants
	// ("1" / "true" / "review") don't accidentally fall through.
	const aiAuthoredValue = Array.isArray(aiAuthoredRaw) ? aiAuthoredRaw[0] : aiAuthoredRaw;
	const isAiReview = typeof aiAuthoredValue === "string" && aiAuthoredValue.length > 0;
	if (isAiReview) {
		return (
			<div className="h-full min-h-0">
				<AiReviewView
					workflowId={workflowId}
					organizationSlug={organizationSlug}
				/>
			</div>
		);
	}

	// Serialize the snapshot to the client: Sets don't cross the server/client
	// boundary cleanly, so we hand over the enabled-capability array; BuilderView
	// reconstructs a snapshot client-side via buildGatingSnapshot for the palette
	// gates (UX_SPEC §4.3).
	const enabledCapabilityKeys = [...snapshot.enabledCapabilities];

	// Phase 9.5g (PRD §6.6) -- concierge-review flag. ActiveOrganization (from
	// Better Auth) doesn't include custom columns, so we read directly from the
	// org row. The flag flips the Publish button's behavior to "Submit for review."
	const orgRow = await getOrganizationById(organization.id);
	const requireConciergeReview = orgRow?.requireConciergeReview ?? false;

	return (
		<div className="h-full min-h-0 p-4">
			<BuilderView
				workflowId={workflowId}
				organizationSlug={organizationSlug}
				isAdminOrOwner={snapshot.isAdminSuperset}
				role={snapshot.role}
				enabledCapabilityKeys={enabledCapabilityKeys}
				requireConciergeReview={requireConciergeReview}
				canSeeRuns={canSee(NAV_AREAS.runs, snapshot)}
				canSeeCompliance={canSee(NAV_AREAS.compliance, snapshot)}
			/>
		</div>
	);
}
