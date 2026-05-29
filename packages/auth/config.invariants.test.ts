// Auth invariants test — checks contract properties that a config snapshot can't.
//
// Today this file covers AUTH_CONTRACT.md §6 #9: every concrete top-level URL
// segment in `apps/saas/app/` must be in `forbiddenOrganizationSlugs`, otherwise
// an org with that slug would collide with a literal route (Next.js resolves
// concrete segments before the `[organizationSlug]` dynamic segment).
//
// Other §6 invariants (procedure middleware behavior, `disableCookieCache: true`
// on server reads, gating-helper membership refusal) are tested where the code
// lives: `packages/api/orpc/procedures.test.ts`, the gating-server tests, etc.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { config as virnAuthConfig } from "./config";

const here = path.dirname(fileURLToPath(import.meta.url));
const SAAS_APP_DIR = path.resolve(here, "..", "..", "apps", "saas", "app");

/**
 * Slugs that are intentionally reserved even though no route currently uses
 * them. Each entry is a deliberate decision — adding to this list should
 * coincide with a comment explaining why the slug is held in reserve.
 */
const INTENTIONALLY_RESERVED_SLUGS: ReadonlySet<string> = new Set([
	// Held for the future AI-demo route surface; safe-listed so the reverse
	// invariant check below doesn't fail until the route lands.
	"ai-demo",
	// Phase 9.6 reservation -- Playbooks schema seam lands ahead of the
	// /playbooks/* route surface (Phase 18a). Reserved here so the slug is
	// claimed at schema-seam time and orgs can't grab it in the interim;
	// invariant check stays green until the route directory lands under
	// apps/saas/app/.
	"playbooks",
	// Phase 10 / v1.5c (PRD §6.4) -- the readers' index ships as the
	// org-scoped /[organizationSlug]/sop route, not a top-level /sop.
	// The slug stays reserved so future evolution (e.g. a cross-org public
	// SOP browser) can claim the top-level path without an org-slug
	// collision risk. Move out of INTENTIONALLY_RESERVED_SLUGS if/when
	// apps/saas/app/sop/ lands.
	"sop",
]);

/**
 * Walk `apps/saas/app/` and return every directory name that produces a
 * concrete top-level URL segment. Route groups (`(group)`) don't add path
 * segments — we descend into them. Dynamic segments (`[param]`, `[...rest]`)
 * never collide with an org slug because Next matches static segments first,
 * so we exclude them. The dynamic `[organizationSlug]` segment IS the org
 * route itself, so it's also excluded.
 */
function collectConcreteTopLevelSegments(): Set<string> {
	const segments = new Set<string>();

	function isRouteGroup(name: string): boolean {
		return name.startsWith("(") && name.endsWith(")");
	}

	function isDynamicSegment(name: string): boolean {
		return name.startsWith("[");
	}

	function walk(dir: string): void {
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}

		for (const entry of entries) {
			if (!entry.isDirectory()) continue;

			if (isRouteGroup(entry.name)) {
				// Route groups don't add a URL segment — descend without recording.
				walk(path.join(dir, entry.name));
				continue;
			}

			if (isDynamicSegment(entry.name)) {
				continue;
			}

			segments.add(entry.name);
		}
	}

	walk(SAAS_APP_DIR);
	return segments;
}

describe("auth invariants (docs/AUTH_CONTRACT.md §6)", () => {
	it("forbiddenOrganizationSlugs covers every concrete top-level route segment", () => {
		const concreteSegments = collectConcreteTopLevelSegments();
		// Explicit Set<string> — `forbiddenOrganizationSlugs` is `as const` so its
		// element type is a literal union, but we want a plain `.has(string)` check.
		const forbidden: Set<string> = new Set(virnAuthConfig.organizations.forbiddenOrganizationSlugs);

		const missing = [...concreteSegments]
			.filter((seg) => !forbidden.has(seg))
			.sort();

		expect(
			missing,
			[
				"Every concrete top-level URL segment under apps/saas/app/ must be in",
				"packages/auth/config.ts → organizations.forbiddenOrganizationSlugs,",
				"otherwise an org with that slug collides with a literal route (Next.js",
				"resolves concrete segments before the [organizationSlug] dynamic segment).",
				"See docs/AUTH_CONTRACT.md §6 #9.",
				"",
				`Missing slugs: ${missing.join(", ")}`,
			].join("\n"),
		).toEqual([]);
	});

	it("every forbidden slug either matches a concrete route or is intentionally reserved", () => {
		const concreteSegments = collectConcreteTopLevelSegments();

		const orphaned = virnAuthConfig.organizations.forbiddenOrganizationSlugs
			.filter((slug) => !concreteSegments.has(slug) && !INTENTIONALLY_RESERVED_SLUGS.has(slug))
			.sort();

		expect(
			orphaned,
			[
				"Every forbiddenOrganizationSlug should correspond to a concrete route",
				"segment under apps/saas/app/. Orphaned entries (no matching route AND not",
				"in INTENTIONALLY_RESERVED_SLUGS) likely indicate stale config — either the",
				"route was removed and this entry should be too, or the reservation is",
				"deliberate and should be moved to INTENTIONALLY_RESERVED_SLUGS with a",
				"comment explaining why.",
				"",
				`Orphaned slugs: ${orphaned.join(", ")}`,
			].join("\n"),
		).toEqual([]);
	});
});
