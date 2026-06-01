import type { PaymentsConfig } from "./types";

export const config: PaymentsConfig = {
	billingAttachedTo: "user",
	requireActiveSubscription: false,
	plans: {
		pro: {
			recommended: true,
			prices: [
				{
					type: "subscription",
					priceId: process.env.PRICE_ID_PRO_MONTHLY as string,
					interval: "month",
					// v1 "Operations" plan, per-operator. `amount` is the DISPLAYED price only --
					// the real charge comes from `priceId` (set in the payment provider + env).
					amount: 39,
					currency: "USD",
					seatBased: true,
					trialPeriodDays: 14,
				},
				{
					type: "subscription",
					priceId: process.env.PRICE_ID_PRO_YEARLY as string,
					interval: "year",
					// ~2 months free vs monthly. Displayed only; real price lives in the provider.
					amount: 390,
					currency: "USD",
					seatBased: true,
					trialPeriodDays: 14,
				},
			],
		},
		enterprise: {
			isEnterprise: true,
		},
	},
};
