// editPublished tests (D-018 resume-or-fork).
//
// The load-bearing correctness fix: at most ONE open draft per workflow. editPublished
// returns the existing draft when one is open (no new fork); only forks when none is
// open. Plus the deep-copy preserves field keys verbatim and remaps IDs.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbStub } = vi.hoisted(() => {
	const stub: {
		query: {
			workflowVersion: { findFirst: ReturnType<typeof vi.fn> };
			section: { findMany: ReturnType<typeof vi.fn> };
		};
		transaction: ReturnType<typeof vi.fn>;
	} = {
		query: {
			workflowVersion: { findFirst: vi.fn() },
			section: { findMany: vi.fn() },
		},
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

import {
	getLatestPublishedWorkflowVersion,
	getVersionLaunchBundle,
	getWorkflowWithVersions,
	insertDraftVersion,
	insertField,
	insertSection,
	insertStep,
	insertStepDependency,
	nextVersionNumber,
	writeAuditAndActivity,
} from "@virn/database";

import { editPublished } from "./publish";

const CTX = { organizationId: "org_1", userId: "user_1" };

beforeEach(() => {
	vi.resetAllMocks();
	dbStub.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
		fn(dbStub),
	);
});

describe("editPublished — resume path", () => {
	it("returns the existing draft when one is already open; does NOT fork", async () => {
		(getWorkflowWithVersions as ReturnType<typeof vi.fn>).mockResolvedValue({
			workflow: { id: "wf_1", organizationId: "org_1", deletedAt: null },
			currentDraft: { id: "draft_existing", versionNumber: 3 },
			latestPublished: { id: "pub_v2", versionNumber: 2 },
			allVersions: [],
		});

		const result = await editPublished(CTX, { workflowId: "wf_1" });

		expect(result).toEqual({
			draftVersionId: "draft_existing",
			draftVersionNumber: 3,
			forked: false,
		});
		// Fork path side effects must NOT fire.
		expect(insertDraftVersion).not.toHaveBeenCalled();
		expect(getLatestPublishedWorkflowVersion).not.toHaveBeenCalled();
		expect(getVersionLaunchBundle).not.toHaveBeenCalled();
		expect(writeAuditAndActivity).not.toHaveBeenCalled();
	});

	it("refuses on an archived workflow", async () => {
		(getWorkflowWithVersions as ReturnType<typeof vi.fn>).mockResolvedValue({
			workflow: { id: "wf_1", organizationId: "org_1", deletedAt: new Date() },
			currentDraft: null,
			latestPublished: { id: "pub_v1", versionNumber: 1 },
			allVersions: [],
		});
		await expect(editPublished(CTX, { workflowId: "wf_1" })).rejects.toMatchObject({
			code: "WORKFLOW_ARCHIVED",
		});
	});

	it("refuses VERSION_NOT_PUBLISHED when fork path is taken but no published version exists", async () => {
		(getWorkflowWithVersions as ReturnType<typeof vi.fn>).mockResolvedValue({
			workflow: { id: "wf_1", organizationId: "org_1", deletedAt: null },
			currentDraft: null,
			latestPublished: null,
			allVersions: [],
		});
		(getLatestPublishedWorkflowVersion as ReturnType<typeof vi.fn>).mockResolvedValue(null);
		await expect(editPublished(CTX, { workflowId: "wf_1" })).rejects.toMatchObject({
			code: "VERSION_NOT_PUBLISHED",
		});
	});
});

describe("editPublished — fork path", () => {
	it("deep-copies sections + steps + fields + step_dependencies; preserves field keys; remaps IDs; emits the audit row", async () => {
		(getWorkflowWithVersions as ReturnType<typeof vi.fn>).mockResolvedValue({
			workflow: { id: "wf_1", organizationId: "org_1", deletedAt: null },
			currentDraft: null,
			latestPublished: { id: "pub_v2", versionNumber: 2 },
			allVersions: [],
		});
		(getLatestPublishedWorkflowVersion as ReturnType<typeof vi.fn>).mockResolvedValue({
			id: "pub_v2",
			workflowId: "wf_1",
			versionNumber: 2,
		});
		(nextVersionNumber as ReturnType<typeof vi.fn>).mockResolvedValue(3);
		(insertDraftVersion as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "draft_v3" });

		(getVersionLaunchBundle as ReturnType<typeof vi.fn>).mockResolvedValue({
			steps: [
				{
					id: "step_old_1",
					workflowVersionId: "pub_v2",
					sectionId: "sec_old_1",
					assignedRoleId: "role_1",
					type: "task",
					title: "Step One",
					description: "First",
					position: 0,
					isRequired: true,
					isStopTask: false,
					dueType: "none",
					dueOffsetDays: null,
					dueAnchorStepId: null,
					dueSourceFieldId: null,
				},
				{
					id: "step_old_2",
					workflowVersionId: "pub_v2",
					sectionId: "sec_old_1",
					assignedRoleId: "role_1",
					type: "task",
					title: "Step Two",
					description: null,
					position: 1,
					isRequired: true,
					isStopTask: true,
					dueType: "offset_from_start",
					dueOffsetDays: 2,
					dueAnchorStepId: null,
					dueSourceFieldId: null,
				},
			],
			fields: [
				{
					id: "field_old_1",
					stepId: null, // kickoff
					key: "customer_name",
					label: "Customer name",
					fieldType: "text",
					config: null,
					isRequired: true,
					position: 0,
				},
				{
					id: "field_old_2",
					stepId: "step_old_1",
					key: "reference_number",
					label: "Reference number",
					fieldType: "text",
					config: null,
					isRequired: true,
					position: 0,
				},
			],
			deps: [{ stepId: "step_old_2", dependsOnStepId: "step_old_1" }],
		});

		// Section / step / field inserts simulate the new draft's id assignments.
		(insertSection as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "sec_new_1" });
		let nextStepId = 0;
		(insertStep as ReturnType<typeof vi.fn>).mockImplementation(async () => ({
			id: `step_new_${++nextStepId}`,
		}));
		let nextFieldId = 0;
		(insertField as ReturnType<typeof vi.fn>).mockImplementation(async () => ({
			id: `field_new_${++nextFieldId}`,
		}));

		// Sections aren't included in getVersionLaunchBundle; fork pulls them via tx.query.
		dbStub.query.section.findMany.mockResolvedValue([
			{ id: "sec_old_1", title: "Setup", position: 0 },
		]);

		const result = await editPublished(CTX, { workflowId: "wf_1" });

		expect(result).toEqual({
			draftVersionId: "draft_v3",
			draftVersionNumber: 3,
			forked: true,
		});

		// New draft created with versionNumber + 1.
		expect(insertDraftVersion).toHaveBeenCalledWith(
			{ workflowId: "wf_1", versionNumber: 3 },
			dbStub,
		);

		// Section copied with title + position; remapped to new id (drives section refs
		// on steps in the same fork).
		expect(insertSection).toHaveBeenCalledWith(
			{ workflowVersionId: "draft_v3", title: "Setup", position: 0 },
			dbStub,
		);

		// Steps copied with section ref REMAPPED to the new section id.
		const stepCalls = (insertStep as ReturnType<typeof vi.fn>).mock.calls;
		expect(stepCalls).toHaveLength(2);
		expect(stepCalls[0][0]).toMatchObject({
			workflowVersionId: "draft_v3",
			sectionId: "sec_new_1",
			title: "Step One",
		});
		expect(stepCalls[1][0]).toMatchObject({
			workflowVersionId: "draft_v3",
			sectionId: "sec_new_1",
			title: "Step Two",
			isStopTask: true,
		});

		// Fields copied with key PRESERVED verbatim (Invariant #5) and step ref REMAPPED.
		const fieldCalls = (insertField as ReturnType<typeof vi.fn>).mock.calls;
		expect(fieldCalls).toHaveLength(2);
		expect(fieldCalls[0][0]).toMatchObject({
			workflowVersionId: "draft_v3",
			stepId: null,
			key: "customer_name",
			label: "Customer name",
		});
		expect(fieldCalls[1][0]).toMatchObject({
			workflowVersionId: "draft_v3",
			stepId: "step_new_1", // remapped from step_old_1
			key: "reference_number",
			label: "Reference number",
		});

		// step_dependency endpoints both remapped.
		expect(insertStepDependency).toHaveBeenCalledWith(
			{ stepId: "step_new_2", dependsOnStepId: "step_new_1" },
			dbStub,
		);

		// Audit row for the fork event.
		expect(writeAuditAndActivity).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "workflow_version.fork_started",
				entityType: "workflow_version",
				entityId: "draft_v3",
				changes: { fromVersionId: "pub_v2", fromVersionNumber: 2 },
			}),
			dbStub,
		);
	});
});
