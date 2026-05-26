// preview-adapter.test.ts
//
// The definition->synthetic-run adapter is a pure data transform; this test pins its
// shape so the BuilderView preview body can rely on what it gets back. Empty values,
// all-pending statuses, blocked=false, and synthetic ids prefixed with `preview_` so
// the parent can map back when the user navigates between modes.

import { describe, expect, it } from "vitest";

import { buildPreviewFromBundle } from "./preview-adapter";
import type { VersionEditBundleResponse } from "./types";

// The fixture is a structural minimum -- we cast to the broader oRPC response type so
// we don't have to repeat every column added by Drizzle (createdAt, updatedAt,
// hiddenByDefault, reviewIntervalDays, ...). The adapter only reads the fields below;
// missing columns are irrelevant to its behavior.
function makeBundle(): VersionEditBundleResponse {
	return {
		workflow: {
			id: "wf_1",
			organizationId: "org_1",
			title: "Onboarding",
			description: null,
			type: "procedure",
			isActive: true,
		},
		version: {
			id: "ver_1",
			workflowId: "wf_1",
			versionNumber: 2,
			status: "draft",
			publishedAt: null,
			publishedBy: null,
		},
		sections: [{ id: "sec_1", workflowVersionId: "ver_1", title: "Setup", position: 0 }],
		steps: [
			{
				id: "step_2",
				workflowVersionId: "ver_1",
				sectionId: "sec_1",
				assignedRoleId: null,
				type: "task",
				title: "Second",
				description: null,
				position: 1,
				isRequired: true,
				isStopTask: false,
				dueType: "none",
				dueOffsetDays: null,
				dueAnchorStepId: null,
				dueSourceFieldId: null,
			},
			{
				id: "step_1",
				workflowVersionId: "ver_1",
				sectionId: "sec_1",
				assignedRoleId: null,
				type: "task",
				title: "First",
				description: "Do the first thing",
				position: 0,
				isRequired: true,
				isStopTask: true,
				dueType: "none",
				dueOffsetDays: null,
				dueAnchorStepId: null,
				dueSourceFieldId: null,
			},
		],
		fields: [
			{
				id: "field_kickoff",
				stepId: null,
				key: "customer_name",
				label: "Customer name",
				fieldType: "text",
				config: null,
				isRequired: true,
				position: 0,
				isKeyLocked: false,
			},
		],
		dependencies: [],
	} as unknown as VersionEditBundleResponse;
}

describe("buildPreviewFromBundle", () => {
	const preview = buildPreviewFromBundle(makeBundle(), "Onboarding");

	it("synthesizes a run header that mirrors the version + workflow", () => {
		expect(preview.id).toBe("preview_ver_1");
		expect(preview.title).toBe("Onboarding");
		expect(preview.status).toBe("active");
		expect(preview.dueAt).toBeNull();
		expect(preview.workflow.id).toBe("wf_1");
		expect(preview.workflow.type).toBe("procedure");
	});

	it("orders steps by position regardless of input order", () => {
		expect(preview.steps.map((s) => s.title)).toEqual(["First", "Second"]);
	});

	it("every synthetic step is pending + unblocked + canComplete=true (operator's fresh view)", () => {
		for (const s of preview.steps) {
			expect(s.status).toBe("pending");
			expect(s.blocked).toBe(false);
			expect(s.canComplete).toBe(true);
			expect(s.dueAt).toBeNull();
			expect(s.assignees).toEqual([]);
		}
	});

	it("synthetic runStep ids carry the `preview_` prefix so the parent can map back to defStepId", () => {
		for (const s of preview.steps) {
			expect(s.id).toMatch(/^preview_/);
			expect(s.stepId).not.toMatch(/^preview_/);
			expect(s.id).toBe(`preview_${s.stepId}`);
		}
	});

	it("no field values, no participants, no role assignments -- preview shows the blank canvas", () => {
		expect(preview.values).toEqual([]);
		expect(preview.participants).toEqual([]);
		expect(preview.roleAssignments).toEqual([]);
	});
});
