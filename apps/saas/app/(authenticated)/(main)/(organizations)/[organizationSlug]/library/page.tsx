import { PlaceholderScreen } from "@shared/components/PlaceholderScreen";
import { assertCanSee } from "@shared/lib/gating-server";
import { NAV_AREAS } from "@shared/lib/nav";

export const metadata = { title: "Library" };

export default async function LibraryPage({
	params,
}: {
	params: Promise<{ organizationSlug: string }>;
}) {
	const { organizationSlug } = await params;
	await assertCanSee(organizationSlug, NAV_AREAS.library);

	return (
		<PlaceholderScreen
			title="Library"
			subtitle="Workflows, SOPs, policies, and forms — one store, filtered by type."
		/>
	);
}
