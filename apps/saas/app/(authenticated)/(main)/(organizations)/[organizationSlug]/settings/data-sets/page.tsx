import { getActiveOrganization, getSession } from "@auth/lib/server";
import { DataSetsPanel } from "@datasets/components/DataSetsPanel";
import { PageHeader } from "@shared/components/PageHeader";
import { isOrganizationAdmin } from "@virn/auth/lib/helper";
import { notFound, redirect } from "next/navigation";

export const metadata = {
	title: "Data sets",
};

// /settings/data-sets -- admin/owner-only data set management (Phase 9a, S-02).
// Non-admin members redirect to /settings/general. Mutations are gated at the
// procedure layer too (defense in depth).

export default async function OrganizationDataSetsPage({
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
		return redirect(`/${organizationSlug}/settings/general`);
	}

	return (
		<>
			<PageHeader
				title="Data sets"
				subtitle="Reusable lookup lists for workflow fields -- room types, vendor categories, common SKUs, anything pickable across many workflows."
			/>
			<DataSetsPanel />
		</>
	);
}
