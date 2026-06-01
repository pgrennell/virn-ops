// @vitest-environment jsdom
//
// SettingsMenu -- a settings nav that flattens its menu sections into one link strip and
// marks the active item via pathname.includes(href). Prop-driven; only seam is
// usePathname. Pins the flatten + the active-link detection.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/acme/settings/general" }));

import { SettingsMenu } from "./SettingsMenu";

afterEach(cleanup);

const menuItems = [
	{
		title: "Account",
		avatar: null,
		items: [
			{ title: "General", href: "/settings/general" },
			{ title: "Security", href: "/settings/security" },
		],
	},
	{
		title: "Organization",
		avatar: null,
		items: [{ title: "Members", href: "/settings/members" }],
	},
];

describe("SettingsMenu", () => {
	it("flattens all sections into one link per item", () => {
		render(<SettingsMenu menuItems={menuItems} />);
		expect(screen.getAllByRole("link")).toHaveLength(3);
		for (const label of ["General", "Security", "Members"]) {
			expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
		}
	});

	it("marks only the pathname-matching item active", () => {
		render(<SettingsMenu menuItems={menuItems} />);
		// pathname "/acme/settings/general" includes "/settings/general"
		expect(screen.getByRole("link", { name: "General" })).toHaveClass("border-primary");
		expect(screen.getByRole("link", { name: "Security" })).not.toHaveClass("border-primary");
		expect(screen.getByRole("link", { name: "Members" })).not.toHaveClass("border-primary");
	});
});
