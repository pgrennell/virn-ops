import { expect, test } from "@playwright/test";

import {
	completeEmailVerification,
	getSessionViaApi,
	logInWithPasswordViaUI,
	logOutViaUI,
	signUpViaUI,
} from "../__helpers/auth";
import { deleteTestUserByEmail } from "../__helpers/db";
import { makeTestEmail, makeTestName, makeTestPassword } from "../__helpers/test-users";

test.describe("logout (AUTH_CONTRACT.md §5.4)", () => {
	test("logout clears the session and redirects out of authenticated routes", async ({ page }) => {
		const email = makeTestEmail("logout");
		const password = makeTestPassword();

		try {
			// Setup: signed-in, verified user.
			await signUpViaUI(page, { email, password, name: makeTestName() });
			await completeEmailVerification(page, email);
			await page.request.post("/api/auth/sign-out").catch(() => {});
			await logInWithPasswordViaUI(page, { email, password });
			await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 10_000 });

			// Click through the user menu's Logout item.
			await logOutViaUI(page);

			// Session is gone.
			await expect.poll(() => getSessionViaApi(page), { timeout: 5_000 }).toBeNull();

			// The user is no longer inside an authenticated surface; subsequent
			// attempt to hit a protected route should bounce them to /login.
			await page.goto("/");
			await page.waitForURL(/\/login/, { timeout: 10_000 });
		} finally {
			await deleteTestUserByEmail(email);
		}
	});
});
