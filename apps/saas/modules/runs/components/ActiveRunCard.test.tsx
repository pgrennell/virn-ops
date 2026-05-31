// @vitest-environment jsdom
//
// ActiveRunCard (Home right-rail) -- pure (cn + Progress). Pins the title/workflow context,
// the step count, the due-vs-started label switch, the zero-total progress guard, and the
// whole-card click.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ActiveRunCard } from "./ActiveRunCard";

afterEach(cleanup);

const BASE = {
	runId: "run-1",
	title: "Turnover #12",
	workflowTitle: "Make-ready",
	startedAt: new Date(2026, 5, 1),
	dueAt: null as Date | null,
	totalSteps: 4,
	completedSteps: 1,
	onClick: () => {},
};

describe("ActiveRunCard", () => {
	it("renders the title, workflow context, and step count", () => {
		render(<ActiveRunCard {...BASE} />);
		expect(screen.getByText("Turnover #12")).toBeInTheDocument();
		expect(screen.getByText("Make-ready")).toBeInTheDocument();
		expect(screen.getByText("1 of 4")).toBeInTheDocument();
	});

	it("shows the due label when a due date is set, else the started label", () => {
		const { rerender } = render(<ActiveRunCard {...BASE} dueAt={new Date(2026, 5, 10)} />);
		expect(screen.getByText(/^Due /)).toBeInTheDocument();

		rerender(<ActiveRunCard {...BASE} dueAt={null} />);
		expect(screen.getByText(/^Started /)).toBeInTheDocument();
	});

	it("guards against a zero total", () => {
		render(<ActiveRunCard {...BASE} completedSteps={0} totalSteps={0} />);
		expect(screen.getByText("0 of 0")).toBeInTheDocument();
	});

	it("fires onClick when the card is pressed", () => {
		const onClick = vi.fn();
		render(<ActiveRunCard {...BASE} onClick={onClick} />);
		fireEvent.click(screen.getByRole("button"));
		expect(onClick).toHaveBeenCalledOnce();
	});
});
