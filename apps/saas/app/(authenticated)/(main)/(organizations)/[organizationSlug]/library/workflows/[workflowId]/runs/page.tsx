// Phase 14 -- per-workflow Runs surface.
//
// Sibling route to /builder and /read. Architectural boundary (PRD §1.2 / D-039):
// Author/Read are "two views of one object" (the three-views unification with the
// SOP/KB rendering); Runs are *instances* of that object, not a view of it. So
// Runs is its own tab in the workflow detail header, NOT a third segment of the
// view-switcher.
//
// Permission gating: this page gates on NAV_AREAS.runs -- the Runs link only
// appears in the Builder/Read headers when canSee(runs, snapshot), so anyone
// landing here has at least that. The page also calls notFound() when the
// workflow doesn't exist in the current org.

import { WorkflowRunsTabLink } from "@builder/components/WorkflowRunsTabLink";
import { WorkflowViewToggle } from "@builder/components/WorkflowViewToggle";
import { RunsMonitorView } from "@runs/components/RunsMonitorView";
import { canSee } from "@shared/lib/gating";
import { assertCanSee } from "@shared/lib/gating-server";
import { NAV_AREAS } from "@shared/lib/nav";
import { getWorkflowForOrg } from "@virn/database";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";
export const metadata = { title: "Workflow Runs" };

const VIEW_KEYS = ["all", "active", "needs_attention", "completed"] as const;
type ViewKey = (typeof VIEW_KEYS)[number];

const SORT_KEYS = [
	"started_desc",
	"started_asc",
	"due_asc",
	"due_desc",
	"completed_desc",
] as const;
type SortKey = (typeof SORT_KEYS)[number];

function pickView(raw: string | string[] | undefined): ViewKey {
	const v = Array.isArray(raw) ? raw[0] : raw;
	return (VIEW_KEYS as readonly string[]).includes(v ?? "")
		? (v as ViewKey)
		: "active";
}

function pickSort(raw: string | string[] | undefined): SortKey {
	const v = Array.isArray(raw) ? raw[0] : raw;
	return (SORT_KEYS as readonly string[]).includes(v ?? "")
		? (v as SortKey)
		: "started_desc";
}

export default async function WorkflowRunsPage({
	params,
	searchParams,
}: {
	params: Promise<{ organizationSlug: string; workflowId: string }>;
	searchParams: Promise<{ view?: string; sort?: string; page?: string }>;
}) {
	const { organizationSlug, workflowId } = await params;
	const search = await searchParams;
	const { organization, snapshot } = await assertCanSee(organizationSlug, NAV_AREAS.runs);

	const workflow = await getWorkflowForOrg(organization.id, workflowId);
	if (!workflow) notFound();

	const initialView = pickView(search.view);
	const initialSort = pickSort(search.sort);
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
						Every run of this workflow, with status + due + progress.
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
							active={true}
						/>
					)}
				</div>
			</header>

			<div className="flex-1 min-h-0">
				<RunsMonitorView
					organizationSlug={organizationSlug}
					initialView={initialView}
					initialSort={initialSort}
					initialPage={initialPage}
					scopeWorkflowId={workflowId}
				/>
			</div>
		</div>
	);
}
