// Auth config snapshot test — pins the values listed in docs/AUTH_CONTRACT.md §6.
//
// If this snapshot changes, the change must be a deliberate gesture:
//   1) Update docs/AUTH_CONTRACT.md (specifically §6) in the same PR.
//   2) Re-snapshot via `pnpm --filter @virn/auth test -- -u`.
//   3) Have the reviewer confirm the change is intentional and security-reviewed.
//
// The test mocks workspace imports so that `auth.ts` can be loaded without a
// database connection or env vars. Only the deterministic, contract-relevant
// fields are extracted into the fingerprint — functions, env-derived URLs, and
// other dynamic values are omitted (or recorded as a `hasX: true` shape check).

import { describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Workspace mocks — loaded by vi.mock hoisting BEFORE the `auth` import below.
// Each one mirrors the surface that packages/auth/auth.ts actually imports.
// ---------------------------------------------------------------------------

vi.mock("@virn/database", () => ({
	db: {},
	getInvitationById: vi.fn(),
	getPurchasesByOrganizationId: vi.fn(),
	getPurchasesByUserId: vi.fn(),
	getUserByEmail: vi.fn(),
	getUserById: vi.fn(),
	getOrganizationMembership: vi.fn(),
	getOrganizationWithPurchasesAndMembersCount: vi.fn(),
	getPendingInvitationByEmail: vi.fn(),
}));

vi.mock("@virn/logs", () => ({
	logger: {
		log: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}));

vi.mock("@virn/mail", () => ({
	sendEmail: vi.fn(),
}));

vi.mock("@virn/notifications", () => ({
	createWelcomeNotification: vi.fn(),
}));

vi.mock("@virn/payments", () => ({
	cancelSubscription: vi.fn(),
	setSubscriptionSeats: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Real imports — loaded after mocks are installed.
// ---------------------------------------------------------------------------

import { auth } from "./auth";
import { config as virnAuthConfig } from "./config";

// Better Auth exposes the resolved options object at runtime. Typed loosely so
// the test doesn't break if Better Auth tightens its public types between
// versions; the *values* are what the snapshot pins, not the shape.
interface BetterAuthRuntime {
	options?: {
		plugins?: Array<{ id: string }>;
		emailAndPassword?: {
			enabled?: boolean;
			requireEmailVerification?: boolean;
			autoSignIn?: boolean;
			minPasswordLength?: number;
			sendResetPassword?: unknown;
		};
		emailVerification?: {
			sendOnSignUp?: boolean;
			autoSignInAfterVerification?: boolean;
			sendVerificationEmail?: unknown;
		};
		socialProviders?: {
			google?: { scope?: readonly string[] };
			github?: { scope?: readonly string[] };
		};
		account?: {
			accountLinking?: {
				enabled?: boolean;
				trustedProviders?: readonly string[];
			};
		};
		advanced?: {
			database?: {
				generateId?: boolean;
			};
		};
		session?: {
			expiresIn?: number;
			freshAge?: number;
		};
		user?: {
			additionalFields?: Record<string, unknown>;
			deleteUser?: { enabled?: boolean };
			changeEmail?: { enabled?: boolean; sendChangeEmailConfirmation?: unknown };
		};
		hooks?: {
			before?: unknown;
			after?: unknown;
		};
	};
}

describe("auth config snapshot (docs/AUTH_CONTRACT.md §6)", () => {
	it("matches the contract fingerprint", () => {
		const options = (auth as BetterAuthRuntime).options ?? {};

		const fingerprint = {
			// §6 #1 — plugins enabled, in order
			pluginIds: (options.plugins ?? []).map((p) => p.id),

			// §6 #3, #4, #7 — email + password contract
			emailAndPassword: {
				enabled: options.emailAndPassword?.enabled,
				requireEmailVerification: options.emailAndPassword?.requireEmailVerification,
				autoSignIn: options.emailAndPassword?.autoSignIn,
				minPasswordLength: options.emailAndPassword?.minPasswordLength,
				hasSendResetPassword: typeof options.emailAndPassword?.sendResetPassword === "function",
			},

			// §6 #3, #4 — email verification contract
			emailVerification: {
				sendOnSignUp: options.emailVerification?.sendOnSignUp,
				autoSignInAfterVerification: options.emailVerification?.autoSignInAfterVerification,
				hasSendVerificationEmail:
					typeof options.emailVerification?.sendVerificationEmail === "function",
			},

			// §6 #5 — OAuth scopes (security-relevant; changing alters consent screens)
			socialProviders: {
				google: { scope: options.socialProviders?.google?.scope },
				github: { scope: options.socialProviders?.github?.scope },
			},

			// §6 #6 — account linking trusted providers
			accountLinking: {
				enabled: options.account?.accountLinking?.enabled,
				trustedProviders: options.account?.accountLinking?.trustedProviders,
			},

			// §6 #10 — id generation deferred to schema (cuid in defaults)
			advancedGenerateId: options.advanced?.database?.generateId,

			// Session lifetime + freshness (§6 references both indirectly)
			session: {
				expiresInSeconds: options.session?.expiresIn,
				freshAge: options.session?.freshAge,
			},

			// User lifecycle fields and toggles (§2.4, §5.4)
			user: {
				additionalFieldKeys: Object.keys(options.user?.additionalFields ?? {}).sort(),
				deleteUserEnabled: options.user?.deleteUser?.enabled,
				changeEmailEnabled: options.user?.changeEmail?.enabled,
				hasChangeEmailConfirmation:
					typeof options.user?.changeEmail?.sendChangeEmailConfirmation === "function",
			},

			// §6 #12 — lifecycle hooks present (subscription cancellation, seat updates)
			hooks: {
				hasBeforeHook: !!options.hooks?.before,
				hasAfterHook: !!options.hooks?.after,
			},

			// §6 #9 + Virn-side config knobs
			virnConfig: {
				enableSignup: virnAuthConfig.enableSignup,
				enableMagicLink: virnAuthConfig.enableMagicLink,
				enableSocialLogin: virnAuthConfig.enableSocialLogin,
				enablePasskeys: virnAuthConfig.enablePasskeys,
				enablePasswordLogin: virnAuthConfig.enablePasswordLogin,
				enableTwoFactor: virnAuthConfig.enableTwoFactor,
				sessionCookieMaxAge: virnAuthConfig.sessionCookieMaxAge,
				onboardingEnabled: virnAuthConfig.users.enableOnboarding,
				organizations: {
					enable: virnAuthConfig.organizations.enable,
					hideOrganization: virnAuthConfig.organizations.hideOrganization,
					enableUsersToCreateOrganizations:
						virnAuthConfig.organizations.enableUsersToCreateOrganizations,
					requireOrganization: virnAuthConfig.organizations.requireOrganization,
					forbiddenOrganizationSlugs:
						virnAuthConfig.organizations.forbiddenOrganizationSlugs,
				},
			},
		};

		// The first run will write this snapshot; subsequent runs compare.
		// Re-snapshot with `pnpm --filter @virn/auth test -- -u` only when the change
		// is intentional and AUTH_CONTRACT.md has been updated in the same PR.
		expect(fingerprint).toMatchInlineSnapshot(`
			{
			  "accountLinking": {
			    "enabled": true,
			    "trustedProviders": [
			      "google",
			      "github",
			    ],
			  },
			  "advancedGenerateId": false,
			  "emailAndPassword": {
			    "autoSignIn": false,
			    "enabled": true,
			    "hasSendResetPassword": true,
			    "minPasswordLength": 8,
			    "requireEmailVerification": true,
			  },
			  "emailVerification": {
			    "autoSignInAfterVerification": true,
			    "hasSendVerificationEmail": true,
			    "sendOnSignUp": true,
			  },
			  "hooks": {
			    "hasAfterHook": true,
			    "hasBeforeHook": true,
			  },
			  "pluginIds": [
			    "username",
			    "admin",
			    "passkey",
			    "magic-link",
			    "organization",
			    "open-api",
			    "invitationOnlyPlugin",
			    "two-factor",
			  ],
			  "session": {
			    "expiresInSeconds": 604800,
			    "freshAge": 86400,
			  },
			  "socialProviders": {
			    "github": {
			      "scope": [
			        "user:email",
			      ],
			    },
			    "google": {
			      "scope": [
			        "email",
			        "profile",
			      ],
			    },
			  },
			  "user": {
			    "additionalFieldKeys": [
			      "lastActiveOrganizationId",
			      "locale",
			      "onboardingComplete",
			    ],
			    "changeEmailEnabled": true,
			    "deleteUserEnabled": true,
			    "hasChangeEmailConfirmation": true,
			  },
			  "virnConfig": {
			    "enableMagicLink": true,
			    "enablePasskeys": true,
			    "enablePasswordLogin": true,
			    "enableSignup": true,
			    "enableSocialLogin": true,
			    "enableTwoFactor": true,
			    "onboardingEnabled": true,
			    "organizations": {
			      "enable": true,
			      "enableUsersToCreateOrganizations": true,
			      "forbiddenOrganizationSlugs": [
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
			        "playbooks",
			        "reset-password",
			        "run-guest",
			        "settings",
			        "signup",
			        "verify",
			      ],
			      "hideOrganization": false,
			      "requireOrganization": false,
			    },
			    "sessionCookieMaxAge": 604800,
			  },
			}
		`);
	});
});
