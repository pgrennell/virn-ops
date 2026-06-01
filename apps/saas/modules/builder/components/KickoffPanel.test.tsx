// @vitest-environment jsdom
//
// KickoffPanel -- the kickoff-form editor. Fully prop-driven (fields + callbacks), no data
// hooks, so we pin its real logic: position sort, the empty state vs populated rows, the
// locked-key chip, the required toggle + configure/delete callbacks, and the label-input
// blur-commit rule (commit a trimmed change; reset on blank/unchanged).

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { KickoffPanel } from "./KickoffPanel";

afterEach(cleanup);

type Fields = Parameters<typeof KickoffPanel>[0]["kickoffFields"];

function field(over: Record<string, unknown> = {}) {
	return {
		id: "f1",
		label: "Address",
		key: "address",
		fieldType: "text",
		isRequired: false,
		isKeyLocked: false,
		position: 0,
		stepId: null,
		...over,
	};
}

function renderPanel(fields: unknown[], cb: Record<string, unknown> = {}) {
	const handlers = {
		onAddField: vi.fn(),
		onUpdateFieldLabel: vi.fn(),
		onUpdateFieldRequired: vi.fn(),
		onDeleteField: vi.fn(),
		onConfigureField: vi.fn(),
		...cb,
	};
	render(<KickoffPanel kickoffFields={fields as unknown as Fields} {...handlers} />);
	return handlers;
}

describe("KickoffPanel empty state", () => {
	it("shows the first-field prompt and explanation when there are no fields", () => {
		renderPanel([]);
		expect(screen.getByRole("button", { name: /Add your first kickoff field/ })).toBeInTheDocument();
		expect(screen.getByText(/launches with no kickoff fields/i)).toBeInTheDocument();
	});

	it("invokes onAddField when the add button is clicked", () => {
		const h = renderPanel([]);
		fireEvent.click(screen.getByRole("button", { name: /Add your first kickoff field/ }));
		expect(h.onAddField).toHaveBeenCalledOnce();
	});
});

describe("KickoffPanel rows", () => {
	it("renders one row per field in position order", () => {
		renderPanel([
			field({ id: "b", label: "Beta", key: "beta", position: 1 }),
			field({ id: "a", label: "Alpha", key: "alpha", position: 0 }),
		]);
		const inputs = screen.getAllByRole("textbox");
		expect(inputs[0]).toHaveValue("Alpha");
		expect(inputs[1]).toHaveValue("Beta");
		// populated state changes the add-button label
		expect(screen.getByRole("button", { name: "Add kickoff field" })).toBeInTheDocument();
	});

	it("shows a lock indicator + warning title for a locked key", () => {
		renderPanel([field({ isKeyLocked: true })]);
		expect(screen.getByText("🔒")).toBeInTheDocument();
		expect(screen.getByTitle(/cannot be renamed/i)).toBeInTheDocument();
	});

	it("does not lock an editable key", () => {
		renderPanel([field({ isKeyLocked: false })]);
		expect(screen.queryByText("🔒")).not.toBeInTheDocument();
	});

	it("wires configure, delete, and required-toggle callbacks", () => {
		const h = renderPanel([field({ label: "Address", isRequired: false })]);
		fireEvent.click(screen.getByRole("button", { name: "Configure kickoff field Address" }));
		expect(h.onConfigureField).toHaveBeenCalledWith("f1");

		fireEvent.click(screen.getByRole("button", { name: "Delete kickoff field Address" }));
		expect(h.onDeleteField).toHaveBeenCalledWith("f1");

		fireEvent.click(screen.getByRole("checkbox"));
		expect(h.onUpdateFieldRequired).toHaveBeenCalledWith("f1", true);
	});
});

describe("KickoffPanel label blur-commit", () => {
	it("commits a trimmed, changed label on blur", () => {
		const h = renderPanel([field({ label: "Address" })]);
		const input = screen.getByRole("textbox");
		fireEvent.change(input, { target: { value: "  Street address  " } });
		fireEvent.blur(input);
		expect(h.onUpdateFieldLabel).toHaveBeenCalledWith("f1", "Street address");
	});

	it("does not commit a blank or unchanged label", () => {
		const h = renderPanel([field({ label: "Address" })]);
		const input = screen.getByRole("textbox");

		fireEvent.change(input, { target: { value: "   " } });
		fireEvent.blur(input);

		fireEvent.change(input, { target: { value: "Address" } });
		fireEvent.blur(input);

		expect(h.onUpdateFieldLabel).not.toHaveBeenCalled();
	});
});
