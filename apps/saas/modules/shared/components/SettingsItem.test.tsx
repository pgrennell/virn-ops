// @vitest-environment jsdom
//
// SettingsItem -- a titled settings card (title | description | body). Pure (Card + cn). Pins
// the title/description/children rendering, that description is omitted when not given, and
// the danger flag turns the title destructive.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SettingsItem } from "./SettingsItem";

afterEach(cleanup);

describe("SettingsItem", () => {
	it("renders the title, description, and children", () => {
		render(
			<SettingsItem title="Display name" description="Shown to your team">
				<button type="button">Edit</button>
			</SettingsItem>,
		);
		expect(screen.getByText("Display name")).toBeInTheDocument();
		expect(screen.getByText("Shown to your team")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
	});

	it("omits the description when none is provided", () => {
		render(
			<SettingsItem title="Display name">
				<span>body</span>
			</SettingsItem>,
		);
		expect(screen.queryByText("Shown to your team")).not.toBeInTheDocument();
	});

	it("makes the title destructive when danger is set", () => {
		render(
			<SettingsItem title="Delete account" danger>
				<span>body</span>
			</SettingsItem>,
		);
		expect(screen.getByText("Delete account")).toHaveClass("text-destructive");
	});
});
