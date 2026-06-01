// @vitest-environment jsdom
//
// OnboardingModePicker -- Phase 19: the mode step is now a TRUE required choice. No profile is
// pre-selected, and Continue is gated until the operator explicitly picks one. We mock the
// router, the orpc mutation options, and useMutation so we can drive the apply + redirect.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { replace, mutateAsync } = vi.hoisted(() => ({
	replace: vi.fn(),
	mutateAsync: vi.fn(),
}));

vi.mock("@shared/hooks/router", () => ({ useRouter: () => ({ replace }) }));
vi.mock("@shared/lib/orpc-query-utils", () => ({
	orpc: { config: { applyProfile: { mutationOptions: () => ({}) } } },
}));
vi.mock("@tanstack/react-query", async (orig) => ({
	...(await orig<typeof import("@tanstack/react-query")>()),
	useMutation: () => ({ mutateAsync, isPending: false, isError: false, error: null }),
}));

import { OnboardingModePicker } from "./OnboardingModePicker";

beforeEach(() => {
	mutateAsync.mockResolvedValue({});
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

const continueBtn = () => screen.getByRole("button", { name: /continue/i });

describe("OnboardingModePicker required choice", () => {
	it("pre-selects no mode and disables Continue until one is chosen", () => {
		render(<OnboardingModePicker orgSlug="acme" />);
		expect(continueBtn()).toBeDisabled();
		expect(screen.getByRole("button", { name: /Checklist/ })).toHaveAttribute(
			"aria-pressed",
			"false",
		);

		fireEvent.click(screen.getByRole("button", { name: /SOPs & policies/ }));
		expect(continueBtn()).not.toBeDisabled();
	});

	it("applies the chosen profile and redirects to the org on Continue", async () => {
		render(<OnboardingModePicker orgSlug="acme" />);
		fireEvent.click(screen.getByRole("button", { name: /SOPs & policies/ }));
		fireEvent.click(continueBtn());

		await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ profile: "sop" }));
		await waitFor(() => expect(replace).toHaveBeenCalledWith("/acme"));
	});
});
