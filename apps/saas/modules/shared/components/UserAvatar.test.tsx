// @vitest-environment jsdom
//
// UserAvatar -- derives initials from a name and composes an avatar src. The src lives on a
// radix AvatarImage that never reaches "loaded" in jsdom (no real image load), so the radix
// fallback -- which carries the initials -- is what renders, and that is exactly the logic we
// want to pin: first letters of the first two words. Also pins the className passthrough.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { UserAvatar } from "./UserAvatar";

afterEach(cleanup);

describe("UserAvatar initials", () => {
	it("takes the first letter of the first two words", () => {
		render(<UserAvatar name="John Doe" />);
		expect(screen.getByText("JD")).toBeInTheDocument();
	});

	it("uses a single initial for a one-word name", () => {
		render(<UserAvatar name="Madonna" />);
		expect(screen.getByText("M")).toBeInTheDocument();
	});

	it("ignores words past the first two", () => {
		render(<UserAvatar name="Ada Mary Lovelace" />);
		expect(screen.getByText("AM")).toBeInTheDocument();
	});

	it("forwards a custom className onto the avatar root", () => {
		const { container } = render(<UserAvatar name="John Doe" className="ring-custom-x" />);
		expect(container.firstChild).toHaveClass("ring-custom-x");
	});
});
