// Field-key lifecycle tests (D-017).
//
// Coverage:
//   - validateKeyShape: rejects bad shapes; accepts good ones.
//   - autoSlugFromLabel: produces a valid candidate that satisfies validateKeyShape.
//   - resolveUniqueKey: returns candidate when free; appends _2/_3 on collision; honors
//     excludeFieldId for rename-to-same.
//   - assertKeyRenameAllowed: passes when no referencers; refuses with FIELD_KEY_LOCKED
//     when conditions reference; same for due-source references.
//   - assertFieldDeleteAllowed: same refusal semantics as rename (the only thing today
//     that can change between rename + delete is what the UI calls each refusal flow).

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@virn/database", () => ({
	findFieldByKey: vi.fn(),
	findFieldReferencers: vi.fn(),
}));

import { findFieldByKey, findFieldReferencers } from "@virn/database";

import {
	assertFieldDeleteAllowed,
	assertKeyRenameAllowed,
	autoSlugFromLabel,
	resolveUniqueKey,
	validateKeyShape,
} from "./field-key";
import { WorkflowEngineError } from "./errors";

beforeEach(() => {
	vi.resetAllMocks();
});

describe("validateKeyShape", () => {
	it("accepts lowercase-leading identifier with letters / digits / underscores", () => {
		expect(() => validateKeyShape("customer_name")).not.toThrow();
		expect(() => validateKeyShape("a")).not.toThrow();
		expect(() => validateKeyShape("step_1_field_2")).not.toThrow();
	});

	it("rejects empty / oversized", () => {
		expect(() => validateKeyShape("")).toThrow(WorkflowEngineError);
		expect(() => validateKeyShape("a".repeat(65))).toThrow(WorkflowEngineError);
	});

	it("rejects digit-leading, uppercase, kebab-case, spaces", () => {
		expect(() => validateKeyShape("1field")).toThrow(WorkflowEngineError);
		expect(() => validateKeyShape("Field")).toThrow(WorkflowEngineError);
		expect(() => validateKeyShape("field-name")).toThrow(WorkflowEngineError);
		expect(() => validateKeyShape("field name")).toThrow(WorkflowEngineError);
	});
});

describe("autoSlugFromLabel", () => {
	it("slugifies a friendly label into a valid key", () => {
		const k = autoSlugFromLabel("Customer Name");
		expect(k).toBe("customer_name");
		expect(() => validateKeyShape(k)).not.toThrow();
	});

	it("prefixes f_ when slug starts with a digit", () => {
		const k = autoSlugFromLabel("3D model URL");
		expect(k.startsWith("f_")).toBe(true);
		expect(() => validateKeyShape(k)).not.toThrow();
	});

	it("falls back to 'field' on empty / unicode-only input", () => {
		expect(autoSlugFromLabel("")).toBe("field");
	});
});

describe("resolveUniqueKey", () => {
	it("returns the candidate when no collision", async () => {
		(findFieldByKey as ReturnType<typeof vi.fn>).mockResolvedValue(null);
		const k = await resolveUniqueKey({ workflowVersionId: "ver_1", candidate: "name" });
		expect(k).toBe("name");
	});

	it("suffixes _2 on first collision, _3 on next, ...", async () => {
		const mock = findFieldByKey as ReturnType<typeof vi.fn>;
		mock.mockImplementation(async (_v: unknown, key: string) => {
			if (key === "name" || key === "name_2") return { id: "other" };
			return null;
		});
		const k = await resolveUniqueKey({ workflowVersionId: "ver_1", candidate: "name" });
		expect(k).toBe("name_3");
	});

	it("honors excludeFieldId so rename-to-same is a no-op", async () => {
		const mock = findFieldByKey as ReturnType<typeof vi.fn>;
		// Pretend the only field with key=`name` is the one being renamed.
		mock.mockImplementation(async (_v: unknown, _key: string, excludeFieldId?: string) => {
			if (excludeFieldId === "self") return null;
			return { id: "self" };
		});
		const k = await resolveUniqueKey({
			workflowVersionId: "ver_1",
			candidate: "name",
			excludeFieldId: "self",
		});
		expect(k).toBe("name");
	});
});

describe("assertKeyRenameAllowed / assertFieldDeleteAllowed (lock-on-reference)", () => {
	it("passes when no references exist", async () => {
		(findFieldReferencers as ReturnType<typeof vi.fn>).mockResolvedValue([]);
		await expect(assertKeyRenameAllowed("field_1")).resolves.toBeUndefined();
		await expect(assertFieldDeleteAllowed("field_1")).resolves.toBeUndefined();
	});

	it("refuses rename with FIELD_KEY_LOCKED when a condition references the field", async () => {
		(findFieldReferencers as ReturnType<typeof vi.fn>).mockResolvedValue([
			{ type: "condition", stepId: null },
		]);
		await expect(assertKeyRenameAllowed("field_1")).rejects.toMatchObject({
			code: "FIELD_KEY_LOCKED",
		});
	});

	it("refuses rename when a due-rule sources from the field", async () => {
		(findFieldReferencers as ReturnType<typeof vi.fn>).mockResolvedValue([
			{ type: "due_source", stepId: "step_5" },
		]);
		const err = await assertKeyRenameAllowed("field_1").catch((e) => e);
		expect(err).toBeInstanceOf(WorkflowEngineError);
		expect(err.code).toBe("FIELD_KEY_LOCKED");
		expect(err.details).toMatchObject({
			fieldId: "field_1",
			referencers: [{ type: "due_source", stepId: "step_5" }],
		});
	});

	it("refuses delete with FIELD_HAS_REFERENCERS using the same probe", async () => {
		(findFieldReferencers as ReturnType<typeof vi.fn>).mockResolvedValue([
			{ type: "condition", stepId: null },
		]);
		await expect(assertFieldDeleteAllowed("field_1")).rejects.toMatchObject({
			code: "FIELD_HAS_REFERENCERS",
		});
	});
});
