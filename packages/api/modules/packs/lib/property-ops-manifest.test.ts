// Invariant tests for the property-ops pack manifest (Phase 17). The manifest is pure
// declarative data, but installPropertyOpsPack trusts it: a duplicate field key, a dangling
// roleManifestKey, or a dependsOn pointing at a non-existent step would break the install
// (or silently mis-wire it). These tests pin the structural invariants the installer relies on.

import { describe, expect, it } from "vitest";

import {
	type FieldSeed,
	PROPERTY_OPS_ROLES,
	PROPERTY_OPS_VENDOR_CATEGORIES,
	PROPERTY_OPS_WORKFLOWS,
	type StepSeed,
	type WorkflowSeed,
} from "./property-ops-manifest";

const KEY_RE = /^[a-z][a-z0-9_]*$/;
const FIELD_TYPES = new Set([
	"text",
	"textarea",
	"number",
	"date",
	"select",
	"multiselect",
	"file",
	"image",
	"signature",
	"member",
	"lookup",
]);

function duplicates(values: readonly string[]): string[] {
	const seen = new Set<string>();
	const dup: string[] = [];
	for (const v of values) {
		if (seen.has(v)) dup.push(v);
		seen.add(v);
	}
	return dup;
}

function allSteps(wf: WorkflowSeed): StepSeed[] {
	return wf.sections.flatMap((s) => s.steps);
}

function allFields(wf: WorkflowSeed): FieldSeed[] {
	return [...wf.kickoffFields, ...allSteps(wf).flatMap((s) => s.fields ?? [])];
}

describe("property-ops vendor categories", () => {
	it("has at least the 10 v1 categories with unique slugs + non-empty copy", () => {
		expect(PROPERTY_OPS_VENDOR_CATEGORIES.length).toBeGreaterThanOrEqual(10);
		expect(duplicates(PROPERTY_OPS_VENDOR_CATEGORIES.map((c) => c.slug))).toEqual([]);
		for (const c of PROPERTY_OPS_VENDOR_CATEGORIES) {
			expect(c.slug).toMatch(/^[a-z][a-z0-9-]*$/);
			expect(c.name.length).toBeGreaterThan(0);
			expect(c.description.length).toBeGreaterThan(0);
		}
	});
});

describe("property-ops roles", () => {
	it("has unique manifest keys + names and exactly one initiator", () => {
		expect(duplicates(PROPERTY_OPS_ROLES.map((r) => r.manifestKey))).toEqual([]);
		expect(duplicates(PROPERTY_OPS_ROLES.map((r) => r.name))).toEqual([]);
		expect(PROPERTY_OPS_ROLES.filter((r) => r.isInitiator)).toHaveLength(1);
	});
});

describe("property-ops workflows", () => {
	it("exposes a non-empty set with unique workflow slugs", () => {
		expect(PROPERTY_OPS_WORKFLOWS.length).toBeGreaterThan(0);
		expect(duplicates(PROPERTY_OPS_WORKFLOWS.map((w) => w.slug))).toEqual([]);
	});

	const roleKeys = new Set(PROPERTY_OPS_ROLES.map((r) => r.manifestKey));

	describe.each(PROPERTY_OPS_WORKFLOWS.map((w) => [w.slug, w] as const))(
		"workflow %s",
		(_slug, wf) => {
			it("has unique section + step manifest keys", () => {
				expect(duplicates(wf.sections.map((s) => s.manifestKey))).toEqual([]);
				expect(duplicates(allSteps(wf).map((s) => s.manifestKey))).toEqual([]);
			});

			it("has unique, well-formed field keys across kickoff + steps", () => {
				const keys = allFields(wf).map((f) => f.key);
				expect(duplicates(keys)).toEqual([]);
				for (const f of allFields(wf)) {
					expect(f.key).toMatch(KEY_RE);
					expect(FIELD_TYPES.has(f.fieldType)).toBe(true);
				}
			});

			it("references only roles that exist in the manifest", () => {
				for (const step of allSteps(wf)) {
					if (step.roleManifestKey) {
						expect(roleKeys.has(step.roleManifestKey)).toBe(true);
					}
				}
			});

			it("has dependsOn edges that resolve to steps in the same workflow", () => {
				const stepKeys = new Set(allSteps(wf).map((s) => s.manifestKey));
				for (const step of allSteps(wf)) {
					for (const dep of step.dependsOn ?? []) {
						expect(stepKeys.has(dep)).toBe(true);
						expect(dep).not.toBe(step.manifestKey); // no self-dependency
					}
				}
			});
		},
	);
});
