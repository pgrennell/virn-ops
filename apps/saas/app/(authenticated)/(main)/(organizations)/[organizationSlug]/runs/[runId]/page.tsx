import { RunView } from "@runs/components/RunView";
import { assertCanSee } from "@shared/lib/gating-server";
import { NAV_AREAS } from "@shared/lib/nav";

export const dynamic = "force-dynamic";

export const metadata = { title: "Run" };

export default async function RunPage({
	params,
}: {
	params: Promise<{ organizationSlug: string; runId: string }>;
}) {
	const { organizationSlug, runId } = await params;
	// Server-side gating: auth + tenancy + capability/permission on the Runs area.
	// notFound() / redirect() under the hood; nothing renders if the user can't see it.
	const { snapshot } = await assertCanSee(organizationSlug, NAV_AREAS.runs);

	return <RunView runId={runId} isAdminOrOwner={snapshot.isAdminSuperset} />;
}
