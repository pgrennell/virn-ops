import { PlaceholderScreen } from "@shared/components/PlaceholderScreen";
import { assertCanSee } from "@shared/lib/gating-server";
import { NAV_AREAS } from "@shared/lib/nav";

export const metadata = { title: "Integrations" };

export default async function IntegrationsPage({
	params,
}: {
	params: Promise<{ organizationSlug: string }>;
}) {
	const { organizationSlug } = await params;
	await assertCanSee(organizationSlug, NAV_AREAS.integrations);

	return (
		<PlaceholderScreen
			title="Integrations"
			subtitle="Outbound webhooks, connections, iPaaS hub."
			note="Gated by the integrations.webhooks capability — turn it on in Configuration to make this slot visible."
		/>
	);
}
