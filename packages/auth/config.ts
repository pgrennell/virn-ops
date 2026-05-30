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
			// Phase 15 -- compliance / evidence reader ships as the org-scoped
			// /[organizationSlug]/compliance route. Slug reserved defensively
			// (matches the `sop` precedent) so future evolution of a top-level
			// compliance surface can claim the path without collision.
			"compliance",
			"forgot-password",
			"image-proxy",
			"login",
			"new-organization",
			"onboarding",
			"organization-invitation",
			// Phase 9.6 reservation -- the Playbooks builder + read-view detail page
			// will live at /playbooks/* (per PRD_PLAYBOOKS §6.5 + Phase 18a). Reserved
			// now so the schema seam + the eventual route land together without an
			// org-slug collision risk. See INTENTIONALLY_RESERVED_SLUGS in
			// config.invariants.test.ts.
			"playbooks",
			"reset-password",
			"run-guest",
			"settings",
			"signup",
			// Phase 10 / v1.5c -- the readers' index at /sop (PRD §6.4) browses
			// published workflows across the org. Reserved alongside the
			// route landing so an org can't claim "sop" as its slug.
			"sop",
			"verify",
		],
	},
} as const satisfies AuthConfig;
