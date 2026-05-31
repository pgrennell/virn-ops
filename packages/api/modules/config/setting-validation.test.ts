// D-046 payoff -- validateSettingValue was trapped in queries/config.ts (which imports
// the drizzle client). It now lives in the client-free queries/_pure/setting-validation.ts
// and is imported here via that DEEP path, so this test runs with NO DATABASE_URL: the
// import itself proves the decoupling. First real coverage of the per-dataType zod builder.

import { describe, expect, it } from "vitest";

// Deep, client-free import -- NOT the @virn/database barrel (which would load the client).
import { validateSettingValue } from "@virn/database/drizzle/queries/_pure/setting-validation";

function def(dataType: string, validationSchema: Record<string, unknown> | null = null) {
	return { dataType: dataType as never, validationSchema };
}

describe("validateSettingValue -- string", () => {
	it("accepts a string and enforces minLength/maxLength/pattern", () => {
		expect(validateSettingValue(def("string"), "hi")).toBe("hi");
		expect(() => validateSettingValue(def("string", { minLength: 3 }), "ab")).toThrow();
		expect(() => validateSettingValue(def("string", { maxLength: 2 }), "abc")).toThrow();
		expect(validateSettingValue(def("string", { pattern: "^[a-z]+$" }), "abc")).toBe("abc");
		expect(() => validateSettingValue(def("string", { pattern: "^[a-z]+$" }), "A1")).toThrow();
	});
});

describe("validateSettingValue -- number", () => {
	it("enforces min/max/int", () => {
		expect(validateSettingValue(def("number"), 5)).toBe(5);
		expect(() => validateSettingValue(def("number", { min: 10 }), 5)).toThrow();
		expect(() => validateSettingValue(def("number", { max: 3 }), 5)).toThrow();
		expect(() => validateSettingValue(def("number", { int: true }), 1.5)).toThrow();
		expect(() => validateSettingValue(def("number"), "5")).toThrow();
	});
});

describe("validateSettingValue -- boolean / json", () => {
	it("boolean accepts true/false, rejects non-booleans", () => {
		expect(validateSettingValue(def("boolean"), true)).toBe(true);
		expect(validateSettingValue(def("boolean"), false)).toBe(false);
		expect(() => validateSettingValue(def("boolean"), "true")).toThrow();
	});
	it("json accepts arbitrary values (z.unknown)", () => {
		expect(validateSettingValue(def("json"), { a: [1, 2] })).toEqual({ a: [1, 2] });
		expect(validateSettingValue(def("json"), 42)).toBe(42);
	});
});

describe("validateSettingValue -- select / multiselect", () => {
	it("select restricts to configured options; any string when none configured", () => {
		expect(validateSettingValue(def("select", { options: ["a", "b"] }), "a")).toBe("a");
		expect(() => validateSettingValue(def("select", { options: ["a", "b"] }), "c")).toThrow();
		expect(validateSettingValue(def("select"), "anything")).toBe("anything");
	});
	it("multiselect: array of the configured options; rejects an unknown member", () => {
		expect(validateSettingValue(def("multiselect", { options: ["a", "b"] }), ["a", "b"])).toEqual(["a", "b"]);
		expect(() => validateSettingValue(def("multiselect", { options: ["a"] }), ["a", "x"])).toThrow();
	});
});

describe("validateSettingValue -- unknown dataType", () => {
	it("throws on an unrecognised dataType", () => {
		expect(() => validateSettingValue(def("frobnicate"), "x")).toThrow(/Unknown setting dataType/);
	});
});
