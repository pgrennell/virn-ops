import { ORPCError } from "@orpc/client";
import { getOrganizationById, getOrganizationMembership } from "@virn/database";
import { logger } from "@virn/logs";
import {
	createCheckoutLink as createCheckoutLinkFn,
	findPriceByPlanId,
	getCustomerIdFromEntity,
	getProviderPriceIdByPlanId,
	type PlanId,
} from "@virn/payments";
import { config as paymentsConfig } from "@virn/payments/config";
import { z } from "zod";

import { localeMiddleware } from "../../../orpc/middleware/locale-middleware";
import { protectedProcedure } from "../../../orpc/procedures";
import { assertSameOriginRedirect } from "../lib/validate-redirect-url";

// Validate planId at the procedure boundary against the configured plan set —
// PlanId widens to `string` because `PaymentsConfig.plans: Record<string, Plan>`,
// but at runtime we can check membership in the actual config and reject typos
// with a clear error instead of relying on findPriceByPlanId returning null
// deeper in the handler.
const PLAN_IDS = Object.keys(paymentsConfig.plans) as [string, ...string[]];
const planIdSchema = z.enum(PLAN_IDS);

export const createCheckoutLink = protectedProcedure
	.use(localeMiddleware)
	.route({
		method: "POST",
		path: "/payments/create-checkout-link",
		tags: ["Payments"],
		summary: "Create checkout link",
		description: "Creates a checkout link for a one-time or subscription product",
	})
	.input(
		z.object({
			planId: planIdSchema,
			type: z.enum(["one-time", "subscription"]),
			interval: z.enum(["month", "year"]).optional(),
			redirectUrl: z.string().optional(),
			organizationId: z.string().optional(),
		}),
	)
	.handler(
		async ({
			input: { planId, redirectUrl, type, interval, organizationId },
			context: { user },
		}) => {
			// Same-origin guard on the redirect target — Stripe will send the user
			// back through this URL, so an attacker-controlled value would be an
			// open-redirect bridge through our own domain.
			assertSameOriginRedirect(redirectUrl);

			// Dual-mode billing (AUTH_CONTRACT.md §5.2): when checkout is org-scoped,
			// the caller must be a member of that org AND admin/owner — checkout
			// creates a seat-counted subscription billed to the org, which is
			// strictly an admin gesture.
			if (organizationId) {
				const membership = await getOrganizationMembership(organizationId, user.id);
				if (!membership) {
					throw new ORPCError("FORBIDDEN");
				}
				if (membership.role !== "owner" && membership.role !== "admin") {
					throw new ORPCError("FORBIDDEN", {
						message: "Only an org owner or admin can create a checkout for this organization.",
					});
				}
			}

			const customerId = await getCustomerIdFromEntity(
				organizationId
					? {
							organizationId,
						}
					: {
							userId: user.id,
						},
			);

			const normalizedType = type === "subscription" ? "subscription" : "one-time";
			const price = findPriceByPlanId(planId as PlanId, {
				type: normalizedType,
				interval,
			});
			const priceId = getProviderPriceIdByPlanId(planId as PlanId, {
				type: normalizedType,
				interval,
			});

			if (!price || !priceId) {
				throw new ORPCError("NOT_FOUND");
			}

			const trialPeriodDays =
				price && "trialPeriodDays" in price ? price.trialPeriodDays : undefined;

			const organization = organizationId ? await getOrganizationById(organizationId) : undefined;

			if (organization === null) {
				throw new ORPCError("NOT_FOUND");
			}

			const seats =
				organization && price && "seatBased" in price && price.seatBased
					? organization.members.length
					: undefined;

			try {
				const checkoutLink = await createCheckoutLinkFn({
					type,
					priceId,
					email: user.email,
					name: user.name ?? "",
					redirectUrl,
					...(organizationId ? { organizationId } : { userId: user.id }),
					trialPeriodDays,
					seats,
					customerId: customerId ?? undefined,
				});

				if (!checkoutLink) {
					throw new ORPCError("INTERNAL_SERVER_ERROR");
				}

				return { checkoutLink };
			} catch (e) {
				logger.error(e);
				throw new ORPCError("INTERNAL_SERVER_ERROR");
			}
		},
	);
