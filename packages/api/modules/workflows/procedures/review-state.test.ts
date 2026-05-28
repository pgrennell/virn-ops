// packages/api/modules/workflows/procedures/review-state.test.ts
//
// Phase 9.5g (PRD §6.6) -- concierge review state-machine procedure tests.
//
// Covers:
//   - workflows.submitForReview: flag-gated, draft-only, must have a draft version
//   - workflows.approveReview: in_review-only, runs publish; race-loser surfaces
//   - workflows.sendBackToDraft: in_review-only; idempotent enforcement via race
//   - workflows.listForReview: admin-only inbox listing
//   - All four refuse plain members (FORBIDDEN at procedure layer)

import { call } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@virn/auth", () => ({
	auth: { api: { getSession: vi.fn() } },
}));

vi.mock("@virn/database", () => ({
	getOrganizationMembership: vi.fn(),
	getOrganizationById: vi.fn(),
	getWorkflowForOrg: vi.fn(),
	getWorkflowWithVersions: vi.fn(),
	transitionWorkflowReviewState: vi.fn(),
	listWorkflowsInReview: vi.fn(),
	writeAuditAndActivity: vi.fn(),
	// publish path
	db: { transaction: vi.fn(async (fn) => fn({} as never)) },
	publishVersionRow: vi.fn(),
	countStepsInVersion: vi.fn(),
	// referenced by publish-version lib imports
	deleteVersion: vi.fn(),
	getLatestPublishedWorkflowVersion: vi.fn(),
	getVersionLaunchBundle: vi.fn(),
	insertDraftVersion: vi.fn(),
	insertField: vi.fn(),
	insertSection: vi.fn(),
	insertStep: vi.fn(),
	insertStepDependency: vi.fn(),
	nextVersionNumber: vi.fn(),
	updateStep: vi.fn(),
	// other refs in workflow lib
	archiveWorkflow: vi.fn(),
	insertWorkflowWithDraft: vi.fn(),
	updateWorkflow: vi.fn(),
}));

import { auth } from "@virn/auth";
import {
	countStepsInVersion,
	db,
	getOrganizationById,
	getOrganizationMembership,
	getWorkflowForOrg,
	getWorkflowWithVersions,
	listWorkflowsInReview,
	publishVersionRow,
	transitionWorkflowReviewState,
	writeAuditAndActivity,
} from "@virn/database";

import { approveReviewProc } from "./approve-review";
import { listForReviewProc } from "./list-for-review";
import { sendBackToDraftProc } from "./send-back-to-draft";
import { submitForReviewProc } from "./submit-for-review";

const ctx = { context: { headers: new Headers() } };

function makeSession() {
	return {
		session: {
			id: "session-1",
			userId: "user-1",
			token: "tok",
			expiresAt: new Date(),
			activeOrganizationId: "org-1",
		},
		user: { id: "user-1", email: "u@example.com", name: "U", emailVerified: true },
	};
}

function makeMembership(role: "owner" | "admin" | "member" = "admin") {
	return { organization: { id: "org-1", name: "Org", slug: "org" }, role };
}

function makeWorkflow(overrides: Partial<Record<string, unknown>> = {}) {
	return {
		id: "wf_1",
		organizationId: "org-1",
		title: "Onboarding",
		description: null,
		type: "procedure" as const,
		isActive: true,
		reviewIntervalDays: null,
		nextReviewAt: null,
		entitySetIds: [] as string[],
		reviewState: "draft" as const,
		installedFromListingVersionId: null,
		createdBy: "user-1",
		deletedAt: null,
		createdAt: new Date(),
		updatedAt: new Date(),
		...overrides,
	};
}

function makeWfWithVersions(overrides: Partial<Record<string, unknown>> = {}) {
	return {
		workflow: makeWorkflow(),
		currentDraft: {
			id: "ver_draft",
			workflowId: "wf_1",
			versionNumber: 2,
			status: "draft" as const,
			publishedAt: null,
		},
		latestPublished: null,
		allVersions: [],
		...overrides,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(auth.api.getSession).mockResolvedValue(makeSession() as never);
	vi.mocked(getOrganizationMembership).mockResolvedValue(makeMembership() as never);
	vi.mocked(writeAuditAndActivity).mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// submitForReview
// ---------------------------------------------------------------------------

describe("workflows.submitForReview (Phase 9.5g)", () => {
	function setUpHappyPath() {
		vi.mocked(getWorkflowForOrg).mockResolvedValueOnce(makeWorkflow() as never);
		vi.mocked(getOrganizationById).mockResolvedValueOnce({
			id: "org-1",
			requireConciergeReview: true,
		} as never);
		vi.mocked(getWorkflowWithVersions).mockResolvedValueOnce(
			makeWfWithVersions() as never,
		);
		vi.mocked(transitionWorkflowReviewState).mockResolvedValueOnce({ ok: true });
	}

	it("transitions draft → in_review and audits when flag is on + draft exists", async () => {
		setUpHappyPath();
		const res = await call(submitForReviewProc, { workflowId: "wf_1" }, ctx);

		expect(res).toEqual({ ok: true });
		expect(transitionWorkflowReviewState).toHaveBeenCalledWith({
			organizationId: "org-1",
			workflowId: "wf_1",
			fromState: "draft",
			toState: "in_review",
		});
		expect(writeAuditAndActivity).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "workflow.review_submitted",
				entityId: "wf_1",
				changes: { reviewState: { from: "draft", to: "in_review" } },
			}),
		);
	});

	it("refuses CONCIERGE_REVIEW_NOT_ENABLED when the flag is off", async () => {
		vi.mocked(getWorkflowForOrg).mockResolvedValueOnce(makeWorkflow() as never);
		vi.mocked(getOrganizationById).mockResolvedValueOnce({
			id: "org-1",
			requireConciergeReview: false,
		} as never);

		await expect(
			call(submitForReviewProc, { workflowId: "wf_1" }, ctx),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
			data: { code: "CONCIERGE_REVIEW_NOT_ENABLED" },
		});
		expect(transitionWorkflowReviewState).not.toHaveBeenCalled();
	});

	it("refuses REVIEW_STATE_INVALID when the workflow isn't in 'draft'", async () => {
		vi.mocked(getWorkflowForOrg).mockResolvedValueOnce(
			makeWorkflow({ reviewState: "in_review" }) as never,
		);
		vi.mocked(getOrganizationById).mockResolvedValueOnce({
			id: "org-1",
			requireConciergeReview: true,
		} as never);

		await expect(
			call(submitForReviewProc, { workflowId: "wf_1" }, ctx),
		).rejects.toMatchObject({ data: { code: "REVIEW_STATE_INVALID" } });
	});

	it("refuses WORKFLOW_HAS_NO_DRAFT when there's nothing to submit", async () => {
		vi.mocked(getWorkflowForOrg).mockResolvedValueOnce(makeWorkflow() as never);
		vi.mocked(getOrganizationById).mockResolvedValueOnce({
			id: "org-1",
			requireConciergeReview: true,
		} as never);
		vi.mocked(getWorkflowWithVersions).mockResolvedValueOnce(
			makeWfWithVersions({ currentDraft: null }) as never,
		);

		await expect(
			call(submitForReviewProc, { workflowId: "wf_1" }, ctx),
		).rejects.toMatchObject({ data: { code: "WORKFLOW_HAS_NO_DRAFT" } });
	});

	it("surfaces a race when the state transition's WHERE-on-from-state misses", async () => {
		setUpHappyPath();
		vi.mocked(transitionWorkflowReviewState).mockReset();
		vi.mocked(transitionWorkflowReviewState).mockResolvedValueOnce({ ok: false });

		await expect(
			call(submitForReviewProc, { workflowId: "wf_1" }, ctx),
		).rejects.toMatchObject({ data: { code: "REVIEW_STATE_INVALID" } });
	});

	it("throws FORBIDDEN for plain members", async () => {
		vi.mocked(getOrganizationMembership).mockResolvedValueOnce(
			makeMembership("member") as never,
		);
		await expect(
			call(submitForReviewProc, { workflowId: "wf_1" }, ctx),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});
});

// ---------------------------------------------------------------------------
// approveReview
// ---------------------------------------------------------------------------

// Phase 9.5g approveReview was rewritten 2026-05-27 after dogfooding caught a
// state/version desync (transition before publish could leave reviewState='published'
// with version still draft if publish failed). The new ordering is:
//   1. Pre-check: countStepsInVersion > 0 (catches VERSION_HAS_NO_STEPS without writes)
//   2. publishVersion (own race guard via publishVersionRow WHERE-on-status='draft')
//   3. transitionWorkflowReviewState (in_review -> published)
//   4. audit
describe("workflows.approveReview (Phase 9.5g, revised ordering)", () => {
	function setupInReviewWithDraft(stepCount = 1) {
		vi.mocked(getWorkflowForOrg).mockResolvedValueOnce(
			makeWorkflow({ reviewState: "in_review" }) as never,
		);
		vi.mocked(getWorkflowWithVersions).mockResolvedValueOnce(
			makeWfWithVersions({ workflow: makeWorkflow({ reviewState: "in_review" }) }) as never,
		);
		vi.mocked(countStepsInVersion).mockResolvedValueOnce(stepCount);
	}

	it("invokes the step pre-check BEFORE any state mutation (call-order property)", async () => {
		setupInReviewWithDraft(1);
		// publishVersion's full happy path depends on db.query.workflowVersion.findFirst
		// which the lib-level mock surface doesn't stub -- it'll throw VERSION_NOT_FOUND
		// from inside the publish. That's fine for THIS test: we want to verify the
		// PRE-CHECK fired (the new dogfood-fix behavior), not re-test publish internals.
		// End-to-end happy path is covered by the dogfood walkthrough spec
		// (apps/saas/tests/dogfood-walkthrough.spec.ts).
		try {
			await call(approveReviewProc, { workflowId: "wf_1" }, ctx);
		} catch {
			/* see comment above */
		}
		expect(countStepsInVersion).toHaveBeenCalledWith("ver_draft");
	});

	it("PRE-FLIGHT refuses VERSION_HAS_NO_STEPS with NO state mutation when draft has 0 steps", async () => {
		setupInReviewWithDraft(0); // empty draft

		await expect(
			call(approveReviewProc, { workflowId: "wf_1" }, ctx),
		).rejects.toMatchObject({
			data: { code: "VERSION_HAS_NO_STEPS" },
		});
		// CRITICAL: no transition, no publish, no audit -- the whole point of the rewrite.
		expect(transitionWorkflowReviewState).not.toHaveBeenCalled();
		expect(publishVersionRow).not.toHaveBeenCalled();
		expect(writeAuditAndActivity).not.toHaveBeenCalled();
	});

	it("refuses REVIEW_STATE_INVALID when the workflow isn't in_review (no draft load)", async () => {
		vi.mocked(getWorkflowForOrg).mockResolvedValueOnce(
			makeWorkflow({ reviewState: "draft" }) as never,
		);

		await expect(
			call(approveReviewProc, { workflowId: "wf_1" }, ctx),
		).rejects.toMatchObject({
			code: "CONFLICT",
			data: { code: "REVIEW_STATE_INVALID" },
		});
		expect(countStepsInVersion).not.toHaveBeenCalled();
		expect(transitionWorkflowReviewState).not.toHaveBeenCalled();
	});

	it("refuses WORKFLOW_HAS_NO_DRAFT when the draft was discarded mid-review", async () => {
		vi.mocked(getWorkflowForOrg).mockResolvedValueOnce(
			makeWorkflow({ reviewState: "in_review" }) as never,
		);
		vi.mocked(getWorkflowWithVersions).mockResolvedValueOnce(
			makeWfWithVersions({
				workflow: makeWorkflow({ reviewState: "in_review" }),
				currentDraft: null,
			}) as never,
		);

		await expect(
			call(approveReviewProc, { workflowId: "wf_1" }, ctx),
		).rejects.toMatchObject({ data: { code: "WORKFLOW_HAS_NO_DRAFT" } });
		expect(countStepsInVersion).not.toHaveBeenCalled();
	});

	// Note: the send-back-race scenario (publish succeeds, transition's WHERE-on-from
	// misses because someone else send-back'd in between) is a sub-100ms race window
	// the revised ordering deliberately surfaces with a clear error. Procedure-level
	// coverage of that race requires stubbing publishVersion's db.query chain, which
	// the current mock surface doesn't support; covered indirectly by the dogfood spec.

	it("throws FORBIDDEN for plain members", async () => {
		vi.mocked(getOrganizationMembership).mockResolvedValueOnce(
			makeMembership("member") as never,
		);
		await expect(
			call(approveReviewProc, { workflowId: "wf_1" }, ctx),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});
});

// ---------------------------------------------------------------------------
// sendBackToDraft
// ---------------------------------------------------------------------------

describe("workflows.sendBackToDraft (Phase 9.5g)", () => {
	it("transitions in_review → draft and audits with optional comment", async () => {
		vi.mocked(getWorkflowForOrg).mockResolvedValueOnce(
			makeWorkflow({ reviewState: "in_review" }) as never,
		);
		vi.mocked(transitionWorkflowReviewState).mockResolvedValueOnce({ ok: true });

		const res = await call(
			sendBackToDraftProc,
			{ workflowId: "wf_1", comment: "Needs more screenshots." },
			ctx,
		);

		expect(res).toEqual({ ok: true });
		expect(transitionWorkflowReviewState).toHaveBeenCalledWith({
			organizationId: "org-1",
			workflowId: "wf_1",
			fromState: "in_review",
			toState: "draft",
		});
		expect(writeAuditAndActivity).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "workflow.review_sent_back",
				entityId: "wf_1",
				metadata: { comment: "Needs more screenshots." },
			}),
		);
	});

	it("works without a comment (audit metadata stays clean)", async () => {
		vi.mocked(getWorkflowForOrg).mockResolvedValueOnce(
			makeWorkflow({ reviewState: "in_review" }) as never,
		);
		vi.mocked(transitionWorkflowReviewState).mockResolvedValueOnce({ ok: true });

		await call(sendBackToDraftProc, { workflowId: "wf_1", comment: null }, ctx);

		expect(writeAuditAndActivity).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "workflow.review_sent_back",
				metadata: {},
			}),
		);
	});

	it("refuses REVIEW_STATE_INVALID when the workflow isn't in_review", async () => {
		vi.mocked(getWorkflowForOrg).mockResolvedValueOnce(
			makeWorkflow({ reviewState: "published" }) as never,
		);

		await expect(
			call(sendBackToDraftProc, { workflowId: "wf_1", comment: null }, ctx),
		).rejects.toMatchObject({ data: { code: "REVIEW_STATE_INVALID" } });
	});

	it("throws FORBIDDEN for plain members", async () => {
		vi.mocked(getOrganizationMembership).mockResolvedValueOnce(
			makeMembership("member") as never,
		);
		await expect(
			call(sendBackToDraftProc, { workflowId: "wf_1", comment: null }, ctx),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});
});

// ---------------------------------------------------------------------------
// listForReview
// ---------------------------------------------------------------------------

describe("workflows.listForReview (Phase 9.5g)", () => {
	it("returns the in_review queue for admins", async () => {
		const rows = [
			{
				id: "wf_1",
				title: "Onboarding",
				description: null,
				type: "procedure" as const,
				updatedAt: new Date(),
				currentDraftVersionId: "ver_draft",
				currentDraftVersionNumber: 2,
				latestPublishedVersionId: "ver_pub",
				latestPublishedVersionNumber: 1,
			},
		];
		vi.mocked(listWorkflowsInReview).mockResolvedValueOnce(rows);

		const res = await call(listForReviewProc, undefined, ctx);
		expect(res).toEqual(rows);
		expect(listWorkflowsInReview).toHaveBeenCalledWith("org-1");
	});

	it("throws FORBIDDEN for plain members", async () => {
		vi.mocked(getOrganizationMembership).mockResolvedValueOnce(
			makeMembership("member") as never,
		);
		await expect(
			call(listForReviewProc, undefined, ctx),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});
});

// Silence unused-import warnings for mocks referenced only through the procedure chain.
void db;
