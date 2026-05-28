import { getActiveOrganization, getSession } from "@auth/lib/server";
import { ChangeOrganizationNameForm } from "@organizations/components/ChangeOrganizationNameForm";
import { ConciergeReviewCard } from "@organizations/components/ConciergeReviewCard";
import { DeleteOrganizationForm } from "@organizations/components/DeleteOrganizationForm";
import { OrganizationLogoForm } from "@organizations/components/OrganizationLogoForm";
import { SlaSweepCard } from "@organizations/components/SlaSweepCard";
import { StarterContentCard } from "@organizations/components/StarterContentCard";
import { isOrganizationAdmin } from "@virn/auth/lib/helper";
import { getOrganizationById } from "@virn/database";
import { PageHeader } from "@shared/components/PageHeader";
import { SettingsList } from "@shared/components/SettingsList";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

export async function generateMetadata() {
	const t = await getTranslations("organizations.settings");

	return {
		title: t("title"),
	};
}

export default async function OrganizationSettingsPage({
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

	const canManageDeletion = isOrganizationAdmin(organization, session?.user);

	// Phase 9.5g -- read the concierge-review flag for the toggle card. Better
	// Auth's ActiveOrganization doesn't surface custom columns; read direct from
	// the Drizzle row.
	const orgRow = canManageDeletion ? await getOrganizationById(organization.id) : null;
	const initialRequireConciergeReview = orgRow?.requireConciergeReview ?? false;

	const t = await getTranslations("organizations.settings");

	return (
		<>
			<PageHeader title={t("title")} subtitle={t("subtitle")} />

			<SettingsList>
				<OrganizationLogoForm />
				<ChangeOrganizationNameForm />
				{canManageDeletion && (
					<ConciergeReviewCard
						organizationSlug={organizationSlug}
						initialRequireConciergeReview={initialRequireConciergeReview}
					/>
				)}
				{canManageDeletion && <StarterContentCard />}
				{canManageDeletion && <SlaSweepCard />}
				{canManageDeletion && <DeleteOrganizationForm />}
			</SettingsList>
		</>
	);
}
