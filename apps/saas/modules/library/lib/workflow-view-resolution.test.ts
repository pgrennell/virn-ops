// Phase 10 / v1.5c -- resolver tests for the canonical detail page
// (PRD §6.4 / view-switcher URL pattern).

import { describe, expect, it } from "vitest";

import { resolveWorkflowView } from "./workflow-view-resolution";

const ORG = "virn";
const WID = "wf_abc123";

describe("resolveWorkflowView -- explicit ?view=author", () => {
	it("admin -> /builder", () => {
		expect(
			resolveWorkflowView({
				organizationSlug: ORG,
				workflowId: WID,
				viewParam: "author",
				isAdminOrOwner: true,
			}),
		).toEqual({ redirectTo: `/${ORG}/library/workflows/${WID}/builder` });
	});

	it("member (no edit perms) falls back to /read", () => {
		// A member explicitly asking for ?view=author can't author -- send them
		// to the view they can actually use. Avoids a builder page that would
		// silently 403 every write.
		expect(
			resolveWorkflowView({
				organizationSlug: ORG,
				workflowId: WID,
				viewParam: "author",
				isAdminOrOwner: false,
			}),
		).toEqual({ redirectTo: `/${ORG}/library/workflows/${WID}/read` });
	});
});

describe("resolveWorkflowView -- explicit ?view=read", () => {
	it("admin -> /read", () => {
		expect(
			resolveWorkflowView({
				organizationSlug: ORG,
				workflowId: WID,
				viewParam: "read",
				isAdminOrOwner: true,
			}),
		).toEqual({ redirectTo: `/${ORG}/library/workflows/${WID}/read` });
	});

	it("member -> /read", () => {
		expect(
			resolveWorkflowView({
				organizationSlug: ORG,
				workflowId: WID,
				viewParam: "read",
				isAdminOrOwner: false,
			}),
		).toEqual({ redirectTo: `/${ORG}/library/workflows/${WID}/read` });
	});
});

describe("resolveWorkflowView -- no ?view= (role default)", () => {
	it("admin defaults to /builder", () => {
		expect(
			resolveWorkflowView({
				organizationSlug: ORG,
				workflowId: WID,
				viewParam: undefined,
				isAdminOrOwner: true,
			}),
		).toEqual({ redirectTo: `/${ORG}/library/workflows/${WID}/builder` });
	});

	it("member defaults to /read", () => {
		expect(
			resolveWorkflowView({
				organizationSlug: ORG,
				workflowId: WID,
				viewParam: undefined,
				isAdminOrOwner: false,
			}),
		).toEqual({ redirectTo: `/${ORG}/library/workflows/${WID}/read` });
	});
});

describe("resolveWorkflowView -- defensive parameter handling", () => {
	it("treats unknown ?view=foo as omitted (admin -> /builder)", () => {
		expect(
			resolveWorkflowView({
				organizationSlug: ORG,
				workflowId: WID,
				viewParam: "foo",
				isAdminOrOwner: true,
			}),
		).toEqual({ redirectTo: `/${ORG}/library/workflows/${WID}/builder` });
	});

	it("treats unknown ?view=foo as omitted (member -> /read)", () => {
		expect(
			resolveWorkflowView({
				organizationSlug: ORG,
				workflowId: WID,
				viewParam: "foo",
				isAdminOrOwner: false,
			}),
		).toEqual({ redirectTo: `/${ORG}/library/workflows/${WID}/read` });
	});

	it("takes the first entry of an array-shaped param", () => {
		// Next.js searchParams can be string | string[]; we read the first.
		expect(
			resolveWorkflowView({
				organizationSlug: ORG,
				workflowId: WID,
				viewParam: ["author", "read"],
				isAdminOrOwner: true,
			}),
		).toEqual({ redirectTo: `/${ORG}/library/workflows/${WID}/builder` });
	});
});
