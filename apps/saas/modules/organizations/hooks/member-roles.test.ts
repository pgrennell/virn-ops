// @vitest-environment jsdom
//
// useOrganizationMemberRoles / useOrganizationMemberRoleOptions -- thin hooks that project
// the canonical organizationMemberRoleOrder into i18n-labelled shapes. We mock next-intl so
// useTranslations echoes the key, which lets us assert the exact translation keys the hooks
// build (organizations.roles.<role> + .descriptions.<role>) AND that they enumerate every
// role in order. renderHook gives us the return value across the real role-order constant.

import { organizationMemberRoleOrder } from "@virn/auth/lib/organization-member-role-order";
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
	useTranslations: () => (key: string) => key,
}));

import {
	useOrganizationMemberRoleOptions,
	useOrganizationMemberRoles,
} from "./member-roles";

describe("useOrganizationMemberRoles", () => {
	it("maps every role in canonical order to its translation key", () => {
		const { result } = renderHook(() => useOrganizationMemberRoles());
		expect(Object.keys(result.current)).toEqual([...organizationMemberRoleOrder]);
		for (const role of organizationMemberRoleOrder) {
			expect(result.current[role]).toBe(`organizations.roles.${role}`);
		}
	});
});

describe("useOrganizationMemberRoleOptions", () => {
	it("builds {value,label,description} options for every role in order", () => {
		const { result } = renderHook(() => useOrganizationMemberRoleOptions());
		expect(result.current.map((o) => o.value)).toEqual([...organizationMemberRoleOrder]);
		for (const option of result.current) {
			expect(option.label).toBe(`organizations.roles.${option.value}`);
			expect(option.description).toBe(`organizations.roles.descriptions.${option.value}`);
		}
	});
});
