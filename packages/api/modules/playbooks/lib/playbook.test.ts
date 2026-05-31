// Playbooks lib hardening -- the MANUAL builder playbook-level CRUD (create / update /
// setActive / archive). Distinct from the AI-authoring path (ai-authoring/*.test.ts),
// publish (publish.test.ts), and the procedure gate (playbooks-authz.test.ts) -- none of
// which exercise this lib. Pins: PLAYBOOK_NAME_CONFLICT mapping, NOT_FOUND/ARCHIVED
// refusals, the no-op + idempotent short-circuits, and the audit shapes. Mocks @virn/database.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@virn/database", () => ({
	getPlaybookForOrg: vi.fn(),
	insertPlaybookWithDraft: vi.fn(),
	updatePlaybook: vi.fn(),
	setPlaybookActive: vi.fn(),
	softDeletePlaybook: vi.fn(),
	writeAuditAndActivity: vi.fn(),
	// imported + void-ed at module load
	createPlaybook: vi.fn(),
	getOrganizationById: vi.fn(),
}));

import {
	getPlaybookForOrg,
	insertPlaybookWithDraft,
	setPlaybookActive,
	softDeletePlaybook,
	updatePlaybook,
	writeAuditAndActivity,
} from "@virn/database";

import {
	archivePlaybookOp,
	createPlaybookOp,
	setPlaybookActiveOp,
	updatePlaybookOp,
} from "./playbook";

const ctx = { organizationId: "org-1", userId: "user-1" };

function pb(over: Record<string, unknown> = {}) {
	return {
		id: "pb_1",
		name: "Post-stay cadence",
		description: null,
		entitySetIds: [] as string[],
		isActive: false,
		deletedAt: null as Date | null,
		...over,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(writeAuditAndActivity).mockResolvedValue(undefined);
	vi.mocked(updatePlaybook).mockResolvedValue(undefined as never);
	vi.mocked(setPlaybookActive).mockResolvedValue(undefined as never);
	vi.mocked(softDeletePlaybook).mockResolvedValue(undefined as never);
});

describe("createPlaybookOp", () => {
	it("inserts with draft + audits playbook.created; returns ids", async () => {
		vi.mocked(getPlaybookForOrg).mockResolvedValueOnce(null as never);
		vi.mocked(insertPlaybookWithDraft).mockResolvedValueOnce({ playbookId: "pb_1", versionId: "ver_1" } as never);

		const res = await createPlaybookOp(ctx, { name: "Post-stay cadence" });

		expect(res).toEqual({ playbookId: "pb_1", draftVersionId: "ver_1" });
		expect(writeAuditAndActivity).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "playbook.created",
				entityId: "pb_1",
				metadata: { initialDraftVersionId: "ver_1" },
			}),
		);
	});

	it("maps a unique-name violation to PLAYBOOK_NAME_CONFLICT", async () => {
		vi.mocked(getPlaybookForOrg).mockResolvedValueOnce(null as never);
		vi.mocked(insertPlaybookWithDraft).mockRejectedValueOnce(
			new Error('duplicate key value violates unique constraint "uq_playbook_org_name"'),
		);
		await expect(createPlaybookOp(ctx, { name: "Dupe" })).rejects.toMatchObject({ code: "PLAYBOOK_NAME_CONFLICT" });
	});

	it("patches entity-set scope immediately when provided at create time", async () => {
		vi.mocked(getPlaybookForOrg).mockResolvedValueOnce(null as never);
		vi.mocked(insertPlaybookWithDraft).mockResolvedValueOnce({ playbookId: "pb_1", versionId: "ver_1" } as never);
		await createPlaybookOp(ctx, { name: "X", entitySetIds: ["es_1"] });
		expect(updatePlaybook).toHaveBeenCalledWith(
			expect.objectContaining({ playbookId: "pb_1", entitySetIds: ["es_1"] }),
		);
	});
});

describe("updatePlaybookOp", () => {
	it("throws PLAYBOOK_NOT_FOUND for a missing/cross-org playbook", async () => {
		vi.mocked(getPlaybookForOrg).mockResolvedValueOnce(null as never);
		await expect(updatePlaybookOp(ctx, { playbookId: "pb_x", name: "x" })).rejects.toMatchObject({
			code: "PLAYBOOK_NOT_FOUND",
		});
	});

	it("throws PLAYBOOK_ARCHIVED when the playbook is soft-deleted", async () => {
		vi.mocked(getPlaybookForOrg).mockResolvedValueOnce(pb({ deletedAt: new Date() }) as never);
		await expect(updatePlaybookOp(ctx, { playbookId: "pb_1", name: "x" })).rejects.toMatchObject({
			code: "PLAYBOOK_ARCHIVED",
		});
	});

	it("is a NO-OP when the value is unchanged (no update, no audit)", async () => {
		vi.mocked(getPlaybookForOrg).mockResolvedValueOnce(pb({ name: "Post-stay cadence" }) as never);
		await updatePlaybookOp(ctx, { playbookId: "pb_1", name: "Post-stay cadence" });
		expect(updatePlaybook).not.toHaveBeenCalled();
		expect(writeAuditAndActivity).not.toHaveBeenCalled();
	});

	it("updates + audits a changed name with a from/to diff", async () => {
		vi.mocked(getPlaybookForOrg).mockResolvedValueOnce(pb({ name: "Old" }) as never);
		await updatePlaybookOp(ctx, { playbookId: "pb_1", name: "New" });
		expect(writeAuditAndActivity).toHaveBeenCalledWith(
			expect.objectContaining({ action: "playbook.updated", changes: { name: { from: "Old", to: "New" } } }),
		);
	});

	it("maps a unique-name violation on update to PLAYBOOK_NAME_CONFLICT", async () => {
		vi.mocked(getPlaybookForOrg).mockResolvedValueOnce(pb({ name: "Old" }) as never);
		vi.mocked(updatePlaybook).mockRejectedValueOnce(
			new Error('duplicate key value violates unique constraint "uq_playbook_org_name"'),
		);
		await expect(updatePlaybookOp(ctx, { playbookId: "pb_1", name: "Taken" })).rejects.toMatchObject({
			code: "PLAYBOOK_NAME_CONFLICT",
		});
	});
});

describe("setPlaybookActiveOp", () => {
	it("throws PLAYBOOK_NOT_FOUND when missing", async () => {
		vi.mocked(getPlaybookForOrg).mockResolvedValueOnce(null as never);
		await expect(setPlaybookActiveOp(ctx, { playbookId: "pb_x", isActive: true })).rejects.toMatchObject({
			code: "PLAYBOOK_NOT_FOUND",
		});
	});

	it("is an idempotent no-op when isActive already matches", async () => {
		vi.mocked(getPlaybookForOrg).mockResolvedValueOnce(pb({ isActive: true }) as never);
		await setPlaybookActiveOp(ctx, { playbookId: "pb_1", isActive: true });
		expect(setPlaybookActive).not.toHaveBeenCalled();
		expect(writeAuditAndActivity).not.toHaveBeenCalled();
	});

	it("enables + audits playbook.enabled", async () => {
		vi.mocked(getPlaybookForOrg).mockResolvedValueOnce(pb({ isActive: false }) as never);
		await setPlaybookActiveOp(ctx, { playbookId: "pb_1", isActive: true });
		expect(setPlaybookActive).toHaveBeenCalledWith(expect.objectContaining({ playbookId: "pb_1", isActive: true }));
		expect(writeAuditAndActivity).toHaveBeenCalledWith(expect.objectContaining({ action: "playbook.enabled" }));
	});

	it("disables + audits playbook.disabled", async () => {
		vi.mocked(getPlaybookForOrg).mockResolvedValueOnce(pb({ isActive: true }) as never);
		await setPlaybookActiveOp(ctx, { playbookId: "pb_1", isActive: false });
		expect(writeAuditAndActivity).toHaveBeenCalledWith(expect.objectContaining({ action: "playbook.disabled" }));
	});
});

describe("archivePlaybookOp", () => {
	it("throws PLAYBOOK_NOT_FOUND when missing", async () => {
		vi.mocked(getPlaybookForOrg).mockResolvedValueOnce(null as never);
		await expect(archivePlaybookOp(ctx, { playbookId: "pb_x" })).rejects.toMatchObject({ code: "PLAYBOOK_NOT_FOUND" });
	});

	it("is idempotent: an already-archived playbook is a no-op", async () => {
		vi.mocked(getPlaybookForOrg).mockResolvedValueOnce(pb({ deletedAt: new Date() }) as never);
		await archivePlaybookOp(ctx, { playbookId: "pb_1" });
		expect(softDeletePlaybook).not.toHaveBeenCalled();
		expect(writeAuditAndActivity).not.toHaveBeenCalled();
	});

	it("archives a live playbook + audits playbook.archived", async () => {
		vi.mocked(getPlaybookForOrg).mockResolvedValueOnce(pb() as never);
		await archivePlaybookOp(ctx, { playbookId: "pb_1" });
		expect(softDeletePlaybook).toHaveBeenCalledWith({ organizationId: "org-1", playbookId: "pb_1" });
		expect(writeAuditAndActivity).toHaveBeenCalledWith(expect.objectContaining({ action: "playbook.archived" }));
	});
});
