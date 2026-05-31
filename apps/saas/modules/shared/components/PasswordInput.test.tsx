// @vitest-environment jsdom
//
// PasswordInput -- a password field with an optional show/hide toggle, a generate button, and
// an optional live criteria checklist. The real logic worth pinning: the visibility toggle
// flips the input type + the button title, the generate button emits a password meeting every
// criterion, and the checklist evaluates the four criteria (length / upper+lower / number /
// special) against the current value. next-intl is the only mock (criteria labels).

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
	useTranslations: () => (key: string) => key,
}));

import { PasswordInput } from "./PasswordInput";

afterEach(cleanup);

const field = (c: HTMLElement) => c.querySelector('input[name="password"]') as HTMLInputElement;

describe("PasswordInput visibility toggle", () => {
	it("starts masked and reveals the value when toggled", () => {
		const { container } = render(<PasswordInput value="hunter2" onChange={() => {}} />);
		expect(field(container)).toHaveAttribute("type", "password");

		fireEvent.click(screen.getByTitle("Show password"));
		expect(field(container)).toHaveAttribute("type", "text");
		expect(screen.getByTitle("Hide password")).toBeInTheDocument();
	});
});

describe("PasswordInput generate button", () => {
	it("emits a password meeting every criterion when generate is clicked", () => {
		const onChange = vi.fn();
		render(<PasswordInput value="" onChange={onChange} showGenerateButton />);
		fireEvent.click(screen.getByTitle("Generate random password"));

		expect(onChange).toHaveBeenCalledOnce();
		const generated: string = onChange.mock.calls[0][0];
		expect(generated.length).toBeGreaterThanOrEqual(8);
		expect(generated).toMatch(/[A-Z]/);
		expect(generated).toMatch(/[a-z]/);
		expect(generated).toMatch(/[0-9]/);
		expect(generated).toMatch(/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?~`]/);
	});
});

describe("PasswordInput criteria checklist", () => {
	it("marks all criteria met for a strong password", () => {
		render(<PasswordInput value="Abcdef1!" onChange={() => {}} showPasswordCriteria />);
		for (const key of ["minLength", "upperAndLowercase", "number", "specialCharacter"]) {
			expect(screen.getByText(`common.passwordCriteria.${key}`)).toHaveClass("text-success");
		}
	});

	it("marks unmet criteria as not-success for a weak password", () => {
		render(<PasswordInput value="abc" onChange={() => {}} showPasswordCriteria />);
		// "abc": fails length, upper+lower (no upper), number, special.
		for (const key of ["minLength", "upperAndLowercase", "number", "specialCharacter"]) {
			expect(screen.getByText(`common.passwordCriteria.${key}`)).not.toHaveClass("text-success");
		}
	});

	it("does not render the checklist unless asked", () => {
		render(<PasswordInput value="abc" onChange={() => {}} />);
		expect(screen.queryByText("common.passwordCriteria.minLength")).not.toBeInTheDocument();
	});
});
