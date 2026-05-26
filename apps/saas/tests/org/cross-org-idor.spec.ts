import { expect, test } from "@playwright/test";

import {
	completeEmailVerification,
	getSessionViaApi,
	logInWithPasswordViaUI,
	signUpViaUI,
} from "../__helpers/auth";
import { deleteTestUserByEmail, getOrganizationIdBySlug } from "../__helpers/db";
import { createOrganizationViaUI } from "../__helpers/org";
import {
	makeTestEmail,
	makeTestName,
	makeTestOrgName,
	makeTestPassword,
} from "../__helpers/test-users";

test.describe("cross-org IDOR denial (AUTH_CONTRACT.md §3.1, §4)", () => {
	test("a user who is not a member of an org cannot reach it via slug", async ({ page }) => {
		const ownerEmail = makeTestEmail("owner");
		const ownerPassword = makeTestPassword();
		const intruderEmail = makeTestEmail("intruder");
		const intruderPassword = makeTestPassword();
		let ownerOrgSlug: string | undefined;

		try {
			// Owner creates an org.
			await signUpViaUI(page, {
				email: ownerEmail,
				password: ownerPassword,
				name: makeTestName("Owner"),
			});
			await completeEmailVerification(page, ownerEmail);

			const orgName = makeTestOrgName("Confidential");
			const created = await createOrganizationViaUI(page, { name: orgName });
			ownerOrgSlug = created.slug;
			expect(ownerOrgSlug).toBeTruthy();

			// Sign owner out.
			await page.request.post("/api/auth/sign-out").catch(() => {});
			expect(await getSessionViaApi(page)).toBeNull();

			// Intruder signs up separately.
			await signUpViaUI(page, {
				email: intruderEmail,
				password: intruderPassword,
				name: makeTestName("Intruder"),
			});
			await completeEmailVerification(page, intruderEmail);
			await page.request.post("/api/auth/sign-out").catch(() => {});
			await logInWithPasswordViaUI(page, { email: intruderEmail, password: intruderPassword });
			await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 10_000 });
			expect((await getSessionViaApi(page))?.email).toBe(intruderEmail);

			// Intruder attempts to reach the owner's org by URL.
			const response = await page.goto(`/${ownerOrgSlug}`);

			// Expected: notFound() or redirect away. The resolveOrgGating helper
			// returns null for non-members → notFound(). Either outcome (404 or a
			// redirect that lands outside the org route) is acceptable; what we
			// MUST NOT see is the org's contents.
			const statusCode = response?.status() ?? 0;
			const finalPath = new URL(page.url()).pathname;

			const isBlocked =
				statusCode === 404 ||
				!finalPath.startsWith(`/${ownerOrgSlug}`) ||
				(await page.getByText(/not found|404|notfound/i).first().isVisible({ timeout: 2_000 })
					.catch(() => false));

			expect(isBlocked, [
				"Cross-org access leak: an authenticated user who is not a member of",
				`"${ownerOrgSlug}" was able to reach its surface.`,
				"This is an Invariant #1 violation. See AUTH_CONTRACT.md §3.1, §4.",
				`Status: ${statusCode}, URL: ${page.url()}`,
			].join(" ")).toBe(true);

			// Belt + braces: probe the listPurchases procedure with the OWNER's real
			// org id while logged in as the intruder. After Batch A's membership
			// check, this must return FORBIDDEN — anything else is a regression of
			// the IDOR defense (AUTH_CONTRACT.md §3.1).
			const ownerOrgId = await getOrganizationIdBySlug(ownerOrgSlug);
			expect(ownerOrgId, "Could not look up owner org id by slug").not.toBeNull();

			const purchasesResponse = await page.request.get(
				`/api/rpc/payments/listPurchases?input=${encodeURIComponent(
					JSON.stringify({ organizationId: ownerOrgId }),
				)}`,
			);
			expect(
				purchasesResponse.status(),
				`listPurchases cross-org probe should refuse with 401/403/404 — got ${purchasesResponse.status()}. See AUTH_CONTRACT.md §3.1.`,
			).toBeGreaterThanOrEqual(400);
			expect(purchasesResponse.status()).toBeLessThan(500);
		} finally {
			await deleteTestUserByEmail(ownerEmail);
			await deleteTestUserByEmail(intruderEmail);
		}
	});
});
