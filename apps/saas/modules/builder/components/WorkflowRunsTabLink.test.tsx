// @vitest-environment jsdom
//
// WorkflowRunsTabLink -- pure presentational per-workflow Runs tab link (D-039: runs are
// instances of the workflow, a separate pill from the Author|Read view toggle). No
// providers; we pin the runs route shape, the label, and the active/passive aria-current
// contract it shares with WorkflowAuditTabLink.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { WorkflowRunsTabLink } from "./WorkflowRunsTabLink";

afterEach(cleanup);

describe("WorkflowRunsTabLink", () => {
	it("links to the per-workflow runs route and labels itself Runs", () => {
		render(<WorkflowRunsTabLink organizationSlug="acme" workflowId="wf-1" active={false} />);
		const link = screen.getByRole("link", { name: /runs/i });
		expect(link).toHaveAttribute("href", "/acme/library/workflows/wf-1/runs");
	});

	it("marks itself the current page only when active", () => {
		const { rerender } = render(
			<WorkflowRunsTabLink organizationSlug="acme" workflowId="wf-1" active />,
		);
		expect(screen.getByRole("link", { name: /runs/i })).toHaveAttribute("aria-current", "page");

		rerender(<WorkflowRunsTabLink organizationSlug="acme" workflowId="wf-1" active={false} />);
		expect(screen.getByRole("link", { name: /runs/i })).not.toHaveAttribute("aria-current");
	});
});
