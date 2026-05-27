import { getActiveOrganization, getSession } from "@auth/lib/server";
import { PageHeader } from "@shared/components/PageHeader";
import { VendorsPanel } from "@vendors/components/VendorsPanel";
import { isOrganizationAdmin } from "@virn/auth/lib/helper";
import { notFound, redirect } from "next/navigation";

export const metadata = {
	title: "Vendors",
};

// /settings/vendors -- admin/owner-only org-scoped vendor management (Phase 8 follow-on,
// ADR-007 + D-023). Non-admin members are redirected to /settings/general -- the
// vendors.* mutation procedures gate at the API layer too (defense in depth), but
// redirecting at the route level avoids dead UI for non-admins.

export default async function OrganizationVendorsPage({
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
				title="Vendors"
				subtitle="Manage third-party businesses (and their contacts) that can be assigned to vendor-fulfilled run steps."
			/>
			<VendorsPanel />
		</>
	);
}
