import { getActiveOrganization } from "@auth/lib/server";
import { canSee } from "@shared/lib/gating";
import { resolveOrgGating } from "@shared/lib/gating-server";
import { NAV_AREA_DEFINITIONS, NAV_GROUPS, navHref } from "@shared/lib/nav";
import { notFound, redirect } from "next/navigation";

export async function generateMetadata({
	params,
}: {
	params: Promise<{ organizationSlug: string }>;
}) {
	const { organizationSlug } = await params;
	const activeOrganization = await getActiveOrganization(organizationSlug);
	return { title: activeOrganization?.name };
}

// Org root: redirect to the first NOW-phase area the user can see (UX_SPEC §3 IA).
// Operator surfaces (home, my-work, runs) are `defer-design` placeholders today —
// landing anyone there by default would mean their first impression is a "coming
// next" card. Prefer real screens (Library, Configuration, etc.). When no NOW
// area is visible, fall back to whatever is first visible so the page never 404s
// on a legitimate member.
export default async function OrganizationPage({
	params,
}: {
	params: Promise<{ organizationSlug: string }>;
}) {
	const { organizationSlug } = await params;

	const resolved = await resolveOrgGating(organizationSlug);
	if (!resolved) {
		return notFound();
	}

	const { snapshot } = resolved;
	const flatItems = NAV_GROUPS.flatMap((g) => g.items);

	const target =
		flatItems.find(
			(i) => canSee(i.area, snapshot) && NAV_AREA_DEFINITIONS[i.area].phase === "now",
		) ?? flatItems.find((i) => canSee(i.area, snapshot));

	if (!target) {
		notFound();
	}

	redirect(navHref(organizationSlug, target.segment));
}
