// packages/database/drizzle/queries/packs.ts
//
// Solution pack queries (BUILD_PLAN.md Phase 17a). Pack rows are platform-owned
// (ADR-001 / Invariant #2 cross-tenant exception) -- no organizationId. Install rows
// (pack_install) are per-org; the unique constraint uq_pack_install_org_pack enforces
// at-most-one-install-per-pack-per-org.

import { and, eq } from "drizzle-orm";

import { db } from "../client";
import { packInstall, packVersion, solutionPack } from "../schema/postgres";

const PROPERTY_OPS_PACK_SLUG = "property-ops";

export interface PlatformPackVersion {
	id: string;
	packId: string;
	packSlug: string;
	versionNumber: number;
}

/** Look up the latest published version of the property-ops pack at the platform level.
 * Returns null if the pack hasn't been seeded yet (the platform-seed tooling script
 * `pnpm --filter @virn/scripts seed:property-ops-pack` populates it). */
export async function getPropertyOpsPackVersion(): Promise<PlatformPackVersion | null> {
	const pack = await db.query.solutionPack.findFirst({
		where: (sp, { eq: e }) => e(sp.slug, PROPERTY_OPS_PACK_SLUG),
		columns: { id: true, slug: true },
		with: {
			versions: {
				columns: { id: true, versionNumber: true },
				orderBy: (v, { desc: d }) => [d(v.versionNumber)],
				limit: 1,
			},
		},
	});
	if (!pack) return null;
	const version = pack.versions[0];
	if (!version) return null;
	return {
		id: version.id,
		packId: pack.id,
		packSlug: pack.slug,
		versionNumber: version.versionNumber,
	};
}

export interface PackInstallRow {
	id: string;
	organizationId: string;
	packId: string;
	packVersionId: string;
	installedAt: Date;
	installedBy: string | null;
}

/** Returns the (at most one) install row for (orgId, packId). Null = the org hasn't
 * installed this pack. */
export async function getPackInstallForOrg(
	organizationId: string,
	packId: string,
): Promise<PackInstallRow | null> {
	const r = await db.query.packInstall.findFirst({
		where: (pi, { and: a, eq: e }) =>
			a(e(pi.organizationId, organizationId), e(pi.packId, packId)),
	});
	if (!r) return null;
	return {
		id: r.id,
		organizationId: r.organizationId,
		packId: r.packId,
		packVersionId: r.packVersionId,
		installedAt: r.installedAt,
		installedBy: r.installedBy,
	};
}

export interface InsertPackInstallInput {
	organizationId: string;
	packId: string;
	packVersionId: string;
	installedBy: string;
}

/** Append a pack_install row. Per the schema's uq_pack_install_org_pack, calling this
 * for an (org, pack) pair that already has a row will throw a unique-violation; the
 * caller is expected to gate on getPackInstallForOrg before calling. */
export async function insertPackInstall(
	input: InsertPackInstallInput,
): Promise<{ id: string }> {
	const [row] = await db
		.insert(packInstall)
		.values({
			organizationId: input.organizationId,
			packId: input.packId,
			packVersionId: input.packVersionId,
			installedBy: input.installedBy,
		})
		.returning({ id: packInstall.id });
	return row;
}

// ---------------------------------------------------------------------------
// Platform-seed helpers (used by tooling/scripts/seed-property-ops-pack.ts)
// ---------------------------------------------------------------------------

export interface EnsurePackInput {
	slug: string;
	name: string;
	summary: string;
}

/** Idempotent: ensure the solution_pack row exists at the platform level. Keyed by
 * slug. Returns the row's id. */
export async function ensureSolutionPack(input: EnsurePackInput): Promise<{ id: string }> {
	const existing = await db.query.solutionPack.findFirst({
		where: (sp, { eq: e }) => e(sp.slug, input.slug),
		columns: { id: true },
	});
	if (existing) return { id: existing.id };
	const [row] = await db
		.insert(solutionPack)
		.values({
			slug: input.slug,
			name: input.name,
			summary: input.summary,
		})
		.returning({ id: solutionPack.id });
	return row;
}

export interface EnsurePackVersionInput {
	packId: string;
	versionNumber: number;
	manifest: Record<string, unknown>;
}

/** Idempotent: ensure a pack_version row exists at (packId, versionNumber). Returns
 * the row's id. Manifest content is replayed via the install logic regardless -- the
 * jsonb here is informational only (a content-type discriminator the install
 * dispatch reads to pick the right installer; the actual workflow definitions live
 * in TypeScript). */
export async function ensurePackVersion(input: EnsurePackVersionInput): Promise<{ id: string }> {
	const existing = await db.query.packVersion.findFirst({
		where: (pv, { and: a, eq: e }) =>
			a(e(pv.packId, input.packId), e(pv.versionNumber, input.versionNumber)),
		columns: { id: true },
	});
	if (existing) return { id: existing.id };
	const [row] = await db
		.insert(packVersion)
		.values({
			packId: input.packId,
			versionNumber: input.versionNumber,
			manifest: input.manifest,
		})
		.returning({ id: packVersion.id });
	return row;
}
