import { getActiveOrganization, getSession } from "@auth/lib/server";
import { OrgConfigurationManagement } from "@organizations/components/OrgConfigurationManagement";
import { isOrganizationAdmin } from "@virn/auth/lib/helper";
import { PageHeader } from "@shared/components/PageHeader";
import { notFound, redirect } from "next/navigation";

export const metadata = {
	title: "Configuration",
};

export default async function OrganizationConfigurationPage({
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
				title="Configuration"
				subtitle="Manage capabilities, settings, and enablement profiles for this organization."
			/>
			<OrgConfigurationManagement />
		</>
	);
}
