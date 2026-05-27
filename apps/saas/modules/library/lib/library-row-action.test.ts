// library-row-action.test.ts
//
// The load-bearing test for UX_SPEC §4.2 integrity #1: every row's action MUST be
// derivable from (hasDraft, latestPublishedVersionNumber, isActive, type) + (admin,
// canRun) and never offer an action the state can't satisfy. Pure-function test
// against the resolver -- no React render needed. Catches the "Run on no-published
// version" regression directly.

import { describe, expect, it } from "vitest";

import {
	deriveStatusPill,
	resolveLibraryRowAction,
	type WorkflowListRow,
} from "./library-row-action";

const baseRow: WorkflowListRow = {
	id: "wf_1",
	type: "procedure",
	title: "Onboarding",
	description: null,
	isActive: true,
	createdAt: new Date("2026-05-01"),
	updatedAt: new Date("2026-05-26"),
	hasDraft: false,
	latestPublishedVersionNumber: null,
	latestPublishedVersionId: null,
	latestPublishedAt: null,
};

const ADMIN_RUN = { isAdminOrOwner: true, canRun: true } as const;
const ADMIN_NO_RUN = { isAdminOrOwner: true, canRun: false } as const;
const MEMBER_RUN = { isAdminOrOwner: false, canRun: true } as const;
const MEMBER_NO_RUN = { isAdminOrOwner: false, canRun: false } as const;

describe("resolveLibraryRowAction -- draft-only (never published)", () => {
	const draftOnly: WorkflowListRow = {
		...baseRow,
		hasDraft: true,
		latestPublishedVersionNumber: null,
	};

	it("admin sees Continue editing", () => {
		expect(resolveLibraryRowAction(draftOnly, ADMIN_RUN)).toEqual({
			kind: "continue-edit",
		});
		expect(resolveLibraryRowAction(draftOnly, ADMIN_NO_RUN)).toEqual({
			kind: "continue-edit",
		});
	});

	it("member sees nothing (draft-only-for-member)", () => {
		expect(resolveLibraryRowAction(draftOnly, MEMBER_RUN)).toEqual({
			kind: "none",
			reason: "draft-only-for-member",
		});
	});
});

describe("resolveLibraryRowAction -- published procedure (executable)", () => {
	const published: WorkflowListRow = {
		...baseRow,
		type: "procedure",
		latestPublishedVersionNumber: 3,
	};

	it("admin + canRun => Run, no secondary when no draft", () => {
		expect(resolveLibraryRowAction(published, ADMIN_RUN)).toEqual({
			kind: "run",
			secondary: null,
		});
	});

	it("admin + canRun + hasDraft => Run with Continue editing secondary", () => {
		expect(
			resolveLibraryRowAction({ ...published, hasDraft: true }, ADMIN_RUN),
		).toEqual({ kind: "run", secondary: "continue-edit" });
	});

	it("member + canRun + hasDraft => Run with NO secondary (only admins continue editing)", () => {
		expect(
			resolveLibraryRowAction({ ...published, hasDraft: true }, MEMBER_RUN),
		).toEqual({ kind: "run", secondary: null });
	});

	it("admin + !canRun => no-run-permission (latent today; designed for the custom-role layer)", () => {
		expect(resolveLibraryRowAction(published, ADMIN_NO_RUN)).toEqual({
			kind: "none",
			reason: "no-run-permission",
		});
	});

	it("member + !canRun => no-run-permission", () => {
		expect(resolveLibraryRowAction(published, MEMBER_NO_RUN)).toEqual({
			kind: "none",
			reason: "no-run-permission",
		});
	});
});

describe("resolveLibraryRowAction -- inactive (the bug the prior plan missed)", () => {
	const inactivePublished: WorkflowListRow = {
		...baseRow,
		type: "procedure",
		isActive: false,
		latestPublishedVersionNumber: 2,
	};

	it("admin + canRun => Run-disabled with reason=inactive (NOT a live Run button)", () => {
		expect(resolveLibraryRowAction(inactivePublished, ADMIN_RUN)).toEqual({
			kind: "run-disabled",
			reason: "inactive",
			secondary: null,
		});
	});

	it("inactive trumps no-run-permission -- the inactive reason is stronger for the viewer", () => {
		// !canRun would normally surface no-run-permission, but inactive is the
		// reason the workflow's not runnable AT ALL right now; surface that.
		expect(resolveLibraryRowAction(inactivePublished, ADMIN_NO_RUN)).toEqual({
			kind: "run-disabled",
			reason: "inactive",
			secondary: null,
		});
	});

	it("inactive + hasDraft + admin => Run-disabled + Continue editing secondary", () => {
		expect(
			resolveLibraryRowAction(
				{ ...inactivePublished, hasDraft: true },
				ADMIN_RUN,
			),
		).toEqual({
			kind: "run-disabled",
			reason: "inactive",
			secondary: "continue-edit",
		});
	});
});

describe("resolveLibraryRowAction -- published form (executable, same path as procedure)", () => {
	const publishedForm: WorkflowListRow = {
		...baseRow,
		type: "form",
		latestPublishedVersionNumber: 1,
	};

	it("admin + canRun => Run", () => {
		expect(resolveLibraryRowAction(publishedForm, ADMIN_RUN)).toEqual({
			kind: "run",
			secondary: null,
		});
	});

	it("inactive form => Run-disabled with inactive reason", () => {
		expect(
			resolveLibraryRowAction({ ...publishedForm, isActive: false }, ADMIN_RUN),
		).toEqual({ kind: "run-disabled", reason: "inactive", secondary: null });
	});
});

describe("resolveLibraryRowAction -- published document/policy (Open, inactive does NOT block reads)", () => {
	const publishedDoc: WorkflowListRow = {
		...baseRow,
		type: "document",
		latestPublishedVersionNumber: 4,
	};

	it("everyone sees Open on a published doc", () => {
		for (const perms of [ADMIN_RUN, ADMIN_NO_RUN, MEMBER_RUN, MEMBER_NO_RUN]) {
			expect(resolveLibraryRowAction(publishedDoc, perms)).toEqual({
				kind: "open",
				secondary: null,
			});
		}
	});

	it("inactive doc still shows Open -- inactivation blocks runs, not reads", () => {
		expect(
			resolveLibraryRowAction({ ...publishedDoc, isActive: false }, MEMBER_RUN),
		).toEqual({ kind: "open", secondary: null });
	});

	it("policy with draft + admin => Open with Continue editing secondary", () => {
		expect(
			resolveLibraryRowAction(
				{ ...publishedDoc, type: "policy", hasDraft: true },
				ADMIN_RUN,
			),
		).toEqual({ kind: "open", secondary: "continue-edit" });
	});
});

describe("deriveStatusPill -- status pill copy matches the row-action matrix", () => {
	it("published only", () => {
		expect(
			deriveStatusPill({ ...baseRow, latestPublishedVersionNumber: 3 }),
		).toEqual({ label: "Published v3", tone: "published" });
	});

	it("published WITH draft -- infers draft is v{N+1}", () => {
		expect(
			deriveStatusPill({
				...baseRow,
				latestPublishedVersionNumber: 3,
				hasDraft: true,
			}),
		).toEqual({ label: "Published v3 · Draft v4", tone: "draft" });
	});

	it("draft only (never published)", () => {
		expect(deriveStatusPill({ ...baseRow, hasDraft: true })).toEqual({
			label: "Draft v1",
			tone: "draft-only",
		});
	});

	it("no versions at all (defensive)", () => {
		expect(deriveStatusPill(baseRow)).toBeNull();
	});
});
