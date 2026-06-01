// Unit tests for importWorkflowFromMarkdown -- the markdown-import builder (Phase 13 slice B).
// The parser (parseStructuredMarkdown) is tested separately; here we pin the builder's
// orchestration with @virn/database + the parser mocked: parse-failure -> typed error, the
// titleOverride-vs-parsed-title resolution, one task step per parsed step (flagged
// manually_edited per D-040), the returned shape, and the markdown-import audit row.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { insertStep, insertWorkflowWithDraft, writeAuditAndActivity, parseStructuredMarkdown } =
	vi.hoisted(() => ({
		insertStep: vi.fn(),
		insertWorkflowWithDraft: vi.fn(),
		writeAuditAndActivity: vi.fn(),
		parseStructuredMarkdown: vi.fn(),
	}));

vi.mock("@virn/database", () => ({
	db: { transaction: async (fn: (tx: unknown) => unknown) => fn({}) },
	insertStep: (...a: unknown[]) => insertStep(...a),
	insertWorkflowWithDraft: (...a: unknown[]) => insertWorkflowWithDraft(...a),
	writeAuditAndActivity: (...a: unknown[]) => writeAuditAndActivity(...a),
}));
vi.mock("./markdown-import", () => ({
	parseStructuredMarkdown: (...a: unknown[]) => parseStructuredMarkdown(...a),
}));

import { WorkflowEngineError } from "../errors";
import { importWorkflowFromMarkdown } from "./markdown-import-builder";

const ctx = { organizationId: "org-1", userId: "user-1" };

function parsedWorkflow(overrides: Record<string, unknown> = {}) {
	return {
		title: "Parsed Title",
		description: "A description",
		detectedFormat: "tango",
		steps: [
			{ title: "Step one", description: "Do A" },
			{ title: "Step two", description: "Do B" },
		],
		...overrides,
	};
}

beforeEach(() => {
	insertWorkflowWithDraft.mockResolvedValue({ workflowId: "wf-1", versionId: "v-1" });
	insertStep.mockResolvedValue(undefined);
	writeAuditAndActivity.mockResolvedValue(undefined);
});

afterEach(() => vi.clearAllMocks());

describe("importWorkflowFromMarkdown", () => {
	it("throws IMPORT_NO_RECOGNIZABLE_STRUCTURE when the parser finds no structure", async () => {
		parseStructuredMarkdown.mockReturnValue(null);
		const err = await importWorkflowFromMarkdown(ctx, { source: "garbage" }).catch((e) => e);
		expect(err).toBeInstanceOf(WorkflowEngineError);
		expect(err.code).toBe("IMPORT_NO_RECOGNIZABLE_STRUCTURE");
		expect(insertWorkflowWithDraft).not.toHaveBeenCalled();
	});

	it("builds a draft + one task step per parsed step and returns the handoff shape", async () => {
		parseStructuredMarkdown.mockReturnValue(parsedWorkflow());
		const result = await importWorkflowFromMarkdown(ctx, { source: "md" });

		expect(result).toEqual({
			workflowId: "wf-1",
			draftVersionId: "v-1",
			title: "Parsed Title",
			stepCount: 2,
			detectedFormat: "tango",
		});
		expect(insertStep).toHaveBeenCalledTimes(2);
		expect(insertStep.mock.calls[0][0]).toMatchObject({
			workflowVersionId: "v-1",
			type: "task",
			title: "Step one",
			position: 0,
			isRequired: true,
			isStopTask: false,
			dueType: "none",
			provenance: "manually_edited",
		});
		expect(insertStep.mock.calls[1][0]).toMatchObject({ title: "Step two", position: 1 });
	});

	it("writes a markdown-import audit row (not tagged AI-authored)", async () => {
		parseStructuredMarkdown.mockReturnValue(parsedWorkflow());
		await importWorkflowFromMarkdown(ctx, { source: "md" });
		expect(writeAuditAndActivity).toHaveBeenCalledTimes(1);
		expect(writeAuditAndActivity.mock.calls[0][0]).toMatchObject({
			action: "workflow.imported_from_markdown",
			entityType: "workflow",
			entityId: "wf-1",
			changes: { detectedFormat: "tango", stepCount: 2 },
		});
	});

	it("uses a non-empty titleOverride (trimmed) over the parsed title", async () => {
		parseStructuredMarkdown.mockReturnValue(parsedWorkflow());
		const result = await importWorkflowFromMarkdown(ctx, {
			source: "md",
			titleOverride: "  Custom Name  ",
		});
		expect(result.title).toBe("Custom Name");
		expect(insertWorkflowWithDraft.mock.calls[0][0]).toMatchObject({ title: "Custom Name" });
	});

	it("falls back to the parsed title when titleOverride is blank/whitespace", async () => {
		parseStructuredMarkdown.mockReturnValue(parsedWorkflow());
		const result = await importWorkflowFromMarkdown(ctx, { source: "md", titleOverride: "   " });
		expect(result.title).toBe("Parsed Title");
	});
});
