// Phase 15 -- /compliance/acknowledgments/[id] single-receipt view.
//
// Read-only printable evidence proof. Surfaces the canonical compliance proof:
// org / workflow / version / user / timestamp. Includes a per-acknowledgment
// audit timeline below so reviewers can trace any state changes attached to
// this acknowledgment id (today: just the insert; once Phase 16 adds the
// acknowledge action surface, the action will write its own audit row here too).

import { AcknowledgmentReceiptView } from "@compliance/components/AcknowledgmentReceiptView";
import { assertCanSee } from "@shared/lib/gating-server";
import { NAV_AREAS } from "@shared/lib/nav";

export const dynamic = "force-dynamic";
export const metadata = { title: "Acknowledgment receipt" };

export default async function AcknowledgmentReceiptPage({
	params,
}: {
	params: Promise<{ organizationSlug: string; acknowledgmentId: string }>;
}) {
	const { organizationSlug, acknowledgmentId } = await params;
	await assertCanSee(organizationSlug, NAV_AREAS.compliance);

	return (
		<div className="h-full min-h-0 p-4">
			<AcknowledgmentReceiptView
				organizationSlug={organizationSlug}
				acknowledgmentId={acknowledgmentId}
			/>
		</div>
	);
}
