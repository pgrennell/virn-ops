// Direct database helpers for E2E auth tests.
//
// Better Auth stores email-verification, magic-link, and password-reset tokens
// in the `verification` table. Production flows deliver them as URLs in emails;
// in tests we don't have an SMTP intercept, so we query the table directly to
// extract the latest token for a given identifier (email or `<purpose>:<email>`).
//
// This file imports `@virn/database` for the Drizzle client, so it can ONLY be
// used in Node-side test code (it cannot be imported into a Playwright test file
// that runs in the browser context). Playwright spec files run in Node by
// default, so this is fine for our use case.

import { db, organization, user, verification } from "@virn/database";
import { desc, eq, gte, like, or } from "drizzle-orm";

/**
 * Fetch the most recent verification row for a given email — used to extract
 * magic-link / password-reset / email-verification tokens in tests.
 *
 * Better Auth uses different identifier formats per flow:
 *   - email verification: the email
 *   - magic link: the email (with no prefix in v1.x)
 *   - password reset: typically `reset-password:<email>` or similar
 *
 * To stay robust against version drift, we match by `identifier = email` OR
 * `identifier LIKE '%<email>'`, ordered by creation time desc.
 *
 * If `minAgeMs` is set, only consider rows created within the last N ms — used
 * to avoid picking up tokens from prior tests with the same email (in practice
 * test emails are unique, but the guard is cheap).
 */
export async function getLatestVerificationForEmail(
	email: string,
	options: { minAgeMs?: number } = {},
): Promise<{ value: string; identifier: string; createdAt: Date } | null> {
	const conditions = [
		eq(verification.identifier, email),
		like(verification.identifier, `%${email}`),
		like(verification.value, `%"email":"${email}"%`),
	];

	const rows = await db
		.select({
			value: verification.value,
			identifier: verification.identifier,
			createdAt: verification.createdAt,
		})
		.from(verification)
		.where(
			options.minAgeMs
				? or(...conditions, gte(verification.createdAt, new Date(Date.now() - options.minAgeMs)))
				: or(...conditions),
		)
		.orderBy(desc(verification.createdAt))
		.limit(1);

	const row = rows[0];
	if (!row) return null;

	// Normalize for magic links: if the value is JSON containing the email,
	// the actual token is stored in the identifier column.
	if (row.value.startsWith("{") && row.value.includes(`"email":"${email}"`)) {
		return {
			value: row.identifier, // The token is row.identifier
			identifier: email,
			createdAt: row.createdAt,
		};
	}

	return row;
}

/**
 * Block-and-wait for a verification row to appear for the given email. Useful
 * after triggering signup / magic-link / password-reset where the row is
 * written asynchronously by Better Auth's handler.
 */
export async function waitForVerificationForEmail(
	email: string,
	options: { timeoutMs?: number; pollIntervalMs?: number } = {},
): Promise<{ value: string; identifier: string; createdAt: Date }> {
	const { timeoutMs = 5_000, pollIntervalMs = 100 } = options;
	const deadline = Date.now() + timeoutMs;

	while (Date.now() < deadline) {
		const row = await getLatestVerificationForEmail(email);
		if (row) return row;
		await new Promise((r) => setTimeout(r, pollIntervalMs));
	}

	throw new Error(
		`Timed out waiting for a verification row for ${email}. Did the auth flow trigger a token write?`,
	);
}

/**
 * Check whether the user with the given email exists in the database.
 */
export async function userExists(email: string): Promise<boolean> {
	const row = await db
		.select({ id: user.id })
		.from(user)
		.where(eq(user.email, email))
		.limit(1);
	return row.length > 0;
}

/**
 * Read the user's `emailVerified` flag. Returns false if the user doesn't exist.
 */
export async function isEmailVerified(email: string): Promise<boolean> {
	const row = await db
		.select({ emailVerified: user.emailVerified })
		.from(user)
		.where(eq(user.email, email))
		.limit(1);
	return row[0]?.emailVerified ?? false;
}

/**
 * Look up an organization's id by its slug. Used by IDOR tests that need a
 * real (not placeholder) org id to probe with.
 */
export async function getOrganizationIdBySlug(slug: string): Promise<string | null> {
	const row = await db
		.select({ id: organization.id })
		.from(organization)
		.where(eq(organization.slug, slug))
		.limit(1);
	return row[0]?.id ?? null;
}

/**
 * Delete a test user and all cascading rows by email. Best-effort cleanup
 * after a test; failures are swallowed so a partially-created user doesn't
 * leave the suite red.
 */
export async function deleteTestUserByEmail(email: string): Promise<void> {
	try {
		await db.delete(user).where(eq(user.email, email));
	} catch {
		// Best-effort cleanup. The next test run generates a new unique email so
		// leftover rows don't cause cross-test interference.
	}
}
