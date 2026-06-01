// @vitest-environment jsdom
//
// Linkify -- turns bare http(s) URLs in plain text into safe external links, leaving the rest
// as text. Pins: plain text passes through untouched, a URL becomes an <a> with the safe
// target/rel attributes, mixed text keeps both the surrounding prose and the link, and multiple
// URLs each linkify.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Linkify } from "./Linkify";

afterEach(cleanup);

describe("Linkify", () => {
	it("renders plain text with no links", () => {
		const { container } = render(<Linkify text="Wipe down all surfaces twice." />);
		expect(container).toHaveTextContent("Wipe down all surfaces twice.");
		expect(container.querySelector("a")).toBeNull();
	});

	it("turns a bare URL into a safe external link", () => {
		render(<Linkify text="https://example.com/sop" />);
		const link = screen.getByRole("link", { name: "https://example.com/sop" });
		expect(link).toHaveAttribute("href", "https://example.com/sop");
		expect(link).toHaveAttribute("target", "_blank");
		expect(link).toHaveAttribute("rel", "noopener noreferrer nofollow");
	});

	it("keeps surrounding prose around a link", () => {
		const { container } = render(
			<Linkify text="See https://example.com/guide before starting." />,
		);
		expect(container).toHaveTextContent("See https://example.com/guide before starting.");
		expect(screen.getByRole("link")).toHaveAttribute("href", "https://example.com/guide");
	});

	it("linkifies multiple URLs independently", () => {
		render(<Linkify text="A https://a.com and B http://b.com end" />);
		const links = screen.getAllByRole("link");
		expect(links).toHaveLength(2);
		expect(links[0]).toHaveAttribute("href", "https://a.com");
		expect(links[1]).toHaveAttribute("href", "http://b.com");
	});
});
