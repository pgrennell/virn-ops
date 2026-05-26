import { getOrganizationList, getSession } from "@auth/lib/server";
import { listPurchases } from "@payments/lib/server";
import { config as authConfig } from "@virn/auth/config";
import { config as paymentsConfig } from "@virn/payments/config";
import { createPurchasesHelper } from "@virn/payments/lib/helper";
import { redirect } from "next/navigation";
import type { PropsWithChildren } from "react";

export default async function MainLayout({ children }: PropsWithChildren) {
	const session = await getSession();

	if (!session) {
		redirect("/login");
	}

	if (authConfig.users.enableOnboarding && !session.user.onboardingComplete) {
		redirect("/onboarding");
	}

	const organizations = await getOrganizationList();

	if (authConfig.organizations.enable && authConfig.organizations.requireOrganization) {
		const organization =
			organizations.find((org) => org.id === session?.session.activeOrganizationId) ||
			organizations[0];

		if (!organization) {
			redirect("/new-organization");
		}
	}

	if (paymentsConfig.requireActiveSubscription) {
		const organizationId = authConfig.organizations.enable
			? session?.session.activeOrganizationId || organizations?.at(0)?.id
			: undefined;

		// Use the React `cache()`-wrapped server helper so this call is deduplicated
		// with the (org) layout's `listPurchases(organization.id)` call within the
		// same request — same args, same result, single DB roundtrip.
		const purchases = await listPurchases(organizationId);

		const { activePlan } = createPurchasesHelper(purchases);

		if (!activePlan) {
			redirect("/choose-plan");
		}
	}

	return children;
}
