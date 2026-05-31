// Phase 16 -- suggestions lib tests. Mocks the @virn/database boundary;
// verifies capability + workflow-org gating on submit, idempotent
// open->resolved transition + audit emission on decide.

import { ORPCError } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@virn/database", () => ({
	getSuggestionForOrg: vi.fn(),
	getWorkflowForOrg: vi.fn(),
	insertSuggestion: vi.fn(),
	isCapabilityEnabledForOrg: vi.fn(),
	listSuggestionsForOrg: vi.fn(),
	updateSuggestionStatus: vi.fn(),
	writeAuditAndActivity: vi.fn(),
}));

import {
	getSuggestionForOrg,
	getWorkflowForOrg,
	insertSuggestion,
	isCapabilityEnabledForOrg,
	listSuggestionsForOrg,
	updateSuggestionStatus,
	writeAuditAndActivity,
} from "@virn/database";

import { decideSuggestion, listSuggestions, submitSuggestion } from "./suggestion";

const ctx = { organizationId: "org-1", userId: "user-1" };

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(isCapabilityEnabledForOrg).mockResolvedValue(true);
	vi.mocked(writeAuditAndActivity).mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// submitSuggestion
// ---------------------------------------------------------------------------

describe("submitSuggestion", () => {
	it("inserts the row + emits the audit", async () => {
		vi.mocked(getWorkflowForOrg).mockResolvedValueOnce({ id: "wf_1" } as never);
		vi.mocked(insertSuggestion).mockResolvedValueOnce({
			id: "sug_1",
			createdAt: new Date(),
		});

		const result = await submitSuggestion(ctx, {
			workflowId: "wf_1",
			body: "Add a stop-task after step 3.",
		});

		expect(result.id).toBe("sug_1");
		expect(insertSuggestion).toHaveBeenCalledWith({
			organizationId: "org-1",
			workflowId: "wf_1",
			suggestedByUserId: "user-1",
			body: "Add a stop-task after step 3.",
		});
		expect(writeAuditAndActivity).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "suggestion.created",
				entityType: "suggestion",
				activityData: { workflowId: "wf_1" },
			}),
		);
	});

	it("refuses NOT_FOUND when workflow doesn't exist in org", async () => {
		vi.mocked(getWorkflowForOrg).mockResolvedValueOnce(null);
		await expect(
			submitSuggestion(ctx, { workflowId: "wf_x", body: "x" }),
		).rejects.toMatchObject({
			code: "NOT_FOUND",
			data: { code: "WORKFLOW_NOT_FOUND" },
		});
	});

	it("refuses when capability is off", async () => {
		vi.mocked(getWorkflowForOrg).mockResolvedValueOnce({ id: "wf_1" } as never);
		vi.mocked(isCapabilityEnabledForOrg).mockResolvedValueOnce(false);
		await expect(
			submitSuggestion(ctx, { workflowId: "wf_1", body: "x" }),
		).rejects.toMatchObject({
			code: "FORBIDDEN",
			data: { code: "CAPABILITY_DISABLED" },
		});
	});
});

// ---------------------------------------------------------------------------
// decideSuggestion
// ---------------------------------------------------------------------------

describe("decideSuggestion", () => {
	it("transitions open -> accepted + emits the audit", async () => {
		vi.mocked(getSuggestionForOrg).mockResolvedValueOnce({
			id: "sug_1",
			workflowId: "wf_1",
			status: "open",
			body: "x",
		});
		vi.mocked(updateSuggestionStatus).mockResolvedValueOnce({
			id: "sug_1",
			resolvedAt: new Date(),
		});

		const result = await decideSuggestion(ctx, {
			suggestionId: "sug_1",
			status: "accepted",
		});

		expect(result.status).toBe("accepted");
		expect(writeAuditAndActivity).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "suggestion.accepted",
				verb: "accepted",
			}),
		);
	});

	it("refuses NOT_FOUND for cross-org suggestion", async () => {
		vi.mocked(getSuggestionForOrg).mockResolvedValueOnce(null);
		await expect(
			decideSuggestion(ctx, { suggestionId: "sug_x", status: "rejected" }),
		).rejects.toMatchObject({
			code: "NOT_FOUND",
			data: { code: "SUGGESTION_NOT_FOUND" },
		});
	});

	it("refuses CONFLICT when already resolved", async () => {
		vi.mocked(getSuggestionForOrg).mockResolvedValueOnce({
			id: "sug_1",
			workflowId: "wf_1",
			status: "rejected",
			body: "x",
		});
		await expect(
			decideSuggestion(ctx, { suggestionId: "sug_1", status: "accepted" }),
		).rejects.toMatchObject({
			code: "CONFLICT",
			data: { code: "SUGGESTION_ALREADY_RESOLVED" },
		});
		expect(updateSuggestionStatus).not.toHaveBeenCalled();
	});

	it("refuses CONFLICT when WHERE-open update matched zero rows (concurrent decider)", async () => {
		vi.mocked(getSuggestionForOrg).mockResolvedValueOnce({
			id: "sug_1",
			workflowId: "wf_1",
			status: "open",
			body: "x",
		});
		vi.mocked(updateSuggestionStatus).mockResolvedValueOnce(null);

		await expect(
			decideSuggestion(ctx, { suggestionId: "sug_1", status: "merged" }),
		).rejects.toMatchObject({
			code: "CONFLICT",
			data: { code: "SUGGESTION_ALREADY_RESOLVED" },
		});
	});

	// Governance hardening: the capability gate on the decide path (after the
	// open check) was previously unverified.
	it("refuses FORBIDDEN when the suggestions capability is off (no update, no audit)", async () => {
		vi.mocked(getSuggestionForOrg).mockResolvedValueOnce({
			id: "sug_1",
			workflowId: "wf_1",
			status: "open",
			body: "x",
		});
		vi.mocked(isCapabilityEnabledForOrg).mockResolvedValueOnce(false);

		await expect(
			decideSuggestion(ctx, { suggestionId: "sug_1", status: "accepted" }),
		).rejects.toMatchObject({ code: "FORBIDDEN", data: { code: "CAPABILITY_DISABLED" } });
		expect(updateSuggestionStatus).not.toHaveBeenCalled();
		expect(writeAuditAndActivity).not.toHaveBeenCalled();
	});

	// The audit action + verb are built from the decision status -- pin rejected
	// and merged too (only accepted was covered).
	it.each(["rejected", "merged"] as const)(
		"emits the suggestion.%s audit on a %s decision",
		async (status) => {
			vi.mocked(getSuggestionForOrg).mockResolvedValueOnce({
				id: "sug_1",
				workflowId: "wf_1",
				status: "open",
				body: "x",
			});
			vi.mocked(updateSuggestionStatus).mockResolvedValueOnce({ id: "sug_1", resolvedAt: new Date() });

			const result = await decideSuggestion(ctx, { suggestionId: "sug_1", status });

			expect(result.status).toBe(status);
			expect(writeAuditAndActivity).toHaveBeenCalledWith(
				expect.objectContaining({ action: `suggestion.${status}`, verb: status }),
			);
		},
	);
});

// ---------------------------------------------------------------------------
// listSuggestions (admin triage) -- previously uncovered
// ---------------------------------------------------------------------------

describe("listSuggestions", () => {
	it("forwards org + filters + pagination to the org-scoped query", async () => {
		vi.mocked(listSuggestionsForOrg).mockResolvedValueOnce({
			rows: [{ id: "sug_1" }],
			totalCount: 1,
		} as never);

		const res = await listSuggestions(ctx, {
			workflowId: "wf_1",
			status: "open",
			limit: 20,
			offset: 10,
		});

		expect(res).toEqual({ rows: [{ id: "sug_1" }], totalCount: 1 });
		expect(listSuggestionsForOrg).toHaveBeenCalledWith({
			organizationId: "org-1",
			workflowId: "wf_1",
			status: "open",
			limit: 20,
			offset: 10,
		});
	});
});
