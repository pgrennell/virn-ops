// @vitest-environment jsdom
//
// ColorModeToggle -- a three-way segmented theme switch (system | light | dark). We mock
// next-themes (to drive + spy the active theme) and next-intl (label keys). The radix Tooltip
// trigger renders inline, so we can pin: one button per mode, aria-pressed tracks the active
// theme, clicking a mode calls setTheme, and an unresolved theme falls back to "system"
// (the server-stable state the mounted-gate hydration fix renders before mount).

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const setTheme = vi.fn();
let currentTheme: string | undefined = "dark";

vi.mock("next-themes", () => ({
	useTheme: () => ({ theme: currentTheme, setTheme }),
}));
vi.mock("next-intl", () => ({
	useTranslations: () => (key: string) => key,
}));

import { ColorModeToggle } from "./ColorModeToggle";

afterEach(() => {
	cleanup();
	setTheme.mockClear();
	currentTheme = "dark";
});

const modeButton = (mode: string) =>
	document.querySelector(`[data-test="color-mode-toggle-item-${mode}"]`) as HTMLElement;

describe("ColorModeToggle", () => {
	it("renders a button for every mode", () => {
		render(<ColorModeToggle />);
		for (const mode of ["system", "light", "dark"]) {
			expect(modeButton(mode)).toBeInTheDocument();
		}
	});

	it("presses only the active theme's button", () => {
		render(<ColorModeToggle />);
		expect(modeButton("dark")).toHaveAttribute("aria-pressed", "true");
		expect(modeButton("light")).toHaveAttribute("aria-pressed", "false");
		expect(modeButton("system")).toHaveAttribute("aria-pressed", "false");
	});

	it("calls setTheme with the chosen mode on click", () => {
		render(<ColorModeToggle />);
		fireEvent.click(modeButton("light"));
		expect(setTheme).toHaveBeenCalledWith("light");
	});

	it("falls back to 'system' active when the theme is unresolved", () => {
		currentTheme = undefined;
		render(<ColorModeToggle />);
		expect(modeButton("system")).toHaveAttribute("aria-pressed", "true");
		expect(modeButton("dark")).toHaveAttribute("aria-pressed", "false");
		expect(modeButton("light")).toHaveAttribute("aria-pressed", "false");
	});
});
