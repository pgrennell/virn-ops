import { ORPCError, os } from "@orpc/server";
import { auth } from "@virn/auth";
import {
	findActiveAgentByCredential,
	getOrganizationMembership,
	type ResolvedAgent,
} from "@virn/database";

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

// ---------------------------------------------------------------------------
// Agent-or-user dual-auth (Phase 11a, S-01a action surface)
// ---------------------------------------------------------------------------

/**
 * Discriminated principal injected by `agentOrUserOrgProcedure`. Downstream lib code
 * dispatches on `kind` to set audit attribution (`actor_kind`, `actor_participant_id`)
 * and to gate org-scoped access without re-running the auth resolution.
 *
 *   - `user`: a Better Auth session resolved via cookie/header; the `membership` field
 *     mirrors the existing user-procedure shape so handlers can reuse role checks.
 *   - `agent`: a long-lived service principal resolved via `Authorization: Bearer agent_…`;
 *     the org is taken from `agent.organizationId` (an agent is single-tenant by design,
 *     ADR-006) — there is no membership object since agents aren't org members.
 */
export type DualAuthPrincipal =
	| {
			kind: "user";
			user: NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>["user"];
			session: NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>["session"];
			membership: Awaited<ReturnType<typeof getOrganizationMembership>>;
	  }
	| {
			kind: "agent";
			agent: ResolvedAgent;
	  };

/** Parse a Bearer credential out of the `Authorization` header, returning the raw token or
 * null if absent / malformed. We do NOT verify here — callers verify by calling
 * `findActiveAgentByCredential`, which handles the (constant-ish-time) scrypt check. */
function extractBearerToken(headers: Headers): string | null {
	const h = headers.get("authorization") ?? headers.get("Authorization");
	if (!h) return null;
	const m = /^Bearer\s+(\S+)$/i.exec(h);
	return m ? m[1] : null;
}

/**
 * Dual-auth org-scoped procedure (Phase 11a, S-01a). The same handler is reachable by:
 *
 *   1. A logged-in user with a session cookie + an active org (the existing user path —
 *      reuses `protectedOrgProcedure`'s session + membership resolution). `principal.kind`
 *      is `'user'` and `principal.membership` is set; role-gated handlers can check
 *      `principal.membership.role`.
 *   2. An agent presenting `Authorization: Bearer agent_<43 chars>` (the action-surface
 *      path — ADR-006 service-account model). The bearer is verified via
 *      `findActiveAgentByCredential` (scrypt, last-four prefilter). On success
 *      `principal.kind` is `'agent'` and `principal.agent.organizationId` is the org the
 *      agent is single-tenant scoped to.
 *
 * Org resolution: for users we go through `session.activeOrganizationId` + membership; for
 * agents the org comes directly from `agent.organizationId` (agents are not org members,
 * they are org-owned). `context.organization` is normalized to `{ id }` so downstream
 * handlers consume one shape.
 *
 * Precedence: if both a session AND a bearer are present, the bearer wins. This means a
 * developer hitting the action surface from a browser with a stale cookie won't accidentally
 * fall through to user-mode and bypass agent-specific audit attribution.
 *
 * NOT a replacement for `adminOrgProcedure`: admin-only writes (e.g. agent CRUD, settings)
 * deliberately keep the user-only chain — agents can't manage other agents.
 */
export const agentOrUserOrgProcedure = publicProcedure.use(async ({ context, next }) => {
	// Resolve the principal first (typed union), then call next ONCE so oRPC infers a
	// single unified context shape instead of two divergent branches.
	let principal: DualAuthPrincipal;
	let organizationId: string;

	const bearer = extractBearerToken(context.headers);
	if (bearer) {
		const agent = await findActiveAgentByCredential(bearer);
		if (!agent) {
			throw new ORPCError("UNAUTHORIZED", {
				message: "Invalid or revoked agent credential.",
			});
		}
		principal = { kind: "agent", agent };
		organizationId = agent.organizationId;
	} else {
		// User path -- mirror protectedOrgProcedure resolution inline so we end up with the
		// same normalized context shape (we can't .use() on top of it because that would
		// force the bearer path through the user-session check too).
		const session = await auth.api.getSession({ headers: context.headers });
		if (!session) {
			throw new ORPCError("UNAUTHORIZED");
		}
		const orgId = session.session.activeOrganizationId;
		if (!orgId) {
			throw new ORPCError("FORBIDDEN", {
				message: "No active organization. Select one before calling this procedure.",
			});
		}
		const membership = await getOrganizationMembership(orgId, session.user.id);
		if (!membership) {
			throw new ORPCError("FORBIDDEN", {
				message: "You are not a member of the active organization.",
			});
		}
		principal = {
			kind: "user",
			user: session.user,
			session: session.session,
			membership,
		};
		organizationId = membership.organization.id;
	}

	return await next({
		context: {
			principal,
			organization: { id: organizationId },
		},
	});
});
