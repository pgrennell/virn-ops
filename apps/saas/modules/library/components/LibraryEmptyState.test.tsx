// @vitest-environment jsdom
//
// LibraryEmptyState -- fresh-org empty state that branches on isAdminOrOwner: admins get a
// "create your first workflow" call-to-action (with the Create menu), members get an
// honest "an admin will author these" message and NO create affordance. We stub the
// CreateWorkflowMenu child (it pulls router/orpc -- not under test here) and pin both
// copy branches + the presence/absence of the create menu.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./CreateWorkflowMenu", () => ({
	CreateWorkflowMenu: () => <div data-testid="create-workflow-menu" />,
}));

import { LibraryEmptyState } from "./LibraryEmptyState";

afterEach(cleanup);

describe("LibraryEmptyState", () => {
	it("shows the author call-to-action and the create menu for admins/owners", () => {
		render(
			<LibraryEmptyState isAdminOrOwner organizationSlug="acme" onError={() => {}} />,
		);
		expect(screen.getByText(/create your first workflow/i)).toBeInTheDocument();
		expect(screen.getByTestId("create-workflow-menu")).toBeInTheDocument();
	});

	it("shows the read-only message and no create menu for members", () => {
		render(
			<LibraryEmptyState isAdminOrOwner={false} organizationSlug="acme" onError={() => {}} />,
		);
		expect(screen.getByText(/no workflows yet/i)).toBeInTheDocument();
		expect(screen.getByText(/an admin will author workflows here/i)).toBeInTheDocument();
		expect(screen.queryByTestId("create-workflow-menu")).not.toBeInTheDocument();
	});
});
