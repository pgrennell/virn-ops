// @vitest-environment jsdom
//
// ModePicker -- the shared, fully-controlled enablement-profile picker (Checklist / SOPs /
// Automation) used by onboarding + the Configuration page. Pure (cn + lucide). Pins: a card
// per profile, aria-pressed tracks the selected value, onChange fires the profile on click,
// disabled blocks every card, and currentProfile shows the "Current" pill on just that card.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ModePicker } from "./ModePicker";

afterEach(cleanup);

const card = (name: RegExp) => screen.getByRole("button", { name });

describe("ModePicker", () => {
	it("renders a card for every profile", () => {
		render(<ModePicker value="checklist" onChange={() => {}} />);
		expect(card(/Checklist/)).toBeInTheDocument();
		expect(card(/SOPs & policies/)).toBeInTheDocument();
		expect(card(/Automation/)).toBeInTheDocument();
	});

	it("presses only the selected profile's card", () => {
		render(<ModePicker value="sop" onChange={() => {}} />);
		expect(card(/SOPs & policies/)).toHaveAttribute("aria-pressed", "true");
		expect(card(/Checklist/)).toHaveAttribute("aria-pressed", "false");
	});

	it("presses no card when value is null", () => {
		render(<ModePicker value={null} onChange={() => {}} />);
		expect(card(/Checklist/)).toHaveAttribute("aria-pressed", "false");
		expect(card(/Automation/)).toHaveAttribute("aria-pressed", "false");
	});

	it("calls onChange with the profile when a card is clicked", () => {
		const onChange = vi.fn();
		render(<ModePicker value="checklist" onChange={onChange} />);
		fireEvent.click(card(/Automation/));
		expect(onChange).toHaveBeenCalledWith("automation");
	});

	it("disables every card when disabled", () => {
		render(<ModePicker value="checklist" onChange={() => {}} disabled />);
		expect(card(/Checklist/)).toBeDisabled();
		expect(card(/SOPs & policies/)).toBeDisabled();
		expect(card(/Automation/)).toBeDisabled();
	});

	it("shows the Current pill only on the matching profile", () => {
		render(<ModePicker value="checklist" onChange={() => {}} currentProfile="sop" />);
		const current = screen.getByText("Current");
		expect(current).toBeInTheDocument();
		// The pill sits inside the SOPs card, not the selected Checklist card.
		expect(card(/SOPs & policies/)).toContainElement(current);
	});
});
