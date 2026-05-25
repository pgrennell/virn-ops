import { ORPCError, os } from "@orpc/server";
import { auth } from "@virn/auth";
import { getOrganizationMembership } from "@virn/database";

export const publicProcedure = os.$context<{
	headers: Headers;
}>();

export const protectedProcedure = publicProcedure.use(async ({ context, next }) => {
	const session = await auth.api.getSession({
		headers: context.headers,
	});

	if (!session) {
		throw new ORPCError("UNAUTHORIZED");
	}

	return await next({
		context: {
			session: session.session,
			user: session.user,
		},
	});
});

export const adminProcedure = protectedProcedure.use(async ({ context, next }) => {
	if (context.user.role !== "admin") {
		throw new ORPCError("FORBIDDEN");
	}

	return await next();
});

/**
 * Require an active organization (Invariant #1). Resolves the org from
 * `session.activeOrganizationId` (set by Better Auth's organization plugin and reconciled
 * on the client by ActiveOrganizationProvider against the URL slug) and verifies the user
 * is a member. Injects `organization` and `membership` (with role) into context.
 */
export const protectedOrgProcedure = protectedProcedure.use(async ({ context, next }) => {
	const organizationId = context.session.activeOrganizationId;
	if (!organizationId) {
		throw new ORPCError("FORBIDDEN", {
			message: "No active organization. Select one before calling this procedure.",
		});
	}
	const membership = await getOrganizationMembership(organizationId, context.user.id);
	if (!membership) {
		throw new ORPCError("FORBIDDEN", {
			message: "You are not a member of the active organization.",
		});
	}
	return await next({
		context: {
			organization: membership.organization,
			membership,
		},
	});
});

/** Require the calling user to be an admin or owner of the active organization. */
export const adminOrgProcedure = protectedOrgProcedure.use(async ({ context, next }) => {
	if (context.membership.role !== "admin" && context.membership.role !== "owner") {
		throw new ORPCError("FORBIDDEN", {
			message: "Admin or owner role required for this organization.",
		});
	}
	return await next();
});
