import { PlaceholderScreen } from "@shared/components/PlaceholderScreen";
import { assertCanSee } from "@shared/lib/gating-server";
import { NAV_AREAS } from "@shared/lib/nav";

export const metadata = { title: "Templates" };

export default async function TemplatesPage({
	params,
}: {
	params: Promise<{ organizationSlug: string }>;
}) {
	const { organizationSlug } = await params;
	await assertCanSee(organizationSlug, NAV_AREAS.templates);

	return (
		<PlaceholderScreen
			title="Templates"
			subtitle="The shared template library — install deep-clones into this org."
		/>
	);
}
