import { getActiveOrganization, getSession } from "@auth/lib/server";
import { ListingsPanel } from "@listings/components/ListingsPanel";
import { PageHeader } from "@shared/components/PageHeader";
import { isOrganizationAdmin } from "@virn/auth/lib/helper";
import { notFound } from "next/navigation";

export const metadata = {
	title: "Listings",
};

// /library/listings -- the minimum listings index UI for v1.5a Day 1-2
// (PRD_WORKFLOW_SOP_BUILDER.md §6.1, §11). Per the architecture reframe:
// listing is the first first-class runnable entity (Layer-1 seam); future entity
// types (vendor already lives elsewhere; building/asset/incident from later packs)
// follow the same UI pattern under /library/<entity-set>/.
//
// Read access is org-wide; mutations are admin/owner only. Non-admin members see
// the list but the create button + row menu items wouldn't reach the procedure
// (defense in depth: server gating + the procedures themselves use
// adminOrgProcedure).

export default async function OrganizationListingsPage({
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

	const isAdmin = isOrganizationAdmin(organization, session?.user);

	return (
		<>
			<PageHeader
				title="Listings"
				subtitle="The units this organization manages — short-term rentals, leased apartments, commercial suites, multifamily units. Workflows can be scoped to subsets via entity sets (coming next in v1.5a)."
			/>
			<ListingsPanel canMutate={isAdmin} organizationSlug={organizationSlug} />
		</>
	);
}
