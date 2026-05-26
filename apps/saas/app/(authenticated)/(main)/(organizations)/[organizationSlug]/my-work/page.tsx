import { MyWorkView } from "@runs/components/MyWorkView";
import { assertCanSee } from "@shared/lib/gating-server";
import { NAV_AREAS } from "@shared/lib/nav";

export const dynamic = "force-dynamic";

export const metadata = { title: "My work" };

export default async function MyWorkPage({
	params,
}: {
	params: Promise<{ organizationSlug: string }>;
}) {
	const { organizationSlug } = await params;
	// Server-side gating via the canonical helper. The route 404s if the user can't see
	// the My Work area (capability x permission).
	await assertCanSee(organizationSlug, NAV_AREAS.myWork);
	return <MyWorkView orgSlug={organizationSlug} />;
}
