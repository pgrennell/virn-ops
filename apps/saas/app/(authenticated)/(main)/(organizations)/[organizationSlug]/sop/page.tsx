// /sop -- readers' index (Phase 10 / v1.5c, PRD §6.4).
//
// Browse-ergonomic index of every published workflow in the org. Rows route
// to the workflow detail page in Read view (`/library/workflows/[id]/read`).
// All org members can see this; the surface itself doesn't gate -- every
// row's destination handles its own permission resolution.
//
// Three-views unification (D-021 / 2026-05-26 pivot): the same row that
// would appear on /library/workflows for an author appears here for the
// reader. Different lens onto the same data; "find the SOP, read it, mark
// as read" is the operator framing.

import { SopIndex } from "@builder/components/SopIndex";
import { assertCanSee } from "@shared/lib/gating-server";
import { NAV_AREAS } from "@shared/lib/nav";

export const dynamic = "force-dynamic";
export const metadata = { title: "SOPs" };

export default async function SopIndexPage({
	params,
}: {
	params: Promise<{ organizationSlug: string }>;
}) {
	const { organizationSlug } = await params;
	// Gate on NAV_AREAS.sop, NOT NAV_AREAS.library. The original gating chose
	// `library` for symmetry with the authors' index, but `library` excludes
	// operators -- which 404s the very audience this surface is built for
	// (Antigravity REPORT 2026-05-29 §4). `sop` widens the allow-list to
	// every org member while leaving `library` (and its drafts/in-review
	// visibility) author-only.
	await assertCanSee(organizationSlug, NAV_AREAS.sop);

	return (
		<div className="h-full min-h-0 p-4">
			<SopIndex organizationSlug={organizationSlug} />
		</div>
	);
}
