// @vitest-environment jsdom
//
// PageHeader -- pure title/subtitle chrome. No providers. Pins the title heading, the
// optional subtitle, and the className passthrough on the wrapper.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PageHeader } from "./PageHeader";

afterEach(cleanup);

describe("PageHeader", () => {
	it("renders the title as a heading and the subtitle", () => {
		render(<PageHeader title="Listings" subtitle="All your properties" />);
		expect(screen.getByRole("heading", { name: "Listings" })).toBeInTheDocument();
		expect(screen.getByText("All your properties")).toBeInTheDocument();
	});

	it("forwards a custom className onto the wrapper", () => {
		const { container } = render(<PageHeader title="Listings" className="mb-2-custom" />);
		expect(container.firstChild).toHaveClass("mb-2-custom");
	});
});
