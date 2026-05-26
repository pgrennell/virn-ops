import { PlaceholderScreen } from "@shared/components/PlaceholderScreen";
import { assertCanSee } from "@shared/lib/gating-server";
import { NAV_AREAS } from "@shared/lib/nav";

export const metadata = { title: "Automations" };

export default async function AutomationsPage({
	params,
}: {
	params: Promise<{ organizationSlug: string }>;
}) {
	const { organizationSlug } = await params;
	await assertCanSee(organizationSlug, NAV_AREAS.automations);

	return (
		<PlaceholderScreen
			title="Automations"
			subtitle="Cross-workflow rules — event → condition → action."
			note="Gated by the automation.rules capability — turn it on in Configuration to make this slot visible."
		/>
	);
}
