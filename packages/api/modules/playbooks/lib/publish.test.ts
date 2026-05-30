// Phase 18a -- playbook publish lib tests. Mocks @virn/database to verify the
// gating composition (org-scope + draft-state + non-empty + race guards) and
// the audit emission shape. Step deep-copy semantics are spot-checked at the
// call-count level; the SQL behavior (CASCADE delete, parent_step_id rebind)
// is integration-test territory.

import { beforeEach, describe, expect, it, vi } from "vitest";

// dbStub.transaction passes its tx to the callback. The lib's queries accept
// `executor` so we mirror the dbStub for tx-aware calls. vi.hoisted so the
// stub exists when vi.mock's factory runs (hoisted above imports).
const { dbStub } = vi.hoisted(() => {
	const stub: { transaction: ReturnType<typeof vi.fn> } = {
		transaction: vi.fn(),
	};
	stub.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
		fn(stub),
	);
	return { dbStub: stub };
});

vi.mock("@virn/database", () => ({
	db: dbStub,
	countStepsInPlaybookVersion: vi.fn(),
	deletePlaybookVersion: vi.fn(),
	getCurrentDraftPlaybookVersion: vi.fn(),
	getLatestPublishedPlaybookVersion: vi.fn(),
	getPlaybookForOrg: vi.fn(),
	getPlaybookVersionForOrg: vi.fn(),
	insertPlaybookDraftVersionFrom: vi.fn(),
	insertPlaybookStep: vi.fn(),
	listPlaybookStepsForVersion: vi.fn(),
	nextPlaybookVersionNumber: vi.fn(),
	publishPlaybookVersionRow: vi.fn(),
	updatePlaybookStep: vi.fn(),
	writeAuditAndActivity: vi.fn(),
}));

import {
	countStepsInPlaybookVersion,
	deletePlaybookVersion,
	getCurrentDraftPlaybookVersion,
	getLatestPublishedPlaybookVersion,
	getPlaybookForOrg,
	getPlaybookVersionForOrg,
	insertPlaybookDraftVersionFrom,
	insertPlaybookStep,
	listPlaybookStepsForVersion,
	nextPlaybookVersionNumber,
	publishPlaybookVersionRow,
	updatePlaybookStep,
	writeAuditAndActivity,
} from "@virn/database";

import {
	discardPlaybookDraft,
	editPublishedPlaybook,
	publishPlaybookVersion,
} from "./publish";

const CTX = { organizationId: "org_1", userId: "user_1" };

function makeVersion(overrides: Partial<Record<string, unknown>> = {}) {
	return {
		id: "ver_1",
		playbookId: "pb_1",
		versionNumber: 1,
		triggerType: "manual" as const,
		triggerEvent: null,
		triggerConfig: {},
		dedupWindowHours: null,
		publishedAt: null,
		publishedBy: null,
		createdAt: new Date(),
		updatedAt: new Date(),
		...overrides,
	};
}

function makePlaybook(overrides: Partial<Record<string, unknown>> = {}) {
	return {
		id: "pb_1",
		organizationId: "org_1",
		name: "STR onboarding cadence",
		description: null,
		reviewState: "draft",
		isActive: false,
		deletedAt: null,
		...overrides,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(writeAuditAndActivity).mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// publishPlaybookVersion
// ---------------------------------------------------------------------------

describe("publishPlaybookVersion -- happy path", () => {
	it("publishes a draft + emits one audit/activity", async () => {
		vi.mocked(getPlaybookVersionForOrg).mockResolvedValueOnce(makeVersion() as never);
		vi.mocked(countStepsInPlaybookVersion).mockResolvedValueOnce(3);
		vi.mocked(publishPlaybookVersionRow).mockResolvedValueOnce(true);

		const result = await publishPlaybookVersion(CTX, { versionId: "ver_1" });

		expect(result).toEqual({ versionId: "ver_1", versionNumber: 1 });
		expect(publishPlaybookVersionRow).toHaveBeenCalledWith(
			{ versionId: "ver_1", publishedByUserId: "user_1" },
			expect.anything(),
		);
		expect(writeAuditAndActivity).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "playbook_version.published",
				entityType: "playbook_version",
				entityId: "ver_1",
			}),
			expect.anything(),
		);
	});
});

describe("publishPlaybookVersion -- refusal paths", () => {
	it("refuses VERSION_NOT_FOUND when the version isn't in this org", async () => {
		vi.mocked(getPlaybookVersionForOrg).mockResolvedValueOnce(null);
		await expect(
			publishPlaybookVersion(CTX, { versionId: "ver_x" }),
		).rejects.toMatchObject({ code: "VERSION_NOT_FOUND" });
		expect(publishPlaybookVersionRow).not.toHaveBeenCalled();
	});

	it("refuses VERSION_NOT_DRAFT when the version is already published", async () => {
		vi.mocked(getPlaybookVersionForOrg).mockResolvedValueOnce(
			makeVersion({ publishedAt: new Date() }) as never,
		);
		await expect(
			publishPlaybookVersion(CTX, { versionId: "ver_1" }),
		).rejects.toMatchObject({ code: "VERSION_NOT_DRAFT" });
	});

	it("refuses VERSION_HAS_NO_STEPS on empty playbook", async () => {
		vi.mocked(getPlaybookVersionForOrg).mockResolvedValueOnce(makeVersion() as never);
		vi.mocked(countStepsInPlaybookVersion).mockResolvedValueOnce(0);
		await expect(
			publishPlaybookVersion(CTX, { versionId: "ver_1" }),
		).rejects.toMatchObject({ code: "VERSION_HAS_NO_STEPS" });
	});

	it("refuses PUBLISH_RACE when concurrent publisher won the WHERE-null guard", async () => {
		vi.mocked(getPlaybookVersionForOrg).mockResolvedValueOnce(makeVersion() as never);
		vi.mocked(countStepsInPlaybookVersion).mockResolvedValueOnce(3);
		vi.mocked(publishPlaybookVersionRow).mockResolvedValueOnce(false);
		await expect(
			publishPlaybookVersion(CTX, { versionId: "ver_1" }),
		).rejects.toMatchObject({ code: "PUBLISH_RACE" });
	});
});

// ---------------------------------------------------------------------------
// editPublishedPlaybook
// ---------------------------------------------------------------------------

describe("editPublishedPlaybook -- resume path", () => {
	it("returns the existing draft when one exists (forked=false)", async () => {
		vi.mocked(getPlaybookForOrg).mockResolvedValueOnce(makePlaybook() as never);
		vi.mocked(getCurrentDraftPlaybookVersion).mockResolvedValueOnce(
			makeVersion({ id: "ver_draft", versionNumber: 2 }) as never,
		);

		const result = await editPublishedPlaybook(CTX, { playbookId: "pb_1" });

		expect(result).toEqual({
			draftVersionId: "ver_draft",
			draftVersionNumber: 2,
			forked: false,
		});
		// Fork path side effects should NOT fire.
		expect(insertPlaybookDraftVersionFrom).not.toHaveBeenCalled();
		expect(insertPlaybookStep).not.toHaveBeenCalled();
		expect(writeAuditAndActivity).not.toHaveBeenCalled();
	});
});

describe("editPublishedPlaybook -- fork path", () => {
	it("deep-copies steps + emits the forked audit (forked=true)", async () => {
		vi.mocked(getPlaybookForOrg).mockResolvedValueOnce(makePlaybook() as never);
		vi.mocked(getCurrentDraftPlaybookVersion).mockResolvedValueOnce(null);
		vi.mocked(getLatestPublishedPlaybookVersion).mockResolvedValueOnce(
			makeVersion({
				id: "ver_pub",
				versionNumber: 2,
				publishedAt: new Date(),
				publishedBy: "user_admin",
			}) as never,
		);
		vi.mocked(listPlaybookStepsForVersion).mockResolvedValueOnce([
			{
				id: "step_a",
				playbookVersionId: "ver_pub",
				position: 0,
				type: "wait_for_duration",
				config: { amount: 1, unit: "days" },
				branchLabel: null,
				parentStepId: null,
				provenance: "manually_edited",
				createdAt: new Date(),
				updatedAt: new Date(),
			},
			{
				id: "step_b",
				playbookVersionId: "ver_pub",
				position: 1,
				type: "send_notification",
				config: {},
				branchLabel: null,
				// Parent link -- triggers the second-pass updatePlaybookStep.
				parentStepId: "step_a",
				provenance: "ai_generated",
				createdAt: new Date(),
				updatedAt: new Date(),
			},
		] as never);
		vi.mocked(nextPlaybookVersionNumber).mockResolvedValueOnce(3);
		vi.mocked(insertPlaybookDraftVersionFrom).mockResolvedValueOnce({
			id: "ver_new",
		});
		vi.mocked(insertPlaybookStep).mockImplementation(
			async (input) =>
				({
					id: `new_${input.position}`,
					...input,
					branchLabel: input.branchLabel ?? null,
					parentStepId: input.parentStepId ?? null,
					provenance: input.provenance ?? "manually_edited",
					createdAt: new Date(),
					updatedAt: new Date(),
				}) as never,
		);

		const result = await editPublishedPlaybook(CTX, { playbookId: "pb_1" });

		expect(result.forked).toBe(true);
		expect(result.draftVersionNumber).toBe(3);
		expect(insertPlaybookStep).toHaveBeenCalledTimes(2);
		// Second pass: only the one step with a parent gets a parent-link UPDATE.
		expect(updatePlaybookStep).toHaveBeenCalledTimes(1);
		expect(updatePlaybookStep).toHaveBeenCalledWith(
			{ stepId: "new_1", parentStepId: "new_0" },
			expect.anything(),
		);
		expect(writeAuditAndActivity).toHaveBeenCalledWith(
			expect.objectContaining({ action: "playbook_version.forked" }),
			expect.anything(),
		);
	});

	it("refuses PLAYBOOK_NOT_FOUND for cross-org playbook", async () => {
		vi.mocked(getPlaybookForOrg).mockResolvedValueOnce(null);
		await expect(
			editPublishedPlaybook(CTX, { playbookId: "pb_x" }),
		).rejects.toMatchObject({ code: "PLAYBOOK_NOT_FOUND" });
	});

	it("refuses PLAYBOOK_ARCHIVED on a soft-deleted playbook", async () => {
		vi.mocked(getPlaybookForOrg).mockResolvedValueOnce(
			makePlaybook({ deletedAt: new Date() }) as never,
		);
		await expect(
			editPublishedPlaybook(CTX, { playbookId: "pb_1" }),
		).rejects.toMatchObject({ code: "PLAYBOOK_ARCHIVED" });
	});

	it("refuses PLAYBOOK_HAS_NO_DRAFT when there's neither a draft nor a published version", async () => {
		vi.mocked(getPlaybookForOrg).mockResolvedValueOnce(makePlaybook() as never);
		vi.mocked(getCurrentDraftPlaybookVersion).mockResolvedValueOnce(null);
		vi.mocked(getLatestPublishedPlaybookVersion).mockResolvedValueOnce(null);
		await expect(
			editPublishedPlaybook(CTX, { playbookId: "pb_1" }),
		).rejects.toMatchObject({ code: "PLAYBOOK_HAS_NO_DRAFT" });
	});
});

// ---------------------------------------------------------------------------
// discardPlaybookDraft
// ---------------------------------------------------------------------------

describe("discardPlaybookDraft", () => {
	it("deletes the draft + writes the discard audit", async () => {
		vi.mocked(getPlaybookForOrg).mockResolvedValueOnce(makePlaybook() as never);
		vi.mocked(getCurrentDraftPlaybookVersion).mockResolvedValueOnce(
			makeVersion({ id: "ver_draft", versionNumber: 2 }) as never,
		);
		vi.mocked(deletePlaybookVersion).mockResolvedValueOnce(undefined);

		const result = await discardPlaybookDraft(CTX, { playbookId: "pb_1" });

		expect(result).toEqual({
			discardedVersionId: "ver_draft",
			discardedVersionNumber: 2,
		});
		expect(deletePlaybookVersion).toHaveBeenCalledWith(
			{ versionId: "ver_draft" },
			expect.anything(),
		);
		expect(writeAuditAndActivity).toHaveBeenCalledWith(
			expect.objectContaining({ action: "playbook_version.discarded" }),
			expect.anything(),
		);
	});

	it("refuses PLAYBOOK_HAS_NO_DRAFT when no draft exists", async () => {
		vi.mocked(getPlaybookForOrg).mockResolvedValueOnce(makePlaybook() as never);
		vi.mocked(getCurrentDraftPlaybookVersion).mockResolvedValueOnce(null);
		await expect(
			discardPlaybookDraft(CTX, { playbookId: "pb_1" }),
		).rejects.toMatchObject({ code: "PLAYBOOK_HAS_NO_DRAFT" });
	});

	it("refuses PLAYBOOK_NOT_FOUND for cross-org playbook", async () => {
		vi.mocked(getPlaybookForOrg).mockResolvedValueOnce(null);
		await expect(
			discardPlaybookDraft(CTX, { playbookId: "pb_x" }),
		).rejects.toMatchObject({ code: "PLAYBOOK_NOT_FOUND" });
	});
});
