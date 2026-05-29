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

	// Gate on NAV_AREAS.sop (the wider, reader-grade gate) -- the canonical
	// detail URL is the universal entry point. Admins still reach /builder
	// because the resolver redirects them there, and /builder independently
	// re-asserts NAV_AREAS.library. Operators redirect to /read, which
	// shares this same `sop` gate. (Antigravity REPORT 2026-05-29 §4.)
	const { snapshot } = await assertCanSee(organizationSlug, NAV_AREAS.sop);

	const { redirectTo } = resolveWorkflowView({
		organizationSlug,
		workflowId,
		viewParam: view,
		isAdminOrOwner: snapshot.isAdminSuperset,
	});

	redirect(redirectTo);
}
