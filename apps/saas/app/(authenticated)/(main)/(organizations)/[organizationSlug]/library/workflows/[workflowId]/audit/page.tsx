// Phase 15 -- per-workflow audit timeline (S-10).
//
// Sibling route to /builder, /read, /runs. Same architectural posture as the
// Phase 14 Runs surface: Audit is an instances-of-the-object surface (the
// workflow's lifecycle history), NOT a view of the object -- so it gets its
// own pill in the header, not a third segment of the view-switcher.
//
// Gating: assertCanSee(NAV_AREAS.compliance) composes capability=compliance.pack
// + role in {reviewer, admin, owner}. Orgs without the capability 404 here;
// non-admin/non-reviewer members 404 here. The page also calls notFound()
// when the workflow doesn't exist in the current org.

import { WorkflowAuditTabLink } from "@builder/components/WorkflowAuditTabLink";
import { WorkflowRunsTabLink } from "@builder/components/WorkflowRunsTabLink";
import { WorkflowViewToggle } from "@builder/components/WorkflowViewToggle";
import { AuditTimelineView } from "@compliance/components/AuditTimelineView";
import { canSee } from "@shared/lib/gating";
import { assertCanSee } from "@shared/lib/gating-server";
import { NAV_AREAS } from "@shared/lib/nav";
import { getWorkflowForOrg } from "@virn/database";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";
export const metadata = { title: "Workflow Audit" };

export default async function WorkflowAuditPage({
	params,
	searchParams,
}: {
	params: Promise<{ organizationSlug: string; workflowId: string }>;
	searchParams: Promise<{ page?: string }>;
}) {
	const { organizationSlug, workflowId } = await params;
	const search = await searchParams;
	const { organization, snapshot } = await assertCanSee(
		organizationSlug,
		NAV_AREAS.compliance,
	);

	const workflow = await getWorkflowForOrg(organization.id, workflowId);
	if (!workflow) notFound();

	const pageNum = Number.parseInt(
		Array.isArray(search.page) ? (search.page[0] ?? "1") : (search.page ?? "1"),
		10,
	);
	const initialPage = Number.isFinite(pageNum) && pageNum >= 1 ? pageNum : 1;

	return (
		<div className="h-full min-h-0 p-4 gap-4 flex flex-col">
			<header className="flex items-center justify-between gap-3">
				<div className="min-w-0">
					<h1 className="font-medium text-sm truncate">{workflow.title}</h1>
					<p className="text-xs text-foreground/60 mt-0.5">
						Lifecycle history. Every state change with the actor + diff for forensic review.
					</p>
				</div>
				<div className="shrink-0 flex items-center gap-2">
					{snapshot.isAdminSuperset && (
						<WorkflowViewToggle
							organizationSlug={organizationSlug}
							workflowId={workflowId}
							active="other"
						/>
					)}
					{canSee(NAV_AREAS.runs, snapshot) && (
						<WorkflowRunsTabLink
							organizationSlug={organizationSlug}
							workflowId={workflowId}
							active={false}
						/>
					)}
					<WorkflowAuditTabLink
						organizationSlug={organizationSlug}
						workflowId={workflowId}
						active={true}
					/>
				</div>
			</header>

			<div className="flex-1 min-h-0 rounded-lg border border-border bg-background overflow-hidden">
				<AuditTimelineView
					entityType="workflow"
					entityId={workflowId}
					initialPage={initialPage}
					emptyStateLabel="No audit history for this workflow yet."
				/>
			</div>
		</div>
	);
}
