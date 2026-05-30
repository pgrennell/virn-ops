// Phase 16 -- /compliance/suggestions admin triage.
//
// Lists every suggestion in the org with status filter + decide actions
// (accept / reject / merge). The submit path lives on the Read view's
// footer; this is the reviewer-facing triage surface.

import { SuggestionsTriageView } from "@compliance/components/SuggestionsTriageView";
import { assertCanSee } from "@shared/lib/gating-server";
import { NAV_AREAS } from "@shared/lib/nav";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata = { title: "Suggestions" };

const STATUS_KEYS = ["open", "accepted", "rejected", "merged"] as const;
type StatusKey = (typeof STATUS_KEYS)[number];

function pickStatus(raw: string | string[] | undefined): StatusKey | undefined {
	const v = Array.isArray(raw) ? raw[0] : raw;
	return (STATUS_KEYS as readonly string[]).includes(v ?? "")
		? (v as StatusKey)
		: undefined;
}

export default async function SuggestionsTriagePage({
	params,
	searchParams,
}: {
	params: Promise<{ organizationSlug: string }>;
	searchParams: Promise<{ status?: string; page?: string }>;
}) {
	const { organizationSlug } = await params;
	const search = await searchParams;
	await assertCanSee(organizationSlug, NAV_AREAS.compliance);

	const initialStatus = pickStatus(search.status);
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
				<SuggestionsTriageView
					organizationSlug={organizationSlug}
					initialStatus={initialStatus}
					initialPage={initialPage}
				/>
			</div>
		</div>
	);
}
