import "server-only";

import { getActiveOrganization, getSession } from "@auth/lib/server";
import type { ActiveOrganization } from "@virn/auth";
import { getEffectiveCapabilities } from "@virn/database";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";

import { buildGatingSnapshot, canSee, type GatingSnapshot } from "./gating";
import { mapBetterAuthRole, type NavArea } from "./nav";

/**
 * Resolve the gating snapshot for the current user inside the given org. Returns
 * `null` when the user is not actually a member of the organization — never falls
 * through to a default role (AUTH_CONTRACT.md §6 #15). Cached per request so
 * server components in the same render tree share one resolver call.
 */
export const resolveGatingSnapshotFor = cache(
	async (organization: ActiveOrganization, userId: string): Promise<GatingSnapshot | null> => {
		const membership = organization.members.find((m) => m.userId === userId);
		if (!membership) {
			// Defense-in-depth: getActiveOrganization should already refuse non-members
			// (Better Auth's getFullOrganization enforces it), but we never trust an
			// upstream check to derive a role. No membership => no snapshot.
			return null;
		}
		const role = mapBetterAuthRole(membership.role);

		const capabilities = await getEffectiveCapabilities(organization.id);
		const enabledKeys = capabilities.filter((c) => c.enabled).map((c) => c.key);

		return buildGatingSnapshot(role, enabledKeys);
	},
);

/**
 * Convenience for page server components: resolve session + active org + snapshot in one call.
 * Returns null when the session is gone, the org is missing, or the user isn't a member.
 * Callers differentiate the cases as needed (e.g. `assertCanSee` redirects to /login on
 * missing session, but 404s on missing org/membership).
 */
export async function resolveOrgGating(organizationSlug: string): Promise<{
	organization: ActiveOrganization;
	snapshot: GatingSnapshot;
	userId: string;
} | null> {
	const session = await getSession();
	if (!session) return null;

	const organization = await getActiveOrganization(organizationSlug);
	if (!organization) return null;

	const snapshot = await resolveGatingSnapshotFor(organization, session.user.id);
	if (!snapshot) return null;

	return { organization, snapshot, userId: session.user.id };
}

/**
 * Server-side guard for protected route segments. Resolves the snapshot and 404s if the
 * user can't see the area (UX_SPEC §3 — gating is enforced on the route, not just by
 * hiding nav items). Differentiates missing-session (-> /login) from missing-org or
 * missing-membership (-> notFound) so we never redirect back into a protected route and
 * cause a loop.
 */
export async function assertCanSee(
	organizationSlug: string,
	area: NavArea,
): Promise<{ organization: ActiveOrganization; snapshot: GatingSnapshot }> {
	const session = await getSession();
	if (!session) {
		redirect("/login");
	}

	const resolved = await resolveOrgGating(organizationSlug);
	if (!resolved) {
		notFound();
	}
	if (!canSee(area, resolved.snapshot)) {
		notFound();
	}
	return { organization: resolved.organization, snapshot: resolved.snapshot };
}
