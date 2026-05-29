// import-from-markdown.test.ts
//
// Procedure-level tests for workflows.importFromMarkdown (Phase 13 slice B).
// Pins:
//   - adminOrgProcedure stack refuses non-admin / no-session
//   - Input validation (source min/max, titleOverride max)
//   - Parse-refusal maps to BAD_REQUEST with IMPORT_NO_RECOGNIZABLE_STRUCTURE

import { call } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@virn/auth", () => ({
	auth: { api: { getSession: vi.fn() } },
}));

vi.mock("@virn/database", () => ({
	getOrganizationMembership: vi.fn(),
}));

// Stub the lib so the test doesn't need a real DB. Default returns success;
// individual tests override for refusal coverage.
vi.mock("../lib/import/markdown-import-builder", () => ({
	importWorkflowFromMarkdown: vi.fn(async () => ({
		workflowId: "wf_imp_1",
		draftVersionId: "ver_imp_1",
		title: "Imported workflow",
		stepCount: 3,
		detectedFormat: "tango-style",
	})),
}));

import { auth } from "@virn/auth";
import { getOrganizationMembership } from "@virn/database";

import { WorkflowEngineError } from "../lib/errors";
import { importWorkflowFromMarkdown } from "../lib/import/markdown-import-builder";
import { importFromMarkdownProc } from "./import-from-markdown";

const ctx = { context: { headers: new Headers() } };

function makeSession(opts: { activeOrganizationId?: string | null } = {}) {
	const activeOrganizationId =
		"activeOrganizationId" in opts ? opts.activeOrganizationId : "org-1";
	return {
		session: {
			id: "session-1",
			userId: "user-1",
			token: "tok",
			expiresAt: new Date(),
			activeOrganizationId,
		},
		user: { id: "user-1", email: "u@example.com", name: "U", emailVerified: true },
	};
}

function makeMembership(role: "owner" | "admin" | "member" = "admin") {
	return {
		organization: { id: "org-1", name: "Org", slug: "org" },
		role,
	};
}

const TANGO_SOURCE = `# Test workflow

## Step 1: First thing

Body one.

## Step 2: Second thing

Body two.
`;

beforeEach(() => {
	vi.clearAllMocks();
});

describe("workflows.importFromMarkdown -- auth gate", () => {
	it("refuses unauthenticated calls with UNAUTHORIZED", async () => {
		vi.mocked(auth.api.getSession).mockResolvedValue(null);
		await expect(
			call(importFromMarkdownProc, { source: TANGO_SOURCE }, ctx),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });
		expect(importWorkflowFromMarkdown).not.toHaveBeenCalled();
	});

	it("refuses non-admin members with FORBIDDEN", async () => {
		vi.mocked(auth.api.getSession).mockResolvedValue(makeSession() as never);
		vi.mocked(getOrganizationMembership).mockResolvedValue(
			makeMembership("member") as never,
		);
		await expect(
			call(importFromMarkdownProc, { source: TANGO_SOURCE }, ctx),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		expect(importWorkflowFromMarkdown).not.toHaveBeenCalled();
	});

	it("allows admin/owner -- forwards to the lib", async () => {
		vi.mocked(auth.api.getSession).mockResolvedValue(makeSession() as never);
		vi.mocked(getOrganizationMembership).mockResolvedValue(makeMembership() as never);

		const result = await call(
			importFromMarkdownProc,
			{ source: TANGO_SOURCE, titleOverride: "Overridden" },
			ctx,
		);
		expect(importWorkflowFromMarkdown).toHaveBeenCalledTimes(1);
		expect(result).toEqual({
			workflowId: "wf_imp_1",
			draftVersionId: "ver_imp_1",
			title: "Imported workflow",
			stepCount: 3,
			detectedFormat: "tango-style",
		});

		const libArgs = vi.mocked(importWorkflowFromMarkdown).mock.calls[0];
		expect(libArgs[0]).toEqual({ organizationId: "org-1", userId: "user-1" });
		expect(libArgs[1]).toEqual({
			source: TANGO_SOURCE,
			titleOverride: "Overridden",
		});
	});
});

describe("workflows.importFromMarkdown -- input validation", () => {
	beforeEach(() => {
		vi.mocked(auth.api.getSession).mockResolvedValue(makeSession() as never);
		vi.mocked(getOrganizationMembership).mockResolvedValue(makeMembership() as never);
	});

	it("rejects empty source", async () => {
		await expect(
			call(importFromMarkdownProc, { source: "" }, ctx),
		).rejects.toThrow();
		expect(importWorkflowFromMarkdown).not.toHaveBeenCalled();
	});

	it("rejects source above 200k chars", async () => {
		const huge = "a".repeat(200_001);
		await expect(
			call(importFromMarkdownProc, { source: huge }, ctx),
		).rejects.toThrow();
		expect(importWorkflowFromMarkdown).not.toHaveBeenCalled();
	});
});

describe("workflows.importFromMarkdown -- parse refusal mapping", () => {
	beforeEach(() => {
		vi.mocked(auth.api.getSession).mockResolvedValue(makeSession() as never);
		vi.mocked(getOrganizationMembership).mockResolvedValue(makeMembership() as never);
	});

	it("surfaces IMPORT_NO_RECOGNIZABLE_STRUCTURE as a structured BAD_REQUEST", async () => {
		vi.mocked(importWorkflowFromMarkdown).mockRejectedValueOnce(
			new WorkflowEngineError(
				"IMPORT_NO_RECOGNIZABLE_STRUCTURE",
				"No structure",
				{ sourceLength: 12 },
			),
		);

		await expect(
			call(importFromMarkdownProc, { source: "just some prose" }, ctx),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
			data: { code: "IMPORT_NO_RECOGNIZABLE_STRUCTURE" },
		});
	});
});
