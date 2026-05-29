// Phase 10 / v1.5c (PRD §6.4) -- canonical workflow detail URL.
//
// `/[orgSlug]/library/workflows/[workflowId]?view={author|read}` is the
// single URL the PRD specifies for any workflow's detail. Physically the two
// views live at sibling routes (`/builder`, `/read`); this bare page is the
// redirect router that honors `?view=` + role default.
//
// Decision matrix lives in `workflow-view-resolution.ts` (pure + unit-tested).

import { redirect } from "next/navigation";

import { resolveWorkflowView } from "@library/lib/workflow-view-resolution";
import { assertCanSee } from "@shared/lib/gating-server";
import { NAV_AREAS } from "@shared/lib/nav";

export const dynamic = "force-dynamic";

export default async function WorkflowDetailRedirectPage({
	params,
	searchParams,
}: {
	params: Promise<{ organizationSlug: string; workflowId: string }>;
	searchParams: Promise<{ view?: string | string[] }>;
}) {
	const { organizationSlug, workflowId } = await params;
	const { view } = await searchParams;

	const { snapshot } = await assertCanSee(organizationSlug, NAV_AREAS.library);

	const { redirectTo } = resolveWorkflowView({
		organizationSlug,
		workflowId,
		viewParam: view,
		isAdminOrOwner: snapshot.isAdminSuperset,
	});

	redirect(redirectTo);
}
