// @vitest-environment jsdom
//
// usePlanData -- projects the payments config + the pricing i18n into per-plan display data
// (title / description / features) for the pricing UI. Pure over config + next-intl: it builds
// an entry for every config plan and synthesizes a "free" plan unless a subscription is
// required. We mock next-intl (echo keys + a fixed features map via t.raw) and the payments
// config so we can pin the plan set and the requireActiveSubscription branch.

import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { config, t } = vi.hoisted(() => {
	const t = Object.assign((key: string) => key, {
		raw: (_key: string) => ({ a: "Feature A", b: "Feature B" }),
	});
	const config = {
		requireActiveSubscription: false,
		plans: { pro: {}, enterprise: {} } as Record<string, unknown>,
	};
	return { config, t };
});

vi.mock("next-intl", () => ({ useTranslations: () => t }));
vi.mock("@virn/payments/config", () => ({ config }));

import { usePlanData } from "./plan-data";

afterEach(() => {
	config.requireActiveSubscription = false;
});

describe("usePlanData", () => {
	it("builds title/description/features for every config plan plus a free plan", () => {
		const { result } = renderHook(() => usePlanData());
		const { planData } = result.current;

		expect(Object.keys(planData).sort()).toEqual(["enterprise", "free", "pro"]);
		expect(planData.pro.title).toBe("pricing.products.pro.title");
		expect(planData.pro.description).toBe("pricing.products.pro.description");
		expect(planData.pro.features).toEqual(["Feature A", "Feature B"]);
		expect(planData.free.title).toBe("pricing.products.free.title");
	});

	it("omits the free plan when a subscription is required", () => {
		config.requireActiveSubscription = true;
		const { result } = renderHook(() => usePlanData());
		expect(result.current.planData.free).toBeUndefined();
		expect(Object.keys(result.current.planData).sort()).toEqual(["enterprise", "pro"]);
	});
});
