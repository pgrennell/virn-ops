// Workflows procedure hardening (W1b) -- auth gate on the Builder structure CRUD
// surface. All nine section/step/field mutations are adminOrgProcedure: a plain
// member is FORBIDDEN, an unauthenticated caller UNAUTHORIZED. Plus two
// representative checks that a procedure surfaces a thrown WorkflowEngineError via
// workflowEngineCall with the mapped HTTP code (the full CODE_MAP is covered in
// _utils.test.ts). The lib (../lib/structure) is mocked so module-load succeeds and
// the gate-fail paths never touch real logic.

import { call } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@virn/auth", () => ({ auth: { api: { getSession: vi.fn() } } }));

vi.mock("@virn/database", () => ({ getOrganizationMembership: vi.fn() }));

vi.mock("../lib/structure", () => ({
	createSection: vi.fn(),
	updateSectionOp: vi.fn(),
	deleteSectionOp: vi.fn(),
	createStep: vi.fn(),
	updateStepOp: vi.fn(),
	deleteStepOp: vi.fn(),
	createField: vi.fn(),
	updateFieldOp: vi.fn(),
	deleteFieldOp: vi.fn(),
}));

import { auth } from "@virn/auth";
import { getOrganizationMembership } from "@virn/database";

import { WorkflowEngineError } from "../lib/errors";
import { createField, createStep, deleteFieldOp } from "../lib/structure";
import { createFieldProc } from "./create-field";
import { createSectionProc } from "./create-section";
import { createStepProc } from "./create-step";
import { deleteFieldProc } from "./delete-field";
import { deleteSectionProc } from "./delete-section";
import { deleteStepProc } from "./delete-step";
import { updateFieldProc } from "./update-field";
import { updateSectionProc } from "./update-section";
import { updateStepProc } from "./update-step";

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

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(auth.api.getSession).mockResolvedValue(makeSession() as never);
	vi.mocked(getOrganizationMembership).mockResolvedValue(makeMembership() as never);
});

const adminProcs = [
	{ name: "createSection", run: () => call(createSectionProc, { workflowVersionId: "ver_1", title: "Sec" }, ctx) },
	{ name: "updateSection", run: () => call(updateSectionProc, { sectionId: "sec_1" }, ctx) },
	{ name: "deleteSection", run: () => call(deleteSectionProc, { sectionId: "sec_1" }, ctx) },
	{ name: "createStep", run: () => call(createStepProc, { workflowVersionId: "ver_1", title: "Step" }, ctx) },
	{ name: "updateStep", run: () => call(updateStepProc, { stepId: "step_1" }, ctx) },
	{ name: "deleteStep", run: () => call(deleteStepProc, { stepId: "step_1" }, ctx) },
	{ name: "createField", run: () => call(createFieldProc, { workflowVersionId: "ver_1", stepId: "step_1", label: "Field", fieldType: "text" }, ctx) },
	{ name: "updateField", run: () => call(updateFieldProc, { fieldId: "f_1" }, ctx) },
	{ name: "deleteField", run: () => call(deleteFieldProc, { fieldId: "f_1" }, ctx) },
];

describe("workflows structure CRUD -- admin-only mutations", () => {
	for (const p of adminProcs) {
		it(`${p.name} throws FORBIDDEN for a plain member`, async () => {
			vi.mocked(getOrganizationMembership).mockResolvedValueOnce(makeMembership("member") as never);
			await expect(p.run()).rejects.toMatchObject({ code: "FORBIDDEN" });
		});

		it(`${p.name} throws UNAUTHORIZED with no session`, async () => {
			vi.mocked(auth.api.getSession).mockResolvedValueOnce(null);
			await expect(p.run()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
		});
	}
});

describe("workflows structure CRUD -- WorkflowEngineError surfaces via workflowEngineCall", () => {
	it("createStep maps VERSION_NOT_DRAFT -> BAD_REQUEST", async () => {
		vi.mocked(createStep).mockRejectedValueOnce(
			new WorkflowEngineError("VERSION_NOT_DRAFT", "not a draft", { versionId: "ver_1" }),
		);
		await expect(
			call(createStepProc, { workflowVersionId: "ver_1", title: "Step" }, ctx),
		).rejects.toMatchObject({ code: "BAD_REQUEST", data: { code: "VERSION_NOT_DRAFT" } });
	});

	it("deleteField maps FIELD_NOT_FOUND -> NOT_FOUND", async () => {
		vi.mocked(deleteFieldOp).mockRejectedValueOnce(
			new WorkflowEngineError("FIELD_NOT_FOUND", "gone"),
		);
		await expect(
			call(deleteFieldProc, { fieldId: "missing" }, ctx),
		).rejects.toMatchObject({ code: "NOT_FOUND", data: { code: "FIELD_NOT_FOUND" } });
	});

	it("createField returns the lib result on the happy path (admin)", async () => {
		vi.mocked(createField).mockResolvedValueOnce({ id: "f_new" } as never);
		await expect(
			call(createFieldProc, { workflowVersionId: "ver_1", stepId: "step_1", label: "Field", fieldType: "text" }, ctx),
		).resolves.toMatchObject({ id: "f_new" });
	});
});
