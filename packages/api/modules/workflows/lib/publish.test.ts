// publishVersion + discardDraft tests (D-018).
//
// Focus: the state-machine transitions and the refusal modes. The deep-copy fork is
// covered separately in fork.test.ts.

import { beforeEach, describe, expect, it, vi } from "vitest";

// Minimal transactional db stub: tx === db; .transaction(fn) just invokes fn(db).
// vi.hoisted so the stub exists at the moment vi.mock's factory runs (hoisted above imports).
const { dbStub } = vi.hoisted(() => {
	const stub: {
		query: { workflowVersion: { findFirst: ReturnType<typeof vi.fn> } };
		transaction: ReturnType<typeof vi.fn>;
	} = {
		query: { workflowVersion: { findFirst: vi.fn() } },
		transaction: vi.fn(),
	};
	stub.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(stub));
	return { dbStub: stub };
});

vi.mock("@virn/database", () => ({
	db: dbStub,
	deleteVersion: vi.fn(),
	getLatestPublishedWorkflowVersion: vi.fn(),
	getVersionLaunchBundle: vi.fn(),
	getWorkflowWithVersions: vi.fn(),
	insertDraftVersion: vi.fn(),
	insertField: vi.fn(),
	insertSection: vi.fn(),
	insertStep: vi.fn(),
	insertStepDependency: vi.fn(),
	nextVersionNumber: vi.fn(),
	publishVersionRow: vi.fn(),
	updateStep: vi.fn(),
	writeAuditAndActivity: vi.fn(),
}));

import { deleteVersion, publishVersionRow, writeAuditAndActivity } from "@virn/database";

import { discardDraft, publishVersion } from "./publish";
import { WorkflowEngineError } from "./errors";

const CTX = { organizationId: "org_1", userId: "user_1" };

beforeEach(() => {
	vi.resetAllMocks();
	dbStub.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
		fn(dbStub),
	);
});

describe("publishVersion", () => {
	it("transitions draft -> published atomically + writes one audit row", async () => {
		dbStub.query.workflowVersion.findFirst.mockResolvedValue({
			id: "ver_1",
			status: "draft",
			versionNumber: 2,
			workflow: { id: "wf_1", organizationId: "org_1" },
			steps: [{ id: "step_1" }, { id: "step_2" }],
		});
		(publishVersionRow as ReturnType<typeof vi.fn>).mockResolvedValue(true);

		const result = await publishVersion(CTX, { versionId: "ver_1" });

		expect(result).toEqual({ versionId: "ver_1", versionNumber: 2 });
		expect(publishVersionRow).toHaveBeenCalledWith(
			{ versionId: "ver_1", publishedByUserId: "user_1" },
			dbStub,
		);
		expect(writeAuditAndActivity).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "workflow_version.published",
				entityType: "workflow_version",
				entityId: "ver_1",
				changes: { fromStatus: "draft", toStatus: "published" },
			}),
			dbStub,
		);
	});

	it("refuses VERSION_NOT_FOUND when version doesn't belong to the calling org", async () => {
		dbStub.query.workflowVersion.findFirst.mockResolvedValue({
			id: "ver_1",
			status: "draft",
			versionNumber: 1,
			workflow: { id: "wf_1", organizationId: "OTHER_ORG" },
			steps: [{ id: "step_1" }],
		});
		await expect(publishVersion(CTX, { versionId: "ver_1" })).rejects.toMatchObject({
			code: "VERSION_NOT_FOUND",
		});
		expect(publishVersionRow).not.toHaveBeenCalled();
	});

	it("refuses VERSION_NOT_DRAFT when status is published or archived", async () => {
		dbStub.query.workflowVersion.findFirst.mockResolvedValue({
			id: "ver_1",
			status: "published",
			versionNumber: 1,
			workflow: { id: "wf_1", organizationId: "org_1" },
			steps: [{ id: "step_1" }],
		});
		await expect(publishVersion(CTX, { versionId: "ver_1" })).rejects.toMatchObject({
			code: "VERSION_NOT_DRAFT",
		});
	});

	it("refuses VERSION_HAS_NO_STEPS on an empty version", async () => {
		dbStub.query.workflowVersion.findFirst.mockResolvedValue({
			id: "ver_1",
			status: "draft",
			versionNumber: 1,
			workflow: { id: "wf_1", organizationId: "org_1" },
			steps: [],
		});
		await expect(publishVersion(CTX, { versionId: "ver_1" })).rejects.toMatchObject({
			code: "VERSION_HAS_NO_STEPS",
		});
	});

	it("surfaces PUBLISH_RACE when the UPDATE matches zero rows (someone else published first)", async () => {
		dbStub.query.workflowVersion.findFirst.mockResolvedValue({
			id: "ver_1",
			status: "draft",
			versionNumber: 1,
			workflow: { id: "wf_1", organizationId: "org_1" },
			steps: [{ id: "step_1" }],
		});
		(publishVersionRow as ReturnType<typeof vi.fn>).mockResolvedValue(false);
		await expect(publishVersion(CTX, { versionId: "ver_1" })).rejects.toMatchObject({
			code: "PUBLISH_RACE",
		});
	});
});

describe("discardDraft", () => {
	it("deletes a draft when at least one other version exists", async () => {
		dbStub.query.workflowVersion.findFirst.mockResolvedValue({
			id: "ver_draft",
			status: "draft",
			workflow: {
				id: "wf_1",
				organizationId: "org_1",
				versions: [
					{ id: "ver_draft", status: "draft" },
					{ id: "ver_pub", status: "published" },
				],
			},
		});
		await expect(discardDraft(CTX, { versionId: "ver_draft" })).resolves.toBeUndefined();
		expect(deleteVersion).toHaveBeenCalledWith({ versionId: "ver_draft" }, dbStub);
		expect(writeAuditAndActivity).toHaveBeenCalledWith(
			expect.objectContaining({ action: "workflow_version.draft_discarded" }),
			dbStub,
		);
	});

	it("refuses VERSION_NOT_DRAFT when it's the only version (would orphan the workflow)", async () => {
		dbStub.query.workflowVersion.findFirst.mockResolvedValue({
			id: "ver_draft",
			status: "draft",
			workflow: {
				id: "wf_1",
				organizationId: "org_1",
				versions: [{ id: "ver_draft", status: "draft" }],
			},
		});
		const err = await discardDraft(CTX, { versionId: "ver_draft" }).catch((e) => e);
		expect(err).toBeInstanceOf(WorkflowEngineError);
		expect(err.code).toBe("VERSION_NOT_DRAFT");
		expect(deleteVersion).not.toHaveBeenCalled();
	});
});
