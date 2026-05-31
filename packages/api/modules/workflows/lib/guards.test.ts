// Workflows lib hardening -- the Invariant #3 chokepoint (guards.ts). Every
// section/step/field/dependency write routes through these guards, which prove the
// version belongs to the calling org AND is a draft. This pins the full decision
// matrix per guard (not-found / archived / cross-org-as-not-found / non-draft /
// happy). Mocks @virn/database at the getter boundary.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@virn/database", () => ({
	getWorkflowForOrg: vi.fn(),
	getVersionWithWorkflow: vi.fn(),
	getSectionWithVersion: vi.fn(),
	getStepWithVersion: vi.fn(),
	getFieldWithVersion: vi.fn(),
}));

import {
	getFieldWithVersion,
	getSectionWithVersion,
	getStepWithVersion,
	getVersionWithWorkflow,
	getWorkflowForOrg,
} from "@virn/database";

import {
	assertFieldEditable,
	assertSectionEditable,
	assertStepEditable,
	assertVersionInOrg,
	assertVersionIsDraft,
	assertWorkflowInOrg,
} from "./guards";

const ctx = { organizationId: "org-1" };

beforeEach(() => {
	vi.clearAllMocks();
});

describe("assertWorkflowInOrg", () => {
	it("throws WORKFLOW_NOT_FOUND when the workflow isn't in the org", async () => {
		vi.mocked(getWorkflowForOrg).mockResolvedValueOnce(null as never);
		await expect(assertWorkflowInOrg(ctx, "wf_x")).rejects.toMatchObject({ code: "WORKFLOW_NOT_FOUND" });
	});

	it("throws WORKFLOW_ARCHIVED when the workflow is soft-deleted", async () => {
		vi.mocked(getWorkflowForOrg).mockResolvedValueOnce({ id: "wf_1", deletedAt: new Date() } as never);
		await expect(assertWorkflowInOrg(ctx, "wf_1")).rejects.toMatchObject({ code: "WORKFLOW_ARCHIVED" });
	});

	it("returns the workflow when active", async () => {
		const wf = { id: "wf_1", deletedAt: null };
		vi.mocked(getWorkflowForOrg).mockResolvedValueOnce(wf as never);
		await expect(assertWorkflowInOrg(ctx, "wf_1")).resolves.toEqual(wf);
	});
});

describe("assertVersionInOrg", () => {
	it("throws VERSION_NOT_FOUND when the version is missing", async () => {
		vi.mocked(getVersionWithWorkflow).mockResolvedValueOnce(null as never);
		await expect(assertVersionInOrg(ctx, "v_x")).rejects.toMatchObject({ code: "VERSION_NOT_FOUND" });
	});

	it("throws VERSION_NOT_FOUND (not a distinct code) for a cross-org version (anti-enumeration)", async () => {
		vi.mocked(getVersionWithWorkflow).mockResolvedValueOnce({
			version: { id: "v1", status: "draft" },
			workflow: { id: "wf_1", organizationId: "other-org" },
		} as never);
		await expect(assertVersionInOrg(ctx, "v1")).rejects.toMatchObject({ code: "VERSION_NOT_FOUND" });
	});

	it("returns the pair for an in-org version", async () => {
		const pair = { version: { id: "v1", status: "draft" }, workflow: { id: "wf_1", organizationId: "org-1" } };
		vi.mocked(getVersionWithWorkflow).mockResolvedValueOnce(pair as never);
		await expect(assertVersionInOrg(ctx, "v1")).resolves.toEqual(pair);
	});
});

describe("assertVersionIsDraft", () => {
	it("inherits the cross-org NOT_FOUND from assertVersionInOrg", async () => {
		vi.mocked(getVersionWithWorkflow).mockResolvedValueOnce({
			version: { id: "v1", status: "draft" },
			workflow: { id: "wf_1", organizationId: "other-org" },
		} as never);
		await expect(assertVersionIsDraft(ctx, "v1")).rejects.toMatchObject({ code: "VERSION_NOT_FOUND" });
	});

	it.each(["published", "archived"] as const)(
		"throws VERSION_NOT_DRAFT for a %s version",
		async (status) => {
			vi.mocked(getVersionWithWorkflow).mockResolvedValueOnce({
				version: { id: "v1", status },
				workflow: { id: "wf_1", organizationId: "org-1" },
			} as never);
			await expect(assertVersionIsDraft(ctx, "v1")).rejects.toMatchObject({ code: "VERSION_NOT_DRAFT" });
		},
	);

	it("returns the pair for a draft version", async () => {
		const pair = { version: { id: "v1", status: "draft" }, workflow: { id: "wf_1", organizationId: "org-1" } };
		vi.mocked(getVersionWithWorkflow).mockResolvedValueOnce(pair as never);
		await expect(assertVersionIsDraft(ctx, "v1")).resolves.toEqual(pair);
	});
});

// The three entity-editable guards share an identical decision shape; drive them
// through a table so the matrix is pinned uniformly (not-found / cross-org / non-draft
// / happy).
const entityGuards = [
	{ name: "section", fn: assertSectionEditable, getter: getSectionWithVersion, notFound: "SECTION_NOT_FOUND", payloadKey: "section" },
	{ name: "step", fn: assertStepEditable, getter: getStepWithVersion, notFound: "STEP_NOT_FOUND", payloadKey: "step" },
	{ name: "field", fn: assertFieldEditable, getter: getFieldWithVersion, notFound: "FIELD_NOT_FOUND", payloadKey: "field" },
] as const;

for (const g of entityGuards) {
	describe(`assert${g.name[0].toUpperCase()}${g.name.slice(1)}Editable`, () => {
		const entity = { id: `${g.name}_1` };
		const withVersion = (status: string) => ({ [g.payloadKey]: entity, version: { id: "v1", status } });

		it(`throws ${g.notFound} when the ${g.name} doesn't exist`, async () => {
			vi.mocked(g.getter).mockResolvedValueOnce(null as never);
			await expect(g.fn(ctx, `${g.name}_x`)).rejects.toMatchObject({ code: g.notFound });
		});

		it(`throws ${g.notFound} for a cross-org ${g.name} (anti-enumeration)`, async () => {
			vi.mocked(g.getter).mockResolvedValueOnce(withVersion("draft") as never);
			vi.mocked(getVersionWithWorkflow).mockResolvedValueOnce({
				workflow: { id: "wf_1", organizationId: "other-org" },
			} as never);
			await expect(g.fn(ctx, `${g.name}_1`)).rejects.toMatchObject({ code: g.notFound });
		});

		it(`throws VERSION_NOT_DRAFT when the ${g.name}'s version is published`, async () => {
			vi.mocked(g.getter).mockResolvedValueOnce(withVersion("published") as never);
			vi.mocked(getVersionWithWorkflow).mockResolvedValueOnce({
				workflow: { id: "wf_1", organizationId: "org-1" },
			} as never);
			await expect(g.fn(ctx, `${g.name}_1`)).rejects.toMatchObject({ code: "VERSION_NOT_DRAFT" });
		});

		it(`returns the ${g.name} + version + workflow on the happy path`, async () => {
			vi.mocked(g.getter).mockResolvedValueOnce(withVersion("draft") as never);
			vi.mocked(getVersionWithWorkflow).mockResolvedValueOnce({
				workflow: { id: "wf_1", organizationId: "org-1" },
			} as never);
			const res = await g.fn(ctx, `${g.name}_1`);
			expect(res).toMatchObject({ [g.payloadKey]: entity, version: { id: "v1", status: "draft" }, workflow: { id: "wf_1" } });
		});
	});
}
