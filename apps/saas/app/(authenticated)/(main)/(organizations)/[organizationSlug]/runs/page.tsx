// Phase 14 -- the org-level Lightweight Monitor (S-06).
//
// Server-side gating + initial URL-param hydration. The actual list, tabs,
// filter, and pagination live in RunsMonitorView (client) so URL state can
// drive react-query refetches without a server roundtrip per filter change.
// Type narrowing of searchParams happens here so the view component receives
// already-validated input shapes.

import { RunsMonitorView } from "@runs/components/RunsMonitorView";
import { assertCanSee } from "@shared/lib/gating-server";
import { NAV_AREAS } from "@shared/lib/nav";

export const dynamic = "force-dynamic";
export const metadata = { title: "Runs" };

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

function pickWorkflowId(raw: string | string[] | undefined): string | undefined {
	const v = Array.isArray(raw) ? raw[0] : raw;
	return v && v.length > 0 ? v : undefined;
}

export default async function RunsPage({
	params,
	searchParams,
}: {
	params: Promise<{ organizationSlug: string }>;
	searchParams: Promise<{ view?: string; sort?: string; workflowId?: string; page?: string }>;
}) {
	const { organizationSlug } = await params;
	const search = await searchParams;
	await assertCanSee(organizationSlug, NAV_AREAS.runs);

	const initialView = pickView(search.view);
	const initialSort = pickSort(search.sort);
	const initialWorkflowId = pickWorkflowId(search.workflowId);
	const pageNum = Number.parseInt(
		Array.isArray(search.page) ? (search.page[0] ?? "1") : (search.page ?? "1"),
		10,
	);
	const initialPage = Number.isFinite(pageNum) && pageNum >= 1 ? pageNum : 1;

	return (
		<div className="h-full min-h-0 p-4">
			<RunsMonitorView
				organizationSlug={organizationSlug}
				initialView={initialView}
				initialSort={initialSort}
				initialWorkflowId={initialWorkflowId}
				initialPage={initialPage}
			/>
		</div>
	);
}
