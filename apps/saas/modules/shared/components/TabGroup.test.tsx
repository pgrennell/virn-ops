// @vitest-environment jsdom
//
// TabGroup -- nav tabs that highlight whichever item matches the current layout segment.
// We mock next/navigation's useSelectedLayoutSegment to drive the active segment, then pin
// the rendered links (label + href) and that only the matching tab gets the active (bold)
// treatment while the others stay transparent.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

let selectedSegment: string | null = "members";

vi.mock("next/navigation", () => ({
	useSelectedLayoutSegment: () => selectedSegment,
}));

import { TabGroup } from "./TabGroup";

afterEach(() => {
	cleanup();
	selectedSegment = "members";
});

const ITEMS = [
	{ label: "General", href: "/org/general", segment: "general" },
	{ label: "Members", href: "/org/members", segment: "members" },
];

describe("TabGroup", () => {
	it("renders a link per item with its href", () => {
		render(<TabGroup items={ITEMS} />);
		expect(screen.getByRole("link", { name: "General" })).toHaveAttribute("href", "/org/general");
		expect(screen.getByRole("link", { name: "Members" })).toHaveAttribute("href", "/org/members");
	});

	it("bolds only the tab matching the active segment", () => {
		render(<TabGroup items={ITEMS} />);
		expect(screen.getByRole("link", { name: "Members" })).toHaveClass("font-bold");
		expect(screen.getByRole("link", { name: "General" })).not.toHaveClass("font-bold");
	});

	it("bolds no tab when the segment matches none", () => {
		selectedSegment = "settings";
		render(<TabGroup items={ITEMS} />);
		expect(screen.getByRole("link", { name: "General" })).not.toHaveClass("font-bold");
		expect(screen.getByRole("link", { name: "Members" })).not.toHaveClass("font-bold");
	});
});
