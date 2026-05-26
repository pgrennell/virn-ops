import type { AuthConfig } from "./types";

export const config = {
	enableSignup: true,
	enableMagicLink: true,
	enableSocialLogin: true,
	enablePasskeys: true,
	enablePasswordLogin: true,
	enableTwoFactor: true,
	// 7 days. Tightened from the Supastarter default of 30d (AUTH_CONTRACT.md §7.2)
	// so a leaked session token has a bounded blast radius.
	sessionCookieMaxAge: 60 * 60 * 24 * 7,
	users: {
		enableOnboarding: true,
	},
	organizations: {
		enable: true,
		hideOrganization: false,
		enableUsersToCreateOrganizations: true,
		requireOrganization: false,
		// Reserved org slugs that must stay unavailable to avoid collisions with
		// concrete top-level URL segments (Next.js matches static segments before
		// the [organizationSlug] dynamic segment). Bidirectionally pinned by
		// packages/auth/config.invariants.test.ts — adding a top-level route
		// without updating this list will fail CI.
		forbiddenOrganizationSlugs: [
			"admin",
			"ai-demo",
			"api",
			"chatbot",
			"checkout-return",
			"choose-plan",
			"forgot-password",
			"image-proxy",
			"login",
			"new-organization",
			"onboarding",
			"organization-invitation",
			"reset-password",
			"run-guest",
			"settings",
			"signup",
			"verify",
		],
	},
} as const satisfies AuthConfig;
