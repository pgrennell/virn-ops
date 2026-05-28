import { getActiveOrganization, getSession } from "@auth/lib/server";
import { EntitySetsPanel } from "@entitysets/components/EntitySetsPanel";
import { PageHeader } from "@shared/components/PageHeader";
import { isOrganizationAdmin } from "@virn/auth/lib/helper";
import { notFound, redirect } from "next/navigation";

export const metadata = {
	title: "Entity sets",
};

// /library/entity-sets -- admin/owner-only entity-set management (Phase 9.5f /
// PRD §6.1, §6.3). Entity sets are the Layer-1 categorization primitive: cohorts
// of entities (today only 'listing'; future packs add 'vendor' / 'building' /
// etc. without schema migration) that workflows scope themselves against
// (Phase 9.5e Scope panel reads this catalog).
//
// Non-admin members redirect to /library (the Library hub) since entity-set
// management is a privileged surface -- mutations are gated at the procedure
// layer too (defense in depth).
//
// Same pattern as /library/listings: direct URL today, joined into a unified
// Library hub navigation later (per the Day 1-2 commit note).

export default async function OrganizationEntitySetsPage({
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
		// Non-admin members can READ entity sets via the Scope panel (workflow Builder)
		// or the listing chip badges, but the management surface is admin-only. Bouncing
		// them to /library keeps the URL stable while making the gating visible.
		return redirect(`/${organizationSlug}/library/listings`);
	}

	return (
		<>
			<PageHeader
				title="Entity sets"
				subtitle="Reusable cohorts of entities you can scope workflows to. Today you can group listings (STR penthouses, beachfront, Class-A office, etc.); future packs add more entity types."
			/>
			<EntitySetsPanel organizationSlug={organizationSlug} />
		</>
	);
}
