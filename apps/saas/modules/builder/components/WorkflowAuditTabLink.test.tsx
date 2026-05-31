// @vitest-environment jsdom
//
// WorkflowAuditTabLink -- pure presentational per-workflow Audit tab link. No providers:
// it takes org slug + workflow id + active and renders an anchor. We pin the route shape
// (the href the rest of the app navigates to), the label, and the active "current page"
// treatment via aria-current -- the same active/passive contract WorkflowRunsTabLink shares.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { WorkflowAuditTabLink } from "./WorkflowAuditTabLink";

afterEach(cleanup);

describe("WorkflowAuditTabLink", () => {
	it("links to the per-workflow audit route and labels itself Audit", () => {
		render(<WorkflowAuditTabLink organizationSlug="acme" workflowId="wf-1" active={false} />);
		const link = screen.getByRole("link", { name: /audit/i });
		expect(link).toHaveAttribute("href", "/acme/library/workflows/wf-1/audit");
	});

	it("marks itself the current page only when active", () => {
		const { rerender } = render(
			<WorkflowAuditTabLink organizationSlug="acme" workflowId="wf-1" active />,
		);
		expect(screen.getByRole("link", { name: /audit/i })).toHaveAttribute("aria-current", "page");

		rerender(<WorkflowAuditTabLink organizationSlug="acme" workflowId="wf-1" active={false} />);
		expect(screen.getByRole("link", { name: /audit/i })).not.toHaveAttribute("aria-current");
	});
});
