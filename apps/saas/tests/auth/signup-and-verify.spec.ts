import { expect, test } from "@playwright/test";

import {
	completeEmailVerification,
	getSessionViaApi,
	signUpViaUI,
} from "../__helpers/auth";
import { deleteTestUserByEmail, isEmailVerified, userExists } from "../__helpers/db";
import { makeTestEmail, makeTestName, makeTestPassword } from "../__helpers/test-users";

test.describe("signup + email verification (AUTH_CONTRACT.md §5.1)", () => {
	test("user can sign up, verify email, and reach an authenticated route", async ({ page }) => {
		const email = makeTestEmail("signup");
		const password = makeTestPassword();
		const name = makeTestName();

		try {
			await signUpViaUI(page, { email, password, name });

			// Better Auth's email+password + enableSignup=true flow does NOT auto-sign-in
			// (per AUTH_CONTRACT.md §6 #4) — the user sees a "check your email" alert.
			await expect(page.getByText(/check your email|verify|sent/i)).toBeVisible({ timeout: 10_000 });

			// The user row exists but emailVerified is false until the link is clicked.
			expect(await userExists(email)).toBe(true);
			expect(await isEmailVerified(email)).toBe(false);

			// Complete the verification: read the token from the DB, hit the verify URL.
			await completeEmailVerification(page, email);

			// After verification: autoSignInAfterVerification = true (§6 #4), so the user
			// is signed in. The session API confirms it.
			await expect.poll(() => isEmailVerified(email), { timeout: 10_000 }).toBe(true);
			const session = await getSessionViaApi(page);
			expect(session?.email).toBe(email);
		} finally {
			await deleteTestUserByEmail(email);
		}
	});
});
