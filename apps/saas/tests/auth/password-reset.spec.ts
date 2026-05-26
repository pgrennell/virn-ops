import { expect, test } from "@playwright/test";

import {
	completeEmailVerification,
	completePasswordResetViaUI,
	getSessionViaApi,
	logInWithPasswordViaUI,
	requestPasswordResetViaUI,
	signUpViaUI,
} from "../__helpers/auth";
import { deleteTestUserByEmail } from "../__helpers/db";
import { makeTestEmail, makeTestName, makeTestPassword } from "../__helpers/test-users";

test.describe("password reset (AUTH_CONTRACT.md §5.1)", () => {
	test("user can reset their password and sign in with the new one", async ({ page }) => {
		const email = makeTestEmail("reset");
		const oldPassword = makeTestPassword();
		const newPassword = makeTestPassword();

		try {
			// Setup: existing, verified user.
			await signUpViaUI(page, {
				email,
				password: oldPassword,
				name: makeTestName(),
			});
			await completeEmailVerification(page, email);
			await page.request.post("/api/auth/sign-out").catch(() => {});

			// Request the reset email.
			await requestPasswordResetViaUI(page, email);
			await expect(page.getByText(/check your email|sent|email/i)).toBeVisible({
				timeout: 10_000,
			});

			// Complete the reset flow.
			await completePasswordResetViaUI(page, email, newPassword);

			// Old password should no longer work.
			await page.request.post("/api/auth/sign-out").catch(() => {});
			await logInWithPasswordViaUI(page, { email, password: oldPassword });
			await expect(page.getByRole("alert").or(page.getByText(/invalid|incorrect|wrong/i)))
				.toBeVisible({ timeout: 5_000 });
			expect(await getSessionViaApi(page)).toBeNull();

			// New password works.
			await logInWithPasswordViaUI(page, { email, password: newPassword });
			await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 10_000 });
			const session = await getSessionViaApi(page);
			expect(session?.email).toBe(email);
		} finally {
			await deleteTestUserByEmail(email);
		}
	});
});
