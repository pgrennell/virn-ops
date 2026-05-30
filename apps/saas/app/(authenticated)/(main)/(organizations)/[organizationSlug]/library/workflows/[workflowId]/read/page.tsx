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
//   - assertCanSee(NAV_AREAS.sop) -- the reader-grade gate. Operators,
//     builders, reviewers, admins, and owners all pass; cross-org access
//     refuses with the standard not-found shape.
//     (The original gating used NAV_AREAS.library, which excludes
//     operators and locked out the very audience the Read view was built
//     for -- Antigravity REPORT 2026-05-29 §4.)
//   - All org members can mark-as-read per PRD §6.4 (passive signal).
//   - Admin/owner-only affordances (Edit toggle, reader count) are
//     handled client-side via the `isAdminOrOwner` prop below.

import { ReadView } from "@builder/components/ReadView";
import { canSee } from "@shared/lib/gating";
import { assertCanSee } from "@shared/lib/gating-server";
import { NAV_AREAS } from "@shared/lib/nav";

export const dynamic = "force-dynamic";
export const metadata = { title: "Workflow (Read)" };

export default async function WorkflowReadPage({
	params,
	searchParams,
}: {
	params: Promise<{ organizationSlug: string; workflowId: string }>;
	searchParams: Promise<{ runId?: string | string[] }>;
}) {
	const { organizationSlug, workflowId } = await params;
	const { runId: runIdRaw } = await searchParams;
	const { snapshot } = await assertCanSee(organizationSlug, NAV_AREAS.sop);

	// R5 cont. -- when ?runId is present (typically from clicking an Active Run
	// card), the Read view's right column flips from the generic flowchart to a
	// per-run activity timeline. We normalize the param here so the client
	// component receives a clean `string | null`.
	const runId = typeof runIdRaw === "string" && runIdRaw.length > 0 ? runIdRaw : null;

	return (
		<div className="h-full min-h-0 p-4">
			<ReadView
				workflowId={workflowId}
				organizationSlug={organizationSlug}
				isAdminOrOwner={snapshot.isAdminSuperset}
				runId={runId}
				canSeeRuns={canSee(NAV_AREAS.runs, snapshot)}
				canSeeCompliance={canSee(NAV_AREAS.compliance, snapshot)}
			/>
		</div>
	);
}
