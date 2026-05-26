import { PlaceholderScreen } from "@shared/components/PlaceholderScreen";
import { assertCanSee } from "@shared/lib/gating-server";
import { NAV_AREAS } from "@shared/lib/nav";

export const metadata = { title: "Branding" };

export default async function BrandingPage({
	params,
}: {
	params: Promise<{ organizationSlug: string }>;
}) {
	const { organizationSlug } = await params;
	await assertCanSee(organizationSlug, NAV_AREAS.branding);

	return (
		<PlaceholderScreen
			title="Branding"
			subtitle="Logo, colors, white-label settings (premium tier)."
			phase="defer-design"
		/>
	);
}
