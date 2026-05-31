// @vitest-environment jsdom
//
// ActivePlanBadge -- shows the active plan's title, or nothing. Two null-guards: no active
// plan at all, and an active plan whose id has no matching plan-data entry. We mock the two
// payments hooks (plan-data + purchases) to drive both guards and the happy path.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

let activePlan: { id: string } | null = { id: "pro" };
const planData: Record<string, { title: string }> = { pro: { title: "Pro" } };

vi.mock("@payments/hooks/plan-data", () => ({
	usePlanData: () => ({ planData }),
}));
vi.mock("@payments/hooks/purchases", () => ({
	usePurchases: () => ({ activePlan }),
}));

import { ActivePlanBadge } from "./ActivePlanBadge";

afterEach(() => {
	cleanup();
	activePlan = { id: "pro" };
});

describe("ActivePlanBadge", () => {
	it("renders the active plan's title", () => {
		render(<ActivePlanBadge />);
		expect(screen.getByText("Pro")).toBeInTheDocument();
	});

	it("renders nothing when there is no active plan", () => {
		activePlan = null;
		const { container } = render(<ActivePlanBadge />);
		expect(container).toBeEmptyDOMElement();
	});

	it("renders nothing when the active plan has no matching plan data", () => {
		activePlan = { id: "unknown-plan" };
		const { container } = render(<ActivePlanBadge />);
		expect(container).toBeEmptyDOMElement();
	});
});
