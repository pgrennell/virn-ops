// Composite auth helpers — drive the UI for the flow under test, hit Better
// Auth's API for setup/teardown, and query the DB via helpers/db.ts for token
// extraction.

import type { Page } from "@playwright/test";

import { waitForVerificationForEmail } from "./db";

/**
 * Drive the signup form. Returns once the form has been submitted; the caller
 * is responsible for asserting the success state (a green alert with "check
 * your email" copy, since email verification is required when
 * `enableSignup === true`).
 */
export async function signUpViaUI(
	page: Page,
	creds: { email: string; password: string; name: string },
): Promise<void> {
	await page.goto("/signup");
	await page.getByRole("textbox", { name: /name/i }).fill(creds.name);
	await page.getByRole("textbox", { name: /email/i }).fill(creds.email);
	await page.locator('input[autocomplete="new-password"]').fill(creds.password);
	await page.getByRole("button", { name: /create.*account|sign up/i }).click();
}

/**
 * Drive the password-mode login. Asserts nothing — the caller decides what
 * success means (redirect target, presence of a UI element, etc.).
 */
export async function logInWithPasswordViaUI(
	page: Page,
	creds: { email: string; password: string },
): Promise<void> {
	await page.goto("/login");
	await page.getByRole("tab", { name: "Password" }).click();
	await page.getByRole("textbox", { name: /email/i }).fill(creds.email);
	await page.locator('input[autocomplete="current-password"]').fill(creds.password);
	await page.getByRole("button", { name: /sign in/i }).click();
}

/**
 * Drive the magic-link request UI. Returns once the form has been submitted
 * — the success alert ("link sent") indicates the verification row is now
 * being written. Use `clickLatestMagicLinkForEmail` next to complete the flow.
 */
export async function requestMagicLinkViaUI(page: Page, email: string): Promise<void> {
	await page.goto("/login");
	await page.getByRole("tab", { name: "Magic link" }).click();
	await page.getByRole("textbox", { name: /email/i }).fill(email);
	await page.getByRole("button", { name: /send magic link/i }).click();
}

/**
 * Drive the forgot-password UI. Returns once the form has been submitted.
 */
export async function requestPasswordResetViaUI(page: Page, email: string): Promise<void> {
	await page.goto("/forgot-password");
	await page.getByRole("textbox", { name: /email/i }).fill(email);
	await page.getByRole("button", { name: /send|reset/i }).click();
}

/**
 * Find the latest verification token for an email and navigate to Better
 * Auth's magic-link verify endpoint. After this resolves, the browser holds a
 * valid session cookie for the email's user (assuming the token wasn't already
 * consumed). Better Auth's verify endpoint redirects to `callbackURL`, so the
 * `page.url()` after this call is wherever the magic-link flow lands the user.
 */
export async function clickLatestMagicLinkForEmail(
	page: Page,
	email: string,
): Promise<{ token: string }> {
	const row = await waitForVerificationForEmail(email);
	// Better Auth 1.x verifies magic links at GET /api/auth/magic-link/verify
	// with the token as a query param. The callback URL defaults to the
	// app's configured baseURL when not provided in the link request.
	const verifyUrl = `/api/auth/magic-link/verify?token=${encodeURIComponent(row.value)}`;
	await page.goto(verifyUrl);
	return { token: row.value };
}

/**
 * Complete the email verification flow by reading the latest verification
 * token and navigating to Better Auth's verify-email endpoint.
 */
export async function completeEmailVerification(
	page: Page,
	email: string,
): Promise<{ token: string }> {
	const row = await waitForVerificationForEmail(email);
	const verifyUrl = `/api/auth/verify-email?token=${encodeURIComponent(row.value)}`;
	await page.goto(verifyUrl);
	return { token: row.value };
}

/**
 * Complete the password reset flow. Reads the latest token, opens the reset
 * page with it, types the new password twice (the form requires confirmation),
 * and submits.
 */
export async function completePasswordResetViaUI(
	page: Page,
	email: string,
	newPassword: string,
): Promise<void> {
	const row = await waitForVerificationForEmail(email);
	await page.goto(`/reset-password?token=${encodeURIComponent(row.value)}`);
	const passwordInputs = page.locator('input[type="password"]');
	await passwordInputs.first().fill(newPassword);
	await passwordInputs.nth(1).fill(newPassword);
	await page.getByRole("button", { name: /reset|set.*password|save/i }).click();
}

/**
 * Click the user-menu trigger in the app shell and select Logout. Works in
 * both AppShell (org routes) and AccountShell (account/admin/chatbot routes
 * and the not-found page) — both render the same UserMenu component.
 */
export async function logOutViaUI(page: Page): Promise<void> {
	// The user-menu button has aria-label="User menu" (see UserMenu.tsx).
	await page.getByRole("button", { name: "User menu" }).click();
	await page.getByRole("menuitem", { name: /logout|sign out/i }).click();
}

/**
 * Convenience: read the active session via Better Auth's `/api/auth/get-session`
 * endpoint. Returns null when no session is set. Used by tests to assert the
 * session was created/cleared without driving any UI.
 */
export async function getSessionViaApi(
	page: Page,
): Promise<{ userId: string; email: string } | null> {
	const response = await page.request.get("/api/auth/get-session");
	if (!response.ok()) return null;
	const body = (await response.json()) as
		| { user?: { id?: string; email?: string } | null }
		| null;
	if (!body?.user?.id || !body.user.email) return null;
	return { userId: body.user.id, email: body.user.email };
}
