import { expect, test } from "@playwright/test";

import {
	completeEmailVerification,
	completeOnboardingViaUI,
	getSessionViaApi,
	signUpViaUI,
} from "../__helpers/auth";
import { deleteTestUserByEmail } from "../__helpers/db";
import { createOrganizationViaUI } from "../__helpers/org";
import {
	makeTestEmail,
	makeTestName,
	makeTestOrgName,
	makeTestPassword,
} from "../__helpers/test-users";

test.describe("organization create + switch (AUTH_CONTRACT.md §5.3)", () => {
	test("user can create two organizations and they're both reachable by slug", async ({
		page,
	}) => {
		const email = makeTestEmail("orgcreate");

		try {
			await signUpViaUI(page, {
				email,
				password: makeTestPassword(),
				name: makeTestName(),
			});
			await completeEmailVerification(page, email);
			expect((await getSessionViaApi(page))?.email).toBe(email);
			await completeOnboardingViaUI(page); // else org routes redirect to /onboarding

			const firstOrgName = makeTestOrgName("Alpha");
			const { slug: firstSlug } = await createOrganizationViaUI(page, { name: firstOrgName });
			expect(firstSlug).toBeTruthy();
			expect(new URL(page.url()).pathname).toMatch(new RegExp(`^/${firstSlug}`));

			const secondOrgName = makeTestOrgName("Beta");
			const { slug: secondSlug } = await createOrganizationViaUI(page, { name: secondOrgName });
			expect(secondSlug).toBeTruthy();
			expect(secondSlug).not.toBe(firstSlug);

			// Manual switch via URL — proves both orgs are reachable by their owner.
			// The org layout's `resolveOrgGating` accepts the slug because the user
			// is a member of both.
			await page.goto(`/${firstSlug}`);
			await page.waitForURL((url) => url.pathname.startsWith(`/${firstSlug}`), {
				timeout: 10_000,
			});
			expect(new URL(page.url()).pathname).toMatch(new RegExp(`^/${firstSlug}`));

			await page.goto(`/${secondSlug}`);
			await page.waitForURL((url) => url.pathname.startsWith(`/${secondSlug}`), {
				timeout: 10_000,
			});
			expect(new URL(page.url()).pathname).toMatch(new RegExp(`^/${secondSlug}`));
		} finally {
			await deleteTestUserByEmail(email);
		}
	});
});
