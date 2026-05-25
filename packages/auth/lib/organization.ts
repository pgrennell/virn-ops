import { getOrganizationWithPurchasesAndMembersCount } from "@virn/database";
import { logger } from "@virn/logs";
import { setSubscriptionSeats } from "@virn/payments";

export async function updateSeatsInOrganizationSubscription(organizationId: string) {
	const organization = await getOrganizationWithPurchasesAndMembersCount(organizationId);

	if (!organization?.purchases.length) {
		return;
	}

	const activeSubscription = organization.purchases.find(
		(purchase) => purchase.type === "SUBSCRIPTION",
	);

	if (!activeSubscription?.subscriptionId) {
		return;
	}

	try {
		await setSubscriptionSeats({
			id: activeSubscription.subscriptionId,
			seats: organization.membersCount,
		});
	} catch (error) {
		logger.error("Could not update seats in organization subscription", {
			organizationId,
			error,
		});
	}
}
