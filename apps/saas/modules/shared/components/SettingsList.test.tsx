// @vitest-environment jsdom
//
// SettingsList -- wraps a set of settings rows, dropping falsy children (conditionally
// rendered rows) and collapsing to nothing when none survive. Pure. Pins the filter
// behaviour and the empty -> null branch.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SettingsList } from "./SettingsList";

afterEach(cleanup);

describe("SettingsList", () => {
	it("renders each truthy child", () => {
		render(
			<SettingsList>
				<div>Row A</div>
				<div>Row B</div>
			</SettingsList>,
		);
		expect(screen.getByText("Row A")).toBeInTheDocument();
		expect(screen.getByText("Row B")).toBeInTheDocument();
	});

	it("drops falsy children but keeps the real ones", () => {
		const show = false;
		render(
			<SettingsList>
				{show && <div>Hidden</div>}
				{null}
				<div>Visible</div>
			</SettingsList>,
		);
		expect(screen.queryByText("Hidden")).not.toBeInTheDocument();
		expect(screen.getByText("Visible")).toBeInTheDocument();
	});

	it("renders nothing when every child is falsy", () => {
		const { container } = render(
			<SettingsList>
				{false}
				{null}
				{undefined}
			</SettingsList>,
		);
		expect(container).toBeEmptyDOMElement();
	});
});
