// @vitest-environment jsdom
//
// PlaceholderScreen -- scaffolding chrome for not-yet-built routes. Branches on `phase`
// (now -> "Coming next", defer-design -> the UX_SPEC deferred label) and falls back to a
// default note when none is given. Composes PageHeader (pure), so no providers are needed.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PlaceholderScreen } from "./PlaceholderScreen";

afterEach(cleanup);

describe("PlaceholderScreen", () => {
	it("renders the title and the default 'coming next' phase label + note", () => {
		render(<PlaceholderScreen title="Reports" />);
		expect(screen.getByRole("heading", { name: "Reports" })).toBeInTheDocument();
		expect(screen.getByText(/coming next/i)).toBeInTheDocument();
		expect(screen.getByText(/this route is scaffolded/i)).toBeInTheDocument();
	});

	it("uses the deferred-design label for the defer-design phase", () => {
		render(<PlaceholderScreen title="Reports" phase="defer-design" />);
		expect(screen.getByText(/design deferred/i)).toBeInTheDocument();
	});

	it("renders a custom note over the default", () => {
		render(<PlaceholderScreen title="Reports" note="Lands in Phase 20." />);
		expect(screen.getByText("Lands in Phase 20.")).toBeInTheDocument();
		expect(screen.queryByText(/this route is scaffolded/i)).not.toBeInTheDocument();
	});
});
