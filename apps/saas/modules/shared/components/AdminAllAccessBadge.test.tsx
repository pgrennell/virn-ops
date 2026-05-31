// @vitest-environment jsdom
//
// First COMPONENT render test under the new harness (@testing-library/react + jsdom +
// jest-dom matchers). AdminAllAccessBadge is the natural first target: pure presentational,
// no providers, and it encodes a real access-control rule -- it renders only for the
// admin-superset roles (owner/admin), mirroring the gating logic pinned in nav.test.ts.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AdminAllAccessBadge } from "./AdminAllAccessBadge";

afterEach(cleanup);

describe("AdminAllAccessBadge", () => {
	it("renders the badge for the admin-superset roles (owner + admin)", () => {
		render(<AdminAllAccessBadge role="admin" />);
		expect(screen.getByText(/all access/i)).toBeInTheDocument();

		cleanup();
		render(<AdminAllAccessBadge role="owner" />);
		expect(screen.getByText(/all access/i)).toBeInTheDocument();
	});

	it.each(["operator", "builder", "reviewer"] as const)("renders nothing for %s", (role) => {
		const { container } = render(<AdminAllAccessBadge role={role} />);
		expect(container).toBeEmptyDOMElement();
	});

	it("forwards a custom className onto the badge", () => {
		render(<AdminAllAccessBadge role="admin" className="custom-badge-x" />);
		expect(screen.getByText(/all access/i)).toHaveClass("custom-badge-x");
	});
});
