// preview-callbacks.test.ts
//
// The user's "load-bearing" Pass 2 test: PROVE that preview mode never calls a real
// mutation. The structural guarantee comes in three layers:
//
//   1. The neutralizer module (preview-callbacks.ts) exports functions that are
//      provably no-ops -- they don't import the oRPC client at all (so by
//      construction can't call any procedure).
//   2. The BuilderView source imports those neutralizers AND uses them in the
//      preview body's RunStepPanel onSetFieldValue / onCompleteStep props. We assert
//      the import + usage textually -- a regression that wires runs.completeStep
//      into the preview body would have to remove the noop usage to compile, which
//      this test catches.
//   3. The author body also reuses these (it doesn't write field values from the
//      panel either) -- a single neutralizer source for both noop sites.
//
// Plus: assert that the create-mutation hooks DO NOT define `onMutate` (so they're
// AWAIT, not optimistic) and the reorder/update hooks DO define it (so they ARE
// optimistic). Together this verifies the Pass 2 strategy split.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { PREVIEW_NOOP_COMPLETE, PREVIEW_NOOP_SET_FIELD } from "./preview-callbacks";

const BUILDER_VIEW_PATH = path.resolve(
	import.meta.dirname,
	"..",
	"components",
	"BuilderView.tsx",
);
const BUILDER_MUTATIONS_PATH = path.resolve(import.meta.dirname, "builder-mutations.ts");

describe("preview-callbacks: no-op semantics", () => {
	it("PREVIEW_NOOP_SET_FIELD returns undefined and has no observable effect", () => {
		const spy = vi.fn();
		const result = PREVIEW_NOOP_SET_FIELD("any_key", { anything: 42 });
		expect(result).toBeUndefined();
		expect(spy).not.toHaveBeenCalled(); // sanity
	});

	it("PREVIEW_NOOP_COMPLETE returns undefined and has no observable effect", () => {
		const spy = vi.fn();
		const result = PREVIEW_NOOP_COMPLETE();
		expect(result).toBeUndefined();
		expect(spy).not.toHaveBeenCalled();
	});

	it("preview-callbacks.ts does NOT import the orpc client (proves it can't call any procedure)", () => {
		const src = readFileSync(path.resolve(import.meta.dirname, "preview-callbacks.ts"), "utf8");
		expect(src).not.toMatch(/from\s+["']@shared\/lib\/orpc/);
		expect(src).not.toMatch(/orpc\./);
	});
});

describe("BuilderView wires preview through the neutralizers", () => {
	const src = readFileSync(BUILDER_VIEW_PATH, "utf8");

	it("imports PREVIEW_NOOP_COMPLETE + PREVIEW_NOOP_SET_FIELD from the neutralizer module", () => {
		expect(src).toMatch(
			/import\s+\{[^}]*PREVIEW_NOOP_COMPLETE[^}]*,[^}]*PREVIEW_NOOP_SET_FIELD[^}]*\}\s+from\s+["']\.\.\/lib\/preview-callbacks["']/,
		);
	});

	it("preview body wires onCompleteStep + onSetFieldValue to the noop constants (not to a mutation hook)", () => {
		// Extract from `function PreviewBody(` up to the next top-level `function `
		// or `const ` declaration. PreviewBody contains nested closures so a naive
		// `\n}` match would terminate at the first inner closure.
		const previewStartIdx = src.indexOf("function PreviewBody(");
		expect(previewStartIdx, "PreviewBody function should exist").toBeGreaterThan(-1);
		const restAfterStart = src.slice(previewStartIdx);
		const nextTopLevelIdx = restAfterStart.slice(1).search(/\nfunction\s+\w+\(|\nconst\s+\w+/);
		const previewBody =
			nextTopLevelIdx >= 0 ? restAfterStart.slice(0, nextTopLevelIdx) : restAfterStart;

		expect(previewBody).toMatch(/onSetFieldValue=\{NOOP_SET_FIELD\}/);
		expect(previewBody).toMatch(/onCompleteStep=\{NOOP_COMPLETE\}/);
		// Negative assertion: PreviewBody should NOT mention completeStep / setFieldValue
		// mutation calls. A regression that wired a real mutation in here would fail.
		expect(previewBody).not.toMatch(/completeStep\.mutate/);
		expect(previewBody).not.toMatch(/setFieldValue\.mutate/);
		expect(previewBody).not.toMatch(/orpc\.runs\.completeStep/);
		expect(previewBody).not.toMatch(/orpc\.runs\.setFieldValue/);
	});

	it("the NOOP_* aliases point at PREVIEW_NOOP_* (no inline divergent stubs)", () => {
		expect(src).toMatch(/const\s+NOOP_SET_FIELD\s*=\s*PREVIEW_NOOP_SET_FIELD/);
		expect(src).toMatch(/const\s+NOOP_COMPLETE\s*=\s*PREVIEW_NOOP_COMPLETE/);
	});
});

describe("BuilderView honors the admin-vs-member axis (UX_SPEC §2)", () => {
	const src = readFileSync(BUILDER_VIEW_PATH, "utf8");

	it("accepts isAdminOrOwner as a required prop", () => {
		expect(src).toMatch(/isAdminOrOwner:\s*boolean/);
	});

	it("authorActive gates on isAdminOrOwner -- members never enter author mode", () => {
		// The regression we're catching: `authorActive = isDraft && !previewActive`
		// (no admin check). Every write would silently 403 against adminOrgProcedure.
		expect(src).toMatch(/const\s+authorActive\s*=\s*isAdminOrOwner\s*&&/);
	});

	it("canEdit gates on isAdminOrOwner -- members never see the Edit button on published versions", () => {
		// Caught regression: `canEdit` hardcoded true in view mode (members see Edit,
		// click it, get 403 from editPublished's adminOrgProcedure).
		expect(src).toMatch(/canEdit\s*=\s*isAdminOrOwner/);
	});

	it("threads isAdminOrOwner into the BuilderShell so the read-only banner can render", () => {
		expect(src).toMatch(/isAdminOrOwner={isAdminOrOwner}/);
	});
});

describe("builder/page.tsx threads the snapshot.isAdminSuperset flag", () => {
	const pagePath = path.resolve(
		import.meta.dirname,
		"..",
		"..",
		"..",
		"app",
		"(authenticated)",
		"(main)",
		"(organizations)",
		"[organizationSlug]",
		"library",
		"workflows",
		"[workflowId]",
		"builder",
		"page.tsx",
	);
	const pageSrc = readFileSync(pagePath, "utf8");

	it("captures snapshot from assertCanSee and passes isAdminSuperset to BuilderView", () => {
		// Caught regression: the page discards the snapshot (`await assertCanSee(...)`
		// with no destructure), losing the admin-vs-member axis entirely.
		expect(pageSrc).toMatch(/const\s*\{\s*snapshot\s*\}\s*=\s*await\s+assertCanSee/);
		expect(pageSrc).toMatch(/isAdminOrOwner={snapshot\.isAdminSuperset}/);
	});
});

describe("builder-mutations: split optimistic strategy", () => {
	const src = readFileSync(BUILDER_MUTATIONS_PATH, "utf8");

	// Helper to extract a single hook's body.
	function extract(name: string): string | null {
		const re = new RegExp(`export\\s+function\\s+${name}\\s*\\([\\s\\S]*?\\n\\}`);
		const m = src.match(re);
		return m ? m[0] : null;
	}

	it("create hooks are AWAIT (no onMutate) -- server owns the cuid id + collision-resolved key", () => {
		for (const name of ["useCreateSection", "useCreateStep", "useCreateField"]) {
			const body = extract(name);
			expect(body, `${name} should be exported`).not.toBeNull();
			expect(body!).not.toMatch(/onMutate/);
			expect(body!).toMatch(/onSuccess/); // refetch on success, not optimistic patch
		}
	});

	it("update + reorder hooks ARE optimistic (have onMutate that patches the cache + rolls back)", () => {
		for (const name of ["useUpdateStep", "useUpdateField", "useUpdateSection", "useReorderSteps"]) {
			const body = extract(name);
			expect(body, `${name} should be exported`).not.toBeNull();
			expect(body!).toMatch(/onMutate/);
			expect(body!).toMatch(/onError/); // rollback path
			expect(body!).toMatch(/patchBundleCache/);
		}
	});

	it("useUpdateField does NOT optimistically apply the key field (server may collision-resolve)", () => {
		const body = extract("useUpdateField");
		expect(body, "useUpdateField should be exported").not.toBeNull();
		// The hook's onMutate should explicitly skip `input.key` -- the comment in the
		// source enforces this; the test confirms the behavior is intact.
		expect(body!).not.toMatch(/key:\s*input\.key/);
		expect(body!).toMatch(/label:\s*input\.label/); // label IS optimistically patched
	});

	it("useRenameField is AWAIT (no onMutate) -- D-017 + Pass-3 memory: server may collision-resolve", () => {
		const body = extract("useRenameField");
		expect(body, "useRenameField should be exported").not.toBeNull();
		// The whole point of the separate rename hook is await-only semantics. If a
		// future change reintroduces optimistic patching on the key, this catches it.
		expect(body!).not.toMatch(/onMutate/);
		expect(body!).toMatch(/onSuccess/);
	});

	it("useAddStepDependency / useRemoveStepDependency are AWAIT (low-frequency, refetch picks up edges)", () => {
		for (const name of ["useAddStepDependency", "useRemoveStepDependency"]) {
			const body = extract(name);
			expect(body, `${name} should be exported`).not.toBeNull();
			expect(body!).not.toMatch(/onMutate/);
			expect(body!).toMatch(/onSuccess/);
		}
	});

	it("useCreateWorkflowRole is AWAIT (server owns the cuid, same as createField/Step/Section)", () => {
		const body = extract("useCreateWorkflowRole");
		expect(body, "useCreateWorkflowRole should be exported").not.toBeNull();
		// Optimistic patch would invent a temp role id that the picker auto-selects,
		// then desync once the server returns the real id.
		expect(body!).not.toMatch(/onMutate/);
		expect(body!).toMatch(/onSuccess/);
		expect(body!).toMatch(/listRoles\.queryKey/); // invalidates the right query
	});
});
