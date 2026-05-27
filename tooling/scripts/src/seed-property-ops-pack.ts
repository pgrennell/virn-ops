// tooling/scripts/src/seed-property-ops-pack.ts
//
// Platform-level seed for the property-ops pack (Phase 17a). Idempotent: re-running
// is a no-op via the (slug) / (packId, versionNumber) keys.
//
// What this creates at the platform level:
//   1. solution_pack with slug='property-ops'
//   2. pack_version with versionNumber=1 (manifest jsonb is a content-type
//      discriminator the install procedure dispatches on -- actual workflow + role
//      definitions live in TypeScript at api/modules/packs/lib/property-ops-manifest.ts)
//
// After this runs, admins can install the pack per-org via the "Install starter
// content" button on /settings/general (calls packs.installStarterContent).
//
// Usage:
//   pnpm --filter @virn/scripts seed:property-ops-pack

import { ensurePackVersion, ensureSolutionPack } from "@virn/database";

import {
	PROPERTY_OPS_PACK_NAME,
	PROPERTY_OPS_PACK_SLUG,
	PROPERTY_OPS_PACK_SUMMARY,
	PROPERTY_OPS_PACK_VERSION_NUMBER,
} from "../../../packages/api/modules/packs/lib/property-ops-manifest";

async function main(): Promise<void> {
	console.log(
		`[${new Date().toISOString()}] Seeding property-ops pack at platform level…`,
	);

	const pack = await ensureSolutionPack({
		slug: PROPERTY_OPS_PACK_SLUG,
		name: PROPERTY_OPS_PACK_NAME,
		summary: PROPERTY_OPS_PACK_SUMMARY,
	});
	console.log(`  solution_pack: ${pack.id} (slug=${PROPERTY_OPS_PACK_SLUG})`);

	const version = await ensurePackVersion({
		packId: pack.id,
		versionNumber: PROPERTY_OPS_PACK_VERSION_NUMBER,
		manifest: {
			// The install logic dispatches on `kind`. Today only 'property-ops' is wired;
			// future packs would extend the dispatch in api/modules/packs/lib.
			kind: "property-ops",
			version: PROPERTY_OPS_PACK_VERSION_NUMBER,
		},
	});
	console.log(`  pack_version: ${version.id} (versionNumber=${PROPERTY_OPS_PACK_VERSION_NUMBER})`);

	console.log("[done] Platform-level pack seed is in place.");
	console.log(
		"        Admins can now click 'Install starter content' on /settings/general to install per-org.",
	);
}

main()
	.then(() => process.exit(0))
	.catch((err) => {
		console.error("[error] property-ops pack seed failed:", err);
		process.exit(1);
	});
