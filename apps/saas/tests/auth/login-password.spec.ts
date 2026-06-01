import { expect, test } from "@playwright/test";

import {
	completeEmailVerification,
	getSessionViaApi,
	logInWithPasswordViaUI,
	signUpViaUI,
} from "../__helpers/auth";
import { deleteTestUserByEmail } from "../__helpers/db";
import { makeTestEmail, makeTestName, makeTestPassword } from "../__helpers/test-users";

test.describe("password login (AUTH_CONTRACT.md §5.1)", () => {
	test("verified user can sign in with email + password", async ({ page }) => {
		const email = makeTestEmail("login");
		const password = makeTestPassword();
		const name = makeTestName();

		try {
			// Setup: create + verify the account.
			await signUpViaUI(page, { email, password, name });
			await completeEmailVerification(page, email);

			// Sign out before testing fresh login.
			// Reliably drop to a logged-out state before the login under test. (Email
			// verification auto-signs-in via autoSignInAfterVerification, and a POST to
			// /api/auth/sign-out doesn't always clear the context here; clearing cookies is
			// the deterministic precondition. The sign-out *API* is covered by logout.spec.ts.)
			await page.context().clearCookies();

			await logInWithPasswordViaUI(page, { email, password });

			// After successful login the user is redirected away from /login.
			await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 10_000 });

			const session = await getSessionViaApi(page);
			expect(session?.email).toBe(email);
		} finally {
			await deleteTestUserByEmail(email);
		}
	});

	test("login with wrong password shows an error and does not create a session", async ({
		page,
	}) => {
		const email = makeTestEmail("badpw");
		const password = makeTestPassword();
		const name = makeTestName();

		try {
			await signUpViaUI(page, { email, password, name });
			await completeEmailVerification(page, email);
			// Reliably drop to a logged-out state before the login under test. (Email
			// verification auto-signs-in via autoSignInAfterVerification, and a POST to
			// /api/auth/sign-out doesn't always clear the context here; clearing cookies is
			// the deterministic precondition. The sign-out *API* is covered by logout.spec.ts.)
			await page.context().clearCookies();

			await logInWithPasswordViaUI(page, { email, password: "wrong-password-1!" });

			// Error alert is visible and we stay on /login.
			await expect(page.getByRole("alert").or(page.getByText(/invalid|incorrect|wrong/i)))
				.toBeVisible({ timeout: 5_000 });
			expect(new URL(page.url()).pathname).toMatch(/^\/login/);

			const session = await getSessionViaApi(page);
			expect(session).toBeNull();
		} finally {
			await deleteTestUserByEmail(email);
		}
	});
});
