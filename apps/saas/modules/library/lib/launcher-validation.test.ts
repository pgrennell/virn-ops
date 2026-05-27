// launcher-validation.test.ts
//
// Pure-fn tests for the Launcher's client-side required-field check (integrity #2
// convenience layer). The server is the source of truth for refusal; this just
// avoids the obvious empty-submit roundtrip.

import { describe, expect, it } from "vitest";

import { findMissingRequiredKickoffFields, type KickoffFieldDescriptor } from "./launcher-validation";

const F = (
	key: string,
	overrides?: Partial<KickoffFieldDescriptor>,
): KickoffFieldDescriptor => ({
	key,
	label: key,
	isRequired: true,
	...overrides,
});

describe("findMissingRequiredKickoffFields", () => {
	it("returns empty when all required fields have values", () => {
		const fields = [F("customer_name"), F("reference_number")];
		const values = { customer_name: "Acme", reference_number: "REF-1" };
		expect(findMissingRequiredKickoffFields(fields, values)).toEqual([]);
	});

	it("returns missing required keys when values are absent (key not present)", () => {
		const fields = [F("customer_name"), F("reference_number")];
		const values = { customer_name: "Acme" };
		expect(findMissingRequiredKickoffFields(fields, values)).toEqual([
			"reference_number",
		]);
	});

	it("treats empty string as missing (required-field semantics match server)", () => {
		const fields = [F("customer_name")];
		const values = { customer_name: "" };
		expect(findMissingRequiredKickoffFields(fields, values)).toEqual([
			"customer_name",
		]);
	});

	it("treats whitespace-only string as missing", () => {
		const fields = [F("customer_name")];
		const values = { customer_name: "   " };
		expect(findMissingRequiredKickoffFields(fields, values)).toEqual([
			"customer_name",
		]);
	});

	it("treats null and undefined as missing", () => {
		const fields = [F("a"), F("b")];
		const values = { a: null, b: undefined };
		expect(findMissingRequiredKickoffFields(fields, values)).toEqual(["a", "b"]);
	});

	it("treats empty array as missing (multiselect with nothing picked)", () => {
		const fields = [F("systems")];
		const values = { systems: [] };
		expect(findMissingRequiredKickoffFields(fields, values)).toEqual(["systems"]);
	});

	it("non-empty array passes (multiselect with at least one selection)", () => {
		const fields = [F("systems")];
		const values = { systems: ["Email"] };
		expect(findMissingRequiredKickoffFields(fields, values)).toEqual([]);
	});

	it("optional fields never block, even if missing", () => {
		const fields = [F("note", { isRequired: false })];
		expect(findMissingRequiredKickoffFields(fields, {})).toEqual([]);
		expect(findMissingRequiredKickoffFields(fields, { note: "" })).toEqual([]);
	});

	it("Map values work the same as Record values (component uses Map internally)", () => {
		const fields = [F("customer_name")];
		const valuesMap = new Map<string, unknown>([["customer_name", "Acme"]]);
		expect(findMissingRequiredKickoffFields(fields, valuesMap)).toEqual([]);
		const emptyMap = new Map<string, unknown>();
		expect(findMissingRequiredKickoffFields(fields, emptyMap)).toEqual([
			"customer_name",
		]);
	});

	it("preserves declaration order in the missing list", () => {
		const fields = [F("c"), F("a"), F("b")];
		expect(findMissingRequiredKickoffFields(fields, {})).toEqual(["c", "a", "b"]);
	});
});
