import { getSession } from "@auth/lib/server";
import { OnboardingModePicker } from "@onboarding/components/OnboardingModePicker";
import { getOrganizationById, hasOrgCompletedModeSetup } from "@virn/database";
import { AuthWrapper } from "@shared/components/AuthWrapper";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export const metadata = {
	title: "Choose a mode",
};

// Standalone wizard step shown right after CreateOrganizationForm succeeds. Resolves the
// active org from the session (set by CreateOrganizationForm's setActiveOrganization
// call). Redirects defensively:
//   - No session  -> /login
//   - No active org in session -> /new-organization (user hasn't created one)
//   - Org already configured (any organization_capability row exists) -> the
//     Configuration page; we don't re-prompt for mode on already-configured orgs.
export default async function NewOrganizationModePage() {
	const session = await getSession();
	if (!session) {
		redirect("/login");
	}

	const organizationId = session.session.activeOrganizationId;
	if (!organizationId) {
		redirect("/new-organization");
	}

	const organization = await getOrganizationById(organizationId);
	if (!organization) {
		redirect("/new-organization");
	}

	if (await hasOrgCompletedModeSetup(organization.id)) {
		redirect(`/${organization.slug}/settings/configuration`);
	}

	return (
		<AuthWrapper>
			<OnboardingModePicker orgSlug={organization.slug} />
		</AuthWrapper>
	);
}
