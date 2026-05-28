// guest.test.ts
//
// Pure-function tests for the D-037 returnUrl validator. The
// getRunForGuest integration (which composes this validator with the DB
// reads) is covered by the procedure-layer tests and the manual dev script.

import { describe, expect, it, vi } from "vitest";

// guest.ts transitively loads the @virn/database client, which throws on
// import when DATABASE_URL is unset. Stub the module so this pure-function
// test loads cleanly. The validator itself doesn't touch any of these.
vi.mock("@virn/database", () => ({
	getActiveReturnUrlAllowlistForOrg: vi.fn(),
	getGuestRunBundle: vi.fn(),
	touchParticipantTokenUsage: vi.fn(),
	verifyParticipantToken: vi.fn(),
	// `completeRunStep` / `setRunFieldValue` transitively imported by guest.ts.
	areAllRequiredRunStepsComplete: vi.fn(),
	enqueueCrossProductEventForRun: vi.fn(),
	findAgentParticipantForRun: vi.fn(),
	findIncompleteStopDependencies: vi.fn(),
	getFieldValuesForRun: vi.fn(),
	getRequiredFieldsForStep: vi.fn(),
	getRunStepWithRun: vi.fn(),
	markRunCompleted: vi.fn(),
	markRunStepCompleted: vi.fn(),
	writeAuditAndActivity: vi.fn(),
	withTransaction: vi.fn(),
	findDueRecomputeTargets: vi.fn(),
	getDateFieldValuesForStepInRun: vi.fn(),
	updateRunStepDueAt: vi.fn(),
	batchUpdateRunStepDueAt: vi.fn(),
	// launch-run.ts is also pulled in via the recompute helpers.
	getAgentForOrg: vi.fn(),
	getLatestPublishedWorkflowVersion: vi.fn(),
	getVendorContactForLaunch: vi.fn(),
	getVersionLaunchBundle: vi.fn(),
	getWorkflowBySlugForOrg: vi.fn(),
	getWorkflowForOrg: vi.fn(),
	getWorkflowVersionById: vi.fn(),
	insertRunSnapshot: vi.fn(),
	validateFieldValue: vi.fn(),
}));

import { validateGuestReturnUrl } from "./guest";

describe("validateGuestReturnUrl (D-037)", () => {
	const PM_PREFIXES = [
		"https://pm.example.com/",
		"https://staff.pm.example.com/portal/",
	];

	it("returns null when candidate is null / undefined / empty", () => {
		expect(validateGuestReturnUrl(null, PM_PREFIXES)).toBeNull();
		expect(validateGuestReturnUrl(undefined, PM_PREFIXES)).toBeNull();
		expect(validateGuestReturnUrl("", PM_PREFIXES)).toBeNull();
	});

	it("returns the candidate when it prefix-matches an allowlist entry", () => {
		expect(
			validateGuestReturnUrl(
				"https://pm.example.com/service-requests/sr_42",
				PM_PREFIXES,
			),
		).toBe("https://pm.example.com/service-requests/sr_42");
	});

	it("returns null when the candidate's host matches but the path doesn't fall under any prefix", () => {
		// Allowlist requires the /portal/ path; bare host is not enough.
		expect(
			validateGuestReturnUrl(
				"https://staff.pm.example.com/admin/foo",
				PM_PREFIXES,
			),
		).toBeNull();
	});

	it("returns null when the candidate is on a sibling host the allowlist doesn't cover", () => {
		expect(
			validateGuestReturnUrl("https://attacker.example.com/", PM_PREFIXES),
		).toBeNull();
	});

	it("returns null for non-http(s) schemes (defense vs. javascript:, data:, file:)", () => {
		expect(
			validateGuestReturnUrl("javascript:alert(1)", PM_PREFIXES),
		).toBeNull();
		expect(
			validateGuestReturnUrl("data:text/html,foo", PM_PREFIXES),
		).toBeNull();
		expect(
			validateGuestReturnUrl("file:///etc/passwd", PM_PREFIXES),
		).toBeNull();
	});

	it("returns null for malformed URLs", () => {
		expect(validateGuestReturnUrl("not a url", PM_PREFIXES)).toBeNull();
		expect(validateGuestReturnUrl("://broken", PM_PREFIXES)).toBeNull();
	});

	it("empty allowlist rejects every candidate (no-consumer-registered case)", () => {
		expect(
			validateGuestReturnUrl("https://pm.example.com/anything", []),
		).toBeNull();
	});

	it("permits http:// when the allowlist explicitly includes an http:// prefix (local dev)", () => {
		expect(
			validateGuestReturnUrl("http://localhost:3001/return", [
				"http://localhost:3001/",
			]),
		).toBe("http://localhost:3001/return");
	});

	it("treats prefix matching as exact-string startsWith (no normalization, no trailing-slash leniency)", () => {
		// Allowlist entry has a trailing slash; a candidate without one against
		// the same path fails (intentional -- prevents prefix-of-prefix tricks).
		expect(
			validateGuestReturnUrl("https://pm.example.com", PM_PREFIXES),
		).toBeNull();
		// Allowlist without a trailing slash would match -- but the create
		// procedure today doesn't enforce trailing slashes either way.
		expect(
			validateGuestReturnUrl("https://pm.example.com/x", [
				"https://pm.example.com",
			]),
		).toBe("https://pm.example.com/x");
	});
});
