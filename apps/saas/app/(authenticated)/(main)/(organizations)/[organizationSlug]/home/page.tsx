import { HomeView } from "@runs/components/HomeView";
import { assertCanSee } from "@shared/lib/gating-server";
import { NAV_AREAS } from "@shared/lib/nav";

export const dynamic = "force-dynamic";

export const metadata = { title: "Home" };

// Approvals capability key (lives in queries/config.ts PROFILES). Listed here as a
// plain string because nav.ts's CAPABILITIES constant only declares the keys it gates
// nav items on (automation.rules, integrations.webhooks). Surfacing governance.approvals
// in the home dashboard isn't a nav gate -- it's a render-or-hide card -- so we read it
// straight from the snapshot's enabledCapabilities set.
const APPROVALS_CAPABILITY_KEY = "governance.approvals";

export default async function HomePage({
	params,
}: {
	params: Promise<{ organizationSlug: string }>;
}) {
	const { organizationSlug } = await params;
	const { snapshot } = await assertCanSee(organizationSlug, NAV_AREAS.home);
	const approvalsEnabled = snapshot.enabledCapabilities.has(APPROVALS_CAPABILITY_KEY);
	return <HomeView orgSlug={organizationSlug} approvalsEnabled={approvalsEnabled} />;
}
