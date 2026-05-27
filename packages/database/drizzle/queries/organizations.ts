import { and, asc, eq, ilike, or, sql } from "drizzle-orm";
import type { z } from "zod";

import { db } from "../client";
import { member, organization, user } from "../schema/postgres";
import type { OrganizationUpdateSchema } from "../zod";

export async function getOrganizations({
	limit,
	offset,
	query,
}: {
	limit: number;
	offset: number;
	query?: string;
}) {
	return db.query.organization.findMany({
		where: query ? (org, { ilike, or }) => or(ilike(org.name, `%${query}%`)) : undefined,
		limit,
		offset,
		extras: {
			membersCount:
				sql<number>`(SELECT COUNT(*) FROM ${member} WHERE ${member.organizationId} = ${organization.id})`.as(
					"membersCount",
				),
		},
	});
}

export async function countAllOrganizations({ query }: { query?: string }) {
	const result = await db
		.select({ count: sql<number>`count(*)` })
		.from(organization)
		.where(query ? or(ilike(organization.name, `%${query}%`)) : undefined);
	return Number(result[0]?.count ?? 0);
}

export async function getOrganizationById(id: string) {
	return (
		(await db.query.organization.findFirst({
			where: (org, { eq }) => eq(org.id, id),
			with: {
				members: true,
				invitations: true,
			},
		})) ?? null
	);
}

export async function getInvitationById(id: string) {
	return (
		(await db.query.invitation.findFirst({
			where: (invitation, { eq }) => eq(invitation.id, id),
			with: {
				organization: true,
			},
		})) ?? null
	);
}

export async function getOrganizationBySlug(slug: string) {
	return (
		(await db.query.organization.findFirst({
			where: (org, { eq }) => eq(org.slug, slug),
		})) ?? null
	);
}

export async function getOrganizationMembership(organizationId: string, userId: string) {
	return (
		(await db.query.member.findFirst({
			where: (member, { eq }) =>
				and(eq(member.organizationId, organizationId), eq(member.userId, userId)),
			with: {
				organization: true,
			},
		})) ?? null
	);
}

export async function getOrganizationWithPurchasesAndMembersCount(organizationId: string) {
	return (
		(await db.query.organization.findFirst({
			where: (org, { eq }) => eq(org.id, organizationId),
			with: {
				purchases: true,
			},
			extras: {
				membersCount:
					sql<number>`(SELECT COUNT(*) FROM ${member} WHERE ${member.organizationId} = ${organization.id})`.as(
						"membersCount",
					),
			},
		})) ?? null
	);
}

export async function getPendingInvitationByEmail(email: string) {
	return (
		(await db.query.invitation.findFirst({
			where: (invitation, { eq }) =>
				and(eq(invitation.email, email), eq(invitation.status, "pending")),
		})) ?? null
	);
}

export async function updateOrganization(
	updatedOrganization: z.infer<typeof OrganizationUpdateSchema>,
) {
	return db
		.update(organization)
		.set(updatedOrganization)
		.where(eq(organization.id, updatedOrganization.id));
}

export interface OrgMemberRow {
	userId: string;
	name: string;
	email: string;
	image: string | null;
	role: string;
}

/** List members of an org for picker UIs. Returns ONLY the four fields the picker
 * needs -- id, name, email, image, plus the Better Auth role for tooltip display.
 * Held minimal on purpose (the day a consumer needs filter-by-role is the day it
 * gets one; not before -- D-020 wildcard-export lesson, applied to a different
 * surface). Org-scoped: caller passes the orgId; no cross-tenant traversal. */
export async function listMembersForOrg(organizationId: string): Promise<OrgMemberRow[]> {
	const rows = await db
		.select({
			userId: user.id,
			name: user.name,
			email: user.email,
			image: user.image,
			role: member.role,
		})
		.from(member)
		.innerJoin(user, eq(user.id, member.userId))
		.where(eq(member.organizationId, organizationId))
		.orderBy(asc(user.name));
	return rows.map((r) => ({
		userId: r.userId,
		name: r.name,
		email: r.email,
		image: r.image ?? null,
		role: r.role,
	}));
}
