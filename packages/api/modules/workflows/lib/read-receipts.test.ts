// Workflows lib hardening -- read-receipt helpers (Phase 10 / v1.5c). All three wrap
// the queries with org-scoping, but with a DELIBERATE asymmetry worth pinning:
// markVersionAsRead + listVersionReadReceipts THROW VERSION_NOT_FOUND on cross-org
// (anti-enumeration), while getMyReadStatus returns {hasRead:false} silently (so the
// Read view button renders without distinguishing "not yours" from "not yet read").
// Plus the published-only gate on mark. Mocks @virn/database.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@virn/database", () => ({
	getVersionWithWorkflow: vi.fn(),
	hasUserReadVersion: vi.fn(),
	listReadReceiptsForVersion: vi.fn(),
	markWorkflowVersionAsRead: vi.fn(),
}));

import {
	getVersionWithWorkflow,
	hasUserReadVersion,
	listReadReceiptsForVersion,
	markWorkflowVersionAsRead,
} from "@virn/database";

import { getMyReadStatus, listVersionReadReceipts, markVersionAsRead } from "./read-receipts";

const ctx = { organizationId: "org-1", userId: "user-1" };

function bundle(over: { organizationId?: string; status?: string } = {}) {
	return {
		workflow: { id: "wf_1", organizationId: over.organizationId ?? "org-1" },
		version: { id: "ver_1", status: over.status ?? "published" },
	};
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("markVersionAsRead", () => {
	it("throws VERSION_NOT_FOUND when the version is missing", async () => {
		vi.mocked(getVersionWithWorkflow).mockResolvedValueOnce(null as never);
		await expect(markVersionAsRead(ctx, { workflowVersionId: "v_x" })).rejects.toMatchObject({
			code: "VERSION_NOT_FOUND",
		});
	});

	it("throws VERSION_NOT_FOUND for a cross-org version (anti-enumeration)", async () => {
		vi.mocked(getVersionWithWorkflow).mockResolvedValueOnce(bundle({ organizationId: "other-org" }) as never);
		await expect(markVersionAsRead(ctx, { workflowVersionId: "ver_1" })).rejects.toMatchObject({
			code: "VERSION_NOT_FOUND",
		});
		expect(markWorkflowVersionAsRead).not.toHaveBeenCalled();
	});

	it("throws VERSION_NOT_PUBLISHED when the version is a draft (only published SOPs are readable)", async () => {
		vi.mocked(getVersionWithWorkflow).mockResolvedValueOnce(bundle({ status: "draft" }) as never);
		await expect(markVersionAsRead(ctx, { workflowVersionId: "ver_1" })).rejects.toMatchObject({
			code: "VERSION_NOT_PUBLISHED",
		});
		expect(markWorkflowVersionAsRead).not.toHaveBeenCalled();
	});

	it("marks a published version + forwards org/workflow/version/user; passes through alreadyExisted", async () => {
		vi.mocked(getVersionWithWorkflow).mockResolvedValueOnce(bundle() as never);
		const result = { id: "rr_1", readAt: new Date(), alreadyExisted: true };
		vi.mocked(markWorkflowVersionAsRead).mockResolvedValueOnce(result as never);

		const res = await markVersionAsRead(ctx, { workflowVersionId: "ver_1" });

		expect(res).toEqual(result);
		expect(markWorkflowVersionAsRead).toHaveBeenCalledWith({
			organizationId: "org-1",
			workflowId: "wf_1",
			workflowVersionId: "ver_1",
			userId: "user-1",
		});
	});
});

describe("getMyReadStatus -- silent cross-org posture", () => {
	it("returns {hasRead:false} for a missing version WITHOUT querying the receipt table", async () => {
		vi.mocked(getVersionWithWorkflow).mockResolvedValueOnce(null as never);
		expect(await getMyReadStatus(ctx, { workflowVersionId: "v_x" })).toEqual({ hasRead: false, readAt: null });
		expect(hasUserReadVersion).not.toHaveBeenCalled();
	});

	it("returns {hasRead:false} for a cross-org version (no throw -- deliberate UX posture)", async () => {
		vi.mocked(getVersionWithWorkflow).mockResolvedValueOnce(bundle({ organizationId: "other-org" }) as never);
		expect(await getMyReadStatus(ctx, { workflowVersionId: "ver_1" })).toEqual({ hasRead: false, readAt: null });
		expect(hasUserReadVersion).not.toHaveBeenCalled();
	});

	it("returns {hasRead:true, readAt} when a receipt exists", async () => {
		const readAt = new Date("2026-06-01T10:00:00Z");
		vi.mocked(getVersionWithWorkflow).mockResolvedValueOnce(bundle() as never);
		vi.mocked(hasUserReadVersion).mockResolvedValueOnce({ readAt } as never);
		expect(await getMyReadStatus(ctx, { workflowVersionId: "ver_1" })).toEqual({ hasRead: true, readAt });
	});

	it("returns {hasRead:false} when no receipt exists", async () => {
		vi.mocked(getVersionWithWorkflow).mockResolvedValueOnce(bundle() as never);
		vi.mocked(hasUserReadVersion).mockResolvedValueOnce(null as never);
		expect(await getMyReadStatus(ctx, { workflowVersionId: "ver_1" })).toEqual({ hasRead: false, readAt: null });
	});
});

describe("listVersionReadReceipts (admin roster)", () => {
	it("throws VERSION_NOT_FOUND for a cross-org version", async () => {
		vi.mocked(getVersionWithWorkflow).mockResolvedValueOnce(bundle({ organizationId: "other-org" }) as never);
		await expect(listVersionReadReceipts(ctx, { workflowVersionId: "ver_1" })).rejects.toMatchObject({
			code: "VERSION_NOT_FOUND",
		});
		expect(listReadReceiptsForVersion).not.toHaveBeenCalled();
	});

	it("returns the receipt rows for an in-org version", async () => {
		vi.mocked(getVersionWithWorkflow).mockResolvedValueOnce(bundle() as never);
		const rows = [{ userId: "u1", readAt: new Date() }];
		vi.mocked(listReadReceiptsForVersion).mockResolvedValueOnce(rows as never);
		await expect(listVersionReadReceipts(ctx, { workflowVersionId: "ver_1" })).resolves.toEqual(rows);
	});
});
