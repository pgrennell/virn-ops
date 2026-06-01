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
	// FIXME: needs a DEDICATED fully-provisioned user fixture. Two dead-ends so far:
	//   1. A brand-new signup (below) lands on onboarding -> org creation and never reaches an app
	//      surface with the user menu, so logOutViaUI hangs.
	//   2. Reusing the seeded admin (via magic link) does reach the menu, but logging that account
	//      out -- or even re-logging it in -- disturbs the shared storageState session the
	//      authenticated project reuses (the next walkthrough fails with "not a member of the
	//      active organization"). An account that gets signed out cannot also be the shared one.
	// The fix is a second seeded, provisioned, NON-shared account (a DB seed change) reserved for
	// this spec, so signing it out affects nothing else.
	test.fixme("logout clears the session and redirects out of authenticated routes", async ({
		page,
	}) => {
		const email = makeTestEmail("logout");
		const password = makeTestPassword();

		try {
			// Setup: signed-in, verified user.
			await signUpViaUI(page, { email, password, name: makeTestName() });
			await completeEmailVerification(page, email);
			await page.context().clearCookies(); // reliable logged-out precondition before the fresh login (verify auto-signs-in)
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
