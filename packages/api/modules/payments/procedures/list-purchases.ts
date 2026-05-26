import { ORPCError } from "@orpc/client";
import {
	getOrganizationMembership,
	getPurchasesByOrganizationId,
	getPurchasesByUserId,
} from "@virn/database";
import { getPlanIdByProviderPriceId, getPlanPriceByProviderPriceId } from "@virn/payments";
import { z } from "zod";

import { protectedProcedure } from "../../../orpc/procedures";

export const listPurchases = protectedProcedure
	.route({
		method: "GET",
		path: "/payments/purchases",
		tags: ["Payments"],
		summary: "Get purchases",
		description: "Get all purchases of the current user or the provided organization",
	})
	.input(
		z.object({
			organizationId: z.string().optional(),
		}),
	)
	.handler(async ({ input: { organizationId }, context: { user } }) => {
		// Dual-mode billing (AUTH_CONTRACT.md §5.2): when org-attached, the caller
		// passes `organizationId` and we must verify membership; when user-attached
		// the input is empty and we fall back to user-scoped purchases.
		if (organizationId) {
			const membership = await getOrganizationMembership(organizationId, user.id);
			if (!membership) {
				throw new ORPCError("FORBIDDEN");
			}
		}

		const purchases = organizationId
			? await getPurchasesByOrganizationId(organizationId)
			: await getPurchasesByUserId(user.id);

		return purchases.map((purchase) => ({
			...purchase,
			planId: getPlanIdByProviderPriceId(purchase.priceId),
			planPrice: getPlanPriceByProviderPriceId(purchase.priceId)?.price ?? null,
		}));
	});
