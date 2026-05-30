// Phase 16 -- /compliance/approvals dashboard.
//
// Read + decide UI for pending version_approval rows. The page gates on
// NAV_AREAS.compliance (which composes compliance.pack capability + role).
// The decide procedure itself is adminOrgProcedure; the dashboard is the
// reviewer-facing surface where approve / reject decisions land.

import { ApprovalsDashboardView } from "@compliance/components/ApprovalsDashboardView";
import { assertCanSee } from "@shared/lib/gating-server";
import { NAV_AREAS } from "@shared/lib/nav";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pending approvals" };

export default async function PendingApprovalsPage({
	params,
	searchParams,
}: {
	params: Promise<{ organizationSlug: string }>;
	searchParams: Promise<{ page?: string }>;
}) {
	const { organizationSlug } = await params;
	const search = await searchParams;
	await assertCanSee(organizationSlug, NAV_AREAS.compliance);

	const pageNum = Number.parseInt(
		Array.isArray(search.page) ? (search.page[0] ?? "1") : (search.page ?? "1"),
		10,
	);
	const initialPage = Number.isFinite(pageNum) && pageNum >= 1 ? pageNum : 1;

	return (
		<div className="h-full min-h-0 p-4 gap-3 flex flex-col">
			<div>
				<Link
					href={`/${organizationSlug}/compliance`}
					className="inline-flex items-center gap-1 text-xs text-foreground/60 hover:text-foreground"
				>
					<ChevronLeft className="size-3" />
					Compliance
				</Link>
			</div>
			<div className="flex-1 min-h-0">
				<ApprovalsDashboardView
					organizationSlug={organizationSlug}
					initialPage={initialPage}
				/>
			</div>
		</div>
	);
}
