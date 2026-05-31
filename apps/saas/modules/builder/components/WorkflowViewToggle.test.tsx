// @vitest-environment jsdom
//
// WorkflowViewToggle -- the Author|Read segmented toggle on the workflow detail page. Pure
// (cn + lucide, plain anchors by design). Pins both segment hrefs and the aria-current
// "page" treatment: author highlights the Author segment, read the Read segment, and the
// Phase 14 "other" state (rendered on sibling routes like /runs) highlights neither.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { WorkflowViewToggle } from "./WorkflowViewToggle";

afterEach(cleanup);

const authorLink = () => screen.getByRole("link", { name: /author/i });
const readLink = () => screen.getByRole("link", { name: /read/i });

describe("WorkflowViewToggle", () => {
	it("links each segment to its sibling route", () => {
		render(<WorkflowViewToggle organizationSlug="acme" workflowId="wf-1" active="other" />);
		expect(authorLink()).toHaveAttribute("href", "/acme/library/workflows/wf-1/builder");
		expect(readLink()).toHaveAttribute("href", "/acme/library/workflows/wf-1/read");
	});

	it("highlights the Author segment when active=author", () => {
		render(<WorkflowViewToggle organizationSlug="acme" workflowId="wf-1" active="author" />);
		expect(authorLink()).toHaveAttribute("aria-current", "page");
		expect(readLink()).not.toHaveAttribute("aria-current");
	});

	it("highlights the Read segment when active=read", () => {
		render(<WorkflowViewToggle organizationSlug="acme" workflowId="wf-1" active="read" />);
		expect(readLink()).toHaveAttribute("aria-current", "page");
		expect(authorLink()).not.toHaveAttribute("aria-current");
	});

	it("highlights neither segment in the 'other' state", () => {
		render(<WorkflowViewToggle organizationSlug="acme" workflowId="wf-1" active="other" />);
		expect(authorLink()).not.toHaveAttribute("aria-current");
		expect(readLink()).not.toHaveAttribute("aria-current");
	});
});
