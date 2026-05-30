// Phase 15 -- /compliance/acknowledgments index.
//
// Read-only evidence list of every acknowledgment in the org. Row click opens
// the single-receipt view. The acknowledge action (WRITE path) ships in
// Phase 16; this is the audit/evidence reader side.
//
// Gating composes via assertCanSee(NAV_AREAS.compliance):
//   capability=compliance.pack + role in {reviewer, admin, owner}.

import { AcknowledgmentsListView } from "@compliance/components/AcknowledgmentsListView";
import { assertCanSee } from "@shared/lib/gating-server";
import { NAV_AREAS } from "@shared/lib/nav";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "Acknowledgments" };

export default async function AcknowledgmentsPage({
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
				<AcknowledgmentsListView
					organizationSlug={organizationSlug}
					initialPage={initialPage}
				/>
			</div>
		</div>
	);
}
