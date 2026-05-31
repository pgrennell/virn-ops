// @vitest-environment jsdom
//
// Pagination -- pure presentational pager. The logic worth pinning: the "from - to of total"
// range arithmetic (including the last-page clamp where to never exceeds total), the
// prev/next disabled edges (first page disables prev, last page disables next), and that the
// arrows call onChangeCurrentPage with the adjacent page. No providers.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Pagination } from "./Pagination";

afterEach(cleanup);

function buttons() {
	const [prev, next] = screen.getAllByRole("button");
	return { prev, next };
}

describe("Pagination", () => {
	it("shows the item range for the current page", () => {
		render(
			<Pagination currentPage={1} totalItems={25} itemsPerPage={10} onChangeCurrentPage={() => {}} />,
		);
		expect(screen.getByText(/1\s*-\s*10\s*of\s*25/)).toBeInTheDocument();
	});

	it("clamps the upper bound of the range to totalItems on the last page", () => {
		render(
			<Pagination currentPage={3} totalItems={25} itemsPerPage={10} onChangeCurrentPage={() => {}} />,
		);
		expect(screen.getByText(/21\s*-\s*25\s*of\s*25/)).toBeInTheDocument();
	});

	it("disables prev on the first page and next on the last page", () => {
		const { rerender } = render(
			<Pagination currentPage={1} totalItems={25} itemsPerPage={10} onChangeCurrentPage={() => {}} />,
		);
		expect(buttons().prev).toBeDisabled();
		expect(buttons().next).not.toBeDisabled();

		rerender(
			<Pagination currentPage={3} totalItems={25} itemsPerPage={10} onChangeCurrentPage={() => {}} />,
		);
		expect(buttons().prev).not.toBeDisabled();
		expect(buttons().next).toBeDisabled();
	});

	it("requests the adjacent page when an arrow is clicked", () => {
		const onChange = vi.fn();
		render(
			<Pagination currentPage={2} totalItems={25} itemsPerPage={10} onChangeCurrentPage={onChange} />,
		);
		fireEvent.click(buttons().prev);
		expect(onChange).toHaveBeenCalledWith(1);
		fireEvent.click(buttons().next);
		expect(onChange).toHaveBeenCalledWith(3);
	});
});
