import { getActiveOrganization, getSession } from "@auth/lib/server";
import { PageHeader } from "@shared/components/PageHeader";
import { ReviewInboxPanel } from "@builder/components/ReviewInboxPanel";
import { isOrganizationAdmin } from "@virn/auth/lib/helper";
import { getOrganizationById } from "@virn/database";
import { notFound, redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export const metadata = {
	title: "Review inbox",
};

// /library/reviews -- admin-only concierge-review inbox (Phase 9.5g / PRD §6.6).
// Lists workflows currently in review_state='in_review' so admins can triage,
// approve, or send back from one screen. Non-admin members redirect to
// /library/listings (the procedure layer's adminOrgProcedure refuses the
// underlying call anyway; the redirect avoids a dead-end UI).
//
// When the org doesn't have requireConciergeReview enabled, the page still
// works -- the list will just always be empty. Surfaces a hint about enabling
// the flag in that case.

export default async function ConciergeReviewInboxPage({
	params,
}: {
	params: Promise<{ organizationSlug: string }>;
}) {
	const session = await getSession();
	const { organizationSlug } = await params;
	const organization = await getActiveOrganization(organizationSlug);

	if (!organization) {
		return notFound();
	}
	if (!isOrganizationAdmin(organization, session?.user)) {
		return redirect(`/${organizationSlug}/library/listings`);
	}

	// Read the concierge-review flag for the empty-state hint. Better Auth's
	// ActiveOrganization doesn't include custom columns; read direct from the row.
	const orgRow = await getOrganizationById(organization.id);
	const requireConciergeReview = orgRow?.requireConciergeReview ?? false;

	return (
		<>
			<PageHeader
				title="Review inbox"
				subtitle="Workflows submitted for concierge review. Approve to publish, or send back to draft with a note."
			/>
			<ReviewInboxPanel
				organizationSlug={organizationSlug}
				requireConciergeReview={requireConciergeReview}
			/>
		</>
	);
}
