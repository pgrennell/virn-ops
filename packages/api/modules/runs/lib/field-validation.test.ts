// D-046 payoff -- validateFieldValue was trapped in queries/runs.ts (which imports the
// drizzle client) and could not be unit-tested. It now lives in the client-free
// queries/_pure/field-validation.ts and is imported here via that DEEP path -- so this
// test runs with NO DATABASE_URL: the import itself proves the decoupling (a leaked
// client would throw on load). First real coverage of the per-field-type zod builder.

import { describe, expect, it } from "vitest";

// Deep, client-free import -- NOT the @virn/database barrel (which would load the client).
import { validateFieldValue } from "@virn/database/drizzle/queries/_pure/field-validation";

function field(fieldType: string, config: Record<string, unknown> | null = null) {
	return { fieldType: fieldType as never, config, isRequired: false };
}

describe("validateFieldValue -- unset passthrough", () => {
	it("returns null/undefined unchanged (the caller enforces isRequired separately)", () => {
		expect(validateFieldValue(field("text"), null)).toBeNull();
		expect(validateFieldValue(field("text"), undefined)).toBeUndefined();
	});
});

describe("validateFieldValue -- text", () => {
	it("accepts a plain string", () => {
		expect(validateFieldValue(field("text"), "hi")).toBe("hi");
	});
	it("enforces minLength / maxLength / pattern", () => {
		expect(() => validateFieldValue(field("text", { minLength: 3 }), "ab")).toThrow();
		expect(() => validateFieldValue(field("text", { maxLength: 2 }), "abc")).toThrow();
		expect(validateFieldValue(field("text", { pattern: "^[a-z]+$" }), "abc")).toBe("abc");
		expect(() => validateFieldValue(field("text", { pattern: "^[a-z]+$" }), "AB1")).toThrow();
	});
});

describe("validateFieldValue -- number", () => {
	it("enforces min / max / int", () => {
		expect(validateFieldValue(field("number"), 5)).toBe(5);
		expect(() => validateFieldValue(field("number", { min: 10 }), 5)).toThrow();
		expect(() => validateFieldValue(field("number", { max: 3 }), 5)).toThrow();
		expect(() => validateFieldValue(field("number", { int: true }), 1.5)).toThrow();
		expect(() => validateFieldValue(field("number"), "5")).toThrow();
	});
});

describe("validateFieldValue -- date", () => {
	it("accepts a valid ISO date string, rejects garbage", () => {
		expect(validateFieldValue(field("date"), "2026-06-01T10:00:00Z")).toBe("2026-06-01T10:00:00Z");
		expect(() => validateFieldValue(field("date"), "not-a-date")).toThrow();
	});
});

describe("validateFieldValue -- select / multiselect", () => {
	it("select: restricts to the configured options", () => {
		expect(validateFieldValue(field("select", { options: ["a", "b"] }), "a")).toBe("a");
		expect(() => validateFieldValue(field("select", { options: ["a", "b"] }), "c")).toThrow();
	});
	it("select: accepts any string when no options are configured", () => {
		expect(validateFieldValue(field("select"), "anything")).toBe("anything");
	});
	it("multiselect: array of the configured options; rejects an unknown member", () => {
		expect(validateFieldValue(field("multiselect", { options: ["a", "b"] }), ["a", "b"])).toEqual(["a", "b"]);
		expect(() => validateFieldValue(field("multiselect", { options: ["a"] }), ["a", "x"])).toThrow();
	});
});

describe("validateFieldValue -- file/image/signature (storage refs)", () => {
	it.each(["file", "image", "signature"])("%s requires a non-empty key; size/contentType optional", (t) => {
		expect(validateFieldValue(field(t), { key: "obj/123" })).toEqual({ key: "obj/123" });
		expect(
			validateFieldValue(field(t), { key: "obj/123", size: 10, contentType: "image/png" }),
		).toMatchObject({ key: "obj/123", size: 10 });
		expect(() => validateFieldValue(field(t), { key: "" })).toThrow();
		expect(() => validateFieldValue(field(t), {})).toThrow();
	});
});

describe("validateFieldValue -- member / lookup", () => {
	it("member requires a non-empty string id", () => {
		expect(validateFieldValue(field("member"), "user-1")).toBe("user-1");
		expect(() => validateFieldValue(field("member"), "")).toThrow();
	});
	it("lookup accepts anything (reserved -- data-set integration deferred)", () => {
		expect(validateFieldValue(field("lookup"), { anything: true })).toEqual({ anything: true });
		expect(validateFieldValue(field("lookup"), "x")).toBe("x");
	});
});

describe("validateFieldValue -- unknown type", () => {
	it("throws on an unrecognised field type", () => {
		expect(() => validateFieldValue(field("frobnicate"), "x")).toThrow(/Unknown field type/);
	});
});
