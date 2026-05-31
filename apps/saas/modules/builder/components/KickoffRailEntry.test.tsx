// @vitest-environment jsdom
//
// KickoffRailEntry -- the left-rail entry for the kickoff form (author mode). Pure
// presentational + one click callback; no providers. The interesting branch is the
// trailing affordance: a count chip when kickoffFieldCount > 0, otherwise a "+" add
// icon. We pin that branch, the active aria-current="step" treatment, and that the
// click invokes onSelect.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { KickoffRailEntry } from "./KickoffRailEntry";

afterEach(cleanup);

describe("KickoffRailEntry", () => {
	it("shows the field-count chip when there are kickoff fields", () => {
		render(<KickoffRailEntry active={false} kickoffFieldCount={3} onSelect={() => {}} />);
		const chip = screen.getByText("3");
		expect(chip).toBeInTheDocument();
		expect(chip).toHaveAttribute("title", "3 kickoff fields");
	});

	it("singularizes the chip title for a single field", () => {
		render(<KickoffRailEntry active={false} kickoffFieldCount={1} onSelect={() => {}} />);
		expect(screen.getByText("1")).toHaveAttribute("title", "1 kickoff field");
	});

	it("renders no count chip when there are zero kickoff fields", () => {
		render(<KickoffRailEntry active={false} kickoffFieldCount={0} onSelect={() => {}} />);
		expect(screen.queryByText("0")).not.toBeInTheDocument();
	});

	it("marks itself the active step only when active", () => {
		const { rerender } = render(
			<KickoffRailEntry active kickoffFieldCount={0} onSelect={() => {}} />,
		);
		expect(screen.getByRole("button")).toHaveAttribute("aria-current", "step");

		rerender(<KickoffRailEntry active={false} kickoffFieldCount={0} onSelect={() => {}} />);
		expect(screen.getByRole("button")).not.toHaveAttribute("aria-current");
	});

	it("invokes onSelect when clicked", () => {
		const onSelect = vi.fn();
		render(<KickoffRailEntry active={false} kickoffFieldCount={0} onSelect={onSelect} />);
		fireEvent.click(screen.getByRole("button"));
		expect(onSelect).toHaveBeenCalledOnce();
	});
});
