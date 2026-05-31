// @vitest-environment jsdom
//
// LoginModeSwitch -- a two-tab segmented switch (password | magic-link) built on radix Tabs.
// Unlike a Select, the Tabs list renders its triggers inline (no portal), so we can assert
// both labels and that the active tab is selected. (The value-change-on-click path isn't
// pinned here: radix drives it through pointer/keyboard events that don't fire under a plain
// jsdom click -- that belongs to an interaction/e2e harness, not this render test.)
// next-intl mocked to echo the label keys.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
	useTranslations: () => (key: string) => key,
}));

import { LoginModeSwitch } from "./LoginModeSwitch";

afterEach(cleanup);

const passwordTab = () => screen.getByRole("tab", { name: "auth.login.modes.password" });
const magicTab = () => screen.getByRole("tab", { name: "auth.login.modes.magicLink" });

describe("LoginModeSwitch", () => {
	it("renders both mode tabs and marks the active one selected (password)", () => {
		render(<LoginModeSwitch activeMode="password" onChange={() => {}} />);
		expect(passwordTab()).toHaveAttribute("aria-selected", "true");
		expect(magicTab()).toHaveAttribute("aria-selected", "false");
	});

	it("marks the magic-link tab selected when it is the active mode", () => {
		render(<LoginModeSwitch activeMode="magic-link" onChange={() => {}} />);
		expect(magicTab()).toHaveAttribute("aria-selected", "true");
		expect(passwordTab()).toHaveAttribute("aria-selected", "false");
	});
});
