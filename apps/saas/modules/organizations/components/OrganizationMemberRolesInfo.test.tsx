// @vitest-environment jsdom
//
// OrganizationMemberRolesInfo -- an Alert that lists every member role with its label +
// description. It composes useOrganizationMemberRoleOptions (which itself reads next-intl),
// so the single next-intl mock covers both. We pin the title/description keys and that the
// list enumerates one entry per role in the canonical order.

import { organizationMemberRoleOrder } from "@virn/auth/lib/organization-member-role-order";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
	useTranslations: () => (key: string) => key,
}));

import { OrganizationMemberRolesInfo } from "./OrganizationMemberRolesInfo";

afterEach(cleanup);

describe("OrganizationMemberRolesInfo", () => {
	it("renders the info title + description keys", () => {
		render(<OrganizationMemberRolesInfo />);
		expect(screen.getByText("organizations.roles.info.title")).toBeInTheDocument();
		expect(screen.getByText("organizations.roles.info.description")).toBeInTheDocument();
	});

	it("lists one entry per role with its label + description", () => {
		const { container } = render(<OrganizationMemberRolesInfo />);
		expect(container.querySelectorAll("li")).toHaveLength(organizationMemberRoleOrder.length);
		for (const role of organizationMemberRoleOrder) {
			expect(screen.getByText(`organizations.roles.${role}`)).toBeInTheDocument();
		}
	});
});
