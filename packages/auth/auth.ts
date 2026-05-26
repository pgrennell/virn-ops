import { passkey } from "@better-auth/passkey";
import {
	db,
	getInvitationById,
	getOrganizationMembership,
	getPurchasesByOrganizationId,
	getPurchasesByUserId,
	getUserByEmail,
	getUserById,
} from "@virn/database";
import { config as i18nConfig, type Locale } from "@virn/i18n";
import { logger } from "@virn/logs";
import { sendEmail } from "@virn/mail";
import { createWelcomeNotification } from "@virn/notifications";
import { cancelSubscription } from "@virn/payments";
import { getBaseUrl } from "@virn/utils";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { admin, magicLink, openAPI, organization, twoFactor, username } from "better-auth/plugins";
import { parse as parseCookies } from "cookie";

import { config } from "./config";
import { updateSeatsInOrganizationSubscription } from "./lib/organization";
import { invitationOnlyPlugin } from "./plugins/invitation-only";

const getLocaleFromRequest = (request?: Request) => {
	const cookies = parseCookies(request?.headers.get("cookie") ?? "");
	return (cookies[i18nConfig.localeCookieName] as Locale) ?? i18nConfig.defaultLocale;
};

const appUrl = getBaseUrl(process.env.NEXT_PUBLIC_SAAS_URL, 3000);

export const auth = betterAuth({
	baseURL: appUrl,
	trustedOrigins: [appUrl],
	database: drizzleAdapter(db, {
		provider: "pg",
	}),
	advanced: {
		database: {
			generateId: false,
		},
	},
	session: {
		expiresIn: config.sessionCookieMaxAge,
		// 1 day. Any endpoint that opts into Better Auth's "fresh session" check
		// (typically used for sensitive ops like change-password, change-email,
		// delete-user) refuses sessions older than this without re-auth. The prior
		// value of 0 made every session "fresh" indefinitely. See AUTH_CONTRACT.md §7.2.
		freshAge: 60 * 60 * 24,
	},
	databaseHooks: {
		session: {
			create: {
				before: async (session) => {
					const user = await getUserById(session.userId);
					return {
						data: {
							...session,
							activeOrganizationId: user?.lastActiveOrganizationId ?? null,
						},
					};
				},
			},
		},
		user: {
			create: {
				after: async (createdUser) => {
					if (!createdUser?.id) {
						return;
					}
					try {
						await createWelcomeNotification(createdUser.id);
					} catch (error) {
						logger.error(error, {
							ctx: "createWelcomeNotification",
							userId: createdUser.id,
						});
					}
				},
			},
		},
	},
	account: {
		accountLinking: {
			enabled: true,
			trustedProviders: ["google", "github"],
		},
	},
	hooks: {
		after: createAuthMiddleware(async (ctx) => {
			if (ctx.path.startsWith("/organization/accept-invitation")) {
				const { invitationId } = ctx.body;

				if (!invitationId) {
					return;
				}

				const invitation = await getInvitationById(invitationId);

				if (!invitation) {
					return;
				}

				await updateSeatsInOrganizationSubscription(invitation.organizationId);
			} else if (ctx.path.startsWith("/organization/remove-member")) {
				const { organizationId } = ctx.body;

				if (!organizationId) {
					return;
				}

				await updateSeatsInOrganizationSubscription(organizationId);
			}
		}),
		before: createAuthMiddleware(async (ctx) => {
			// Subscription cancellation runs in `before` (not `after`) because the
			// `purchase` table cascade-deletes with user/organization — the rows are
			// gone by the time `after` fires. To close the original "malformed request
			// nukes subs" gap (AUTH_CONTRACT.md §7.5), we explicitly authorize the
			// caller HERE before any cancellation side-effect.

			if (!ctx.path.startsWith("/delete-user") && !ctx.path.startsWith("/organization/delete")) {
				return;
			}

			const userId = ctx.context.session?.session.userId;
			if (!userId) {
				throw new APIError("UNAUTHORIZED", {
					message: "Authentication required to cancel subscriptions on delete.",
				});
			}

			const organizationId = ctx.body?.organizationId as string | undefined;

			if (organizationId) {
				// Org delete: caller must be the owner. Better Auth's org plugin
				// enforces this internally, but we re-check here so the cancellation
				// can't fire on a request that the plugin would later reject.
				const membership = await getOrganizationMembership(organizationId, userId);
				if (!membership || membership.role !== "owner") {
					throw new APIError("FORBIDDEN", {
						message: "Only the organization owner can delete the organization.",
					});
				}
			}

			const purchases = organizationId
				? await getPurchasesByOrganizationId(organizationId)
				: await getPurchasesByUserId(userId);

			const subscriptions = purchases.filter(
				(purchase) => purchase.type === "SUBSCRIPTION" && purchase.subscriptionId !== null,
			);

			for (const subscription of subscriptions) {
				if (subscription.subscriptionId) {
					await cancelSubscription(subscription.subscriptionId);
				}
			}
		}),
	},
	user: {
		additionalFields: {
			onboardingComplete: {
				type: "boolean",
				required: false,
			},
			locale: {
				type: "string",
				required: false,
			},
			lastActiveOrganizationId: {
				type: "string",
				required: false,
			},
		},
		deleteUser: {
			enabled: true,
		},
		changeEmail: {
			enabled: true,
			sendChangeEmailConfirmation: async ({ user: { email, name }, url }, request) => {
				const locale = getLocaleFromRequest(request);
				await sendEmail({
					to: email,
					templateId: "emailVerification",
					context: {
						url,
						name,
					},
					locale,
				});
			},
		},
	},
	emailAndPassword: {
		enabled: true,
		// If signup is disabled, the only way to sign up is via an invitation. So in this case we can auto sign in the user, as the email is already verified by the invitation.
		// If signup is enabled, we can't auto sign in the user, as the email is not verified yet.
		autoSignIn: !config.enableSignup,
		requireEmailVerification: config.enableSignup,
		sendResetPassword: async ({ user, url }, request) => {
			const locale = getLocaleFromRequest(request);
			await sendEmail({
				to: user.email,
				templateId: "forgotPassword",
				context: {
					url,
					name: user.name,
				},
				locale,
			});
		},
		minPasswordLength: 8,
	},
	emailVerification: {
		sendOnSignUp: config.enableSignup,
		autoSignInAfterVerification: true,
		sendVerificationEmail: async ({ user: { email, name }, url }, request) => {
			const locale = getLocaleFromRequest(request);
			await sendEmail({
				to: email,
				templateId: "emailVerification",
				context: {
					url,
					name,
				},
				locale,
			});
		},
	},
	socialProviders: {
		google: {
			clientId: process.env.GOOGLE_CLIENT_ID as string,
			clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
			scope: ["email", "profile"],
		},
		github: {
			clientId: process.env.GITHUB_CLIENT_ID as string,
			clientSecret: process.env.GITHUB_CLIENT_SECRET as string,
			scope: ["user:email"],
		},
	},
	plugins: [
		username(),
		admin(),
		passkey(),
		magicLink({
			// Tie magic-link auto-signup to the global signup toggle. When
			// `config.enableSignup === false` (invitation-only mode), magic-links to
			// unknown emails fail instead of silently provisioning accounts — closing
			// the invitation-only bypass described in AUTH_CONTRACT.md §7.4.
			disableSignUp: !config.enableSignup,
			sendMagicLink: async ({ email, url }, ctx) => {
				const request = ctx?.request as Request;

				const locale = getLocaleFromRequest(request);
				await sendEmail({
					to: email,
					templateId: "magicLink",
					context: {
						url,
					},
					locale,
				});
			},
		}),
		organization({
			sendInvitationEmail: async ({ email, id, organization }, request) => {
				const locale = getLocaleFromRequest(request);
				const existingUser = await getUserByEmail(email);

				const url = new URL(
					existingUser ? "/login" : "/signup",
					getBaseUrl(process.env.NEXT_PUBLIC_SAAS_URL, 3000),
				);

				url.searchParams.set("invitationId", id);
				url.searchParams.set("email", email);

				await sendEmail({
					to: email,
					templateId: "organizationInvitation",
					locale,
					context: {
						organizationName: organization.name,
						url: url.toString(),
					},
				});
			},
		}),
		openAPI(),
		invitationOnlyPlugin(),
		twoFactor(),
	],
	onAPIError: {
		onError(error, ctx) {
			logger.error(error, { ctx });
		},
	},
});

export * from "./lib/organization";

export type Session = typeof auth.$Infer.Session;

export type ActiveOrganization = NonNullable<
	Awaited<ReturnType<typeof auth.api.getFullOrganization>>
>;

export type Organization = typeof auth.$Infer.Organization;

export type OrganizationMemberRole = ActiveOrganization["members"][number]["role"];

export type OrganizationInvitationStatus = typeof auth.$Infer.Invitation.status;

export type OrganizationMetadata = Record<string, unknown> | undefined;
