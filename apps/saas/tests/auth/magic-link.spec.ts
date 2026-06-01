import { expect, test } from "@playwright/test";

import {
	clickLatestMagicLinkForEmail,
	completeEmailVerification,
	getSessionViaApi,
	requestMagicLinkViaUI,
	signUpViaUI,
} from "../__helpers/auth";
import { deleteTestUserByEmail } from "../__helpers/db";
import { makeTestEmail, makeTestName, makeTestPassword } from "../__helpers/test-users";

test.describe("magic-link login (AUTH_CONTRACT.md §5.1)", () => {
	test("verified user can sign in by clicking a magic link", async ({ page }) => {
		const email = makeTestEmail("magic");

		try {
			// Setup: an existing, verified user.
			await signUpViaUI(page, {
				email,
				password: makeTestPassword(),
				name: makeTestName(),
			});
			await completeEmailVerification(page, email);
			await page.context().clearCookies(); // reliable logged-out precondition (verify auto-signs-in; see login-password.spec.ts)

			// Request a magic link via the login form.
			await requestMagicLinkViaUI(page, email);
			await expect(page.getByText(/check your email|link sent|sent/i).first()).toBeVisible({
				timeout: 10_000,
			});

			// Read the token from the DB and click through.
			await clickLatestMagicLinkForEmail(page, email);

			// After verification, the magic-link endpoint redirects into the app.
			await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 10_000 });

			const session = await getSessionViaApi(page);
			expect(session?.email).toBe(email);
		} finally {
			await deleteTestUserByEmail(email);
		}
	});
});
