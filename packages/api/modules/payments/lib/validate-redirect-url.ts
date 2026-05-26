// Same-origin redirect-URL guard for payments procedures.
//
// Per docs/AUTH_CONTRACT.md §7 and the original code-review finding, the
// `redirectUrl` passed to Stripe checkout / customer-portal links is an
// open-redirect surface unless validated. This helper:
//
//   - allows relative paths (start with "/") — these always resolve against
//     the SaaS origin and can't be used for off-host redirects;
//   - allows absolute URLs whose origin matches NEXT_PUBLIC_SAAS_URL (the
//     configured app base URL);
//   - rejects everything else.
//
// Throws ORPCError BAD_REQUEST on failure so the procedure handler can `.use()`
// or call directly without extra plumbing.

import { ORPCError } from "@orpc/client";
import { getBaseUrl } from "@virn/utils";

export function assertSameOriginRedirect(redirectUrl: string | undefined): void {
	if (!redirectUrl) return;

	// Relative paths are always safe: the host portion can't be subverted.
	if (redirectUrl.startsWith("/") && !redirectUrl.startsWith("//")) {
		return;
	}

	try {
		const parsed = new URL(redirectUrl);
		const baseUrl = getBaseUrl(process.env.NEXT_PUBLIC_SAAS_URL, 3000);
		const allowed = new URL(baseUrl);
		if (parsed.origin === allowed.origin) {
			return;
		}
	} catch {
		// Falls through to the throw below.
	}

	throw new ORPCError("BAD_REQUEST", {
		message: "redirectUrl must be a same-origin path or absolute URL.",
	});
}
