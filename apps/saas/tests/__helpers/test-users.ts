// Test user / org helpers — generate unique identifiers per test and provide
// best-effort cleanup. These tests run against a real database (the same one
// the dev server uses unless DATABASE_URL is overridden in CI), so unique
// emails per test are essential to avoid collisions.

import { randomBytes } from "node:crypto";

const TEST_PREFIX = "e2e-";

/**
 * Produce a unique test email for this test. Format:
 * `e2e-<timestamp>-<random>@virn.test`. The `.test` TLD is reserved by the
 * IETF (RFC 6761) and will never be a real address.
 */
export function makeTestEmail(label = "user"): string {
	const ts = Date.now().toString(36);
	const rand = randomBytes(3).toString("hex");
	return `${TEST_PREFIX}${label}-${ts}-${rand}@virn.test`;
}

/**
 * Strong password that satisfies Better Auth's minPasswordLength of 8 plus
 * Virn's passwordSchema (mixed case + number).
 */
export function makeTestPassword(): string {
	return `E2E-${randomBytes(4).toString("hex")}-Test1!`;
}

/**
 * Default human-readable name for a generated test user.
 */
export function makeTestName(label = "User"): string {
	return `E2E ${label} ${randomBytes(2).toString("hex")}`;
}

/**
 * Generate a slug-safe identifier for a test organization.
 */
export function makeTestOrgSlug(label = "org"): string {
	const ts = Date.now().toString(36);
	const rand = randomBytes(2).toString("hex");
	return `${TEST_PREFIX}${label}-${ts}-${rand}`;
}

export function makeTestOrgName(label = "Org"): string {
	return `E2E ${label} ${randomBytes(2).toString("hex")}`;
}

export const TEST_EMAIL_PREFIX = TEST_PREFIX;
