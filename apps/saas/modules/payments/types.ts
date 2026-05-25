import type { config } from "@virn/payments/config";

export type PlanId = keyof typeof config.plans;
